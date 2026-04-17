"""HTTP server — OpenAI-compatible chat completions endpoint.

Wraps CalculusAssistant with the fipsagents OpenAIChatServer for
deployment behind the gateway.  Adds an optional Responses API mode
that proxies to LlamaStack /v1/responses and translates SSE events
back to Chat Completions format.
"""

import json
import time
import uuid

import httpx

from fipsagents.server import OpenAIChatServer

from src.agent import CalculusAssistant


# ---------------------------------------------------------------------------
# Responses API proxy
# ---------------------------------------------------------------------------

LLAMASTACK_RESPONSES_URL = (
    "http://llama-stack-service.llamastack.svc.cluster.local:8321/v1/responses"
)


def _cc_chunk(completion_id: str, model: str, delta: dict, finish_reason=None) -> str:
    """Format one Chat Completions SSE chunk."""
    chunk = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(chunk)}\n\n"


async def stream_responses_api(agent, messages, model_name, overrides):
    """Call LlamaStack Responses API and translate SSE to Chat Completions format.

    Handles multi-turn tool calling internally: when the model returns a
    function_call, we execute it through the agent's tool registry and
    re-invoke /v1/responses with the result appended to the input.
    """
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"

    # Build tool schemas in Responses API format
    tools_for_api = []
    for t in agent.tools.get_llm_tools():
        tools_for_api.append({
            "type": "function",
            "name": t.name,
            "description": t.description,
            "parameters": t.parameters or {"type": "object", "properties": {}},
        })

    # Responses API accepts the same message list as input
    api_input = messages

    # Lead with role chunk
    yield _cc_chunk(completion_id, model_name, {"role": "assistant"})

    max_rounds = 10
    for _round in range(max_rounds):
        # Build request body
        req_body = {
            "model": "RedHatAI/gpt-oss-20b",
            "input": api_input,
            "stream": True,
            "tools": tools_for_api if tools_for_api else [],
        }
        if "max_tokens" in overrides:
            req_body["max_output_tokens"] = overrides["max_tokens"]
        elif agent.config.model.max_tokens:
            req_body["max_output_tokens"] = agent.config.model.max_tokens
        if "temperature" in overrides:
            req_body["temperature"] = overrides["temperature"]
        if "top_p" in overrides:
            req_body["top_p"] = overrides["top_p"]

        # Track state for this round
        current_tool_call = None  # {call_id, name, arguments}
        tool_call_index = 0
        got_function_call = False

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                LLAMASTACK_RESPONSES_URL,
                json=req_body,
                headers={"Content-Type": "application/json"},
            ) as resp:
                buffer = ""
                async for raw_bytes in resp.aiter_bytes():
                    buffer += raw_bytes.decode("utf-8", errors="replace")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            continue
                        try:
                            event = json.loads(payload)
                        except json.JSONDecodeError:
                            continue

                        event_type = event.get("type", "")

                        if event_type == "response.reasoning_text.delta":
                            yield _cc_chunk(
                                completion_id,
                                model_name,
                                {"reasoning_content": event.get("delta", "")},
                            )

                        elif event_type == "response.output_text.delta":
                            yield _cc_chunk(
                                completion_id,
                                model_name,
                                {"content": event.get("delta", "")},
                            )

                        elif event_type == "response.output_item.added":
                            item = event.get("item", {})
                            if item.get("type") == "function_call":
                                got_function_call = True
                                current_tool_call = {
                                    "call_id": item.get("call_id", ""),
                                    "name": item.get("name", ""),
                                    "arguments": "",
                                }
                                yield _cc_chunk(
                                    completion_id,
                                    model_name,
                                    {
                                        "tool_calls": [
                                            {
                                                "index": tool_call_index,
                                                "id": current_tool_call["call_id"],
                                                "type": "function",
                                                "function": {
                                                    "name": current_tool_call["name"],
                                                    "arguments": "",
                                                },
                                            }
                                        ]
                                    },
                                )

                        elif event_type == "response.function_call_arguments.delta":
                            if current_tool_call:
                                args_delta = event.get("delta", "")
                                current_tool_call["arguments"] += args_delta
                                yield _cc_chunk(
                                    completion_id,
                                    model_name,
                                    {
                                        "tool_calls": [
                                            {
                                                "index": tool_call_index,
                                                "function": {
                                                    "arguments": args_delta,
                                                },
                                            }
                                        ]
                                    },
                                )

                        elif event_type == "response.completed":
                            pass  # finish emitted after tool loop or at end

        # If we got a function call, execute the tool and loop
        if got_function_call and current_tool_call:
            fn_name = current_tool_call["name"]
            fn_args_str = current_tool_call["arguments"]
            try:
                fn_args = json.loads(fn_args_str) if fn_args_str else {}
            except json.JSONDecodeError:
                fn_args = {}

            # Execute via agent's tool registry
            result = await agent.tools.execute(fn_name, **fn_args)
            result_text = (
                result.result if not result.is_error else f"Error: {result.error}"
            )

            # Emit tool result as a Chat Completions SSE chunk
            yield _cc_chunk(
                completion_id,
                model_name,
                {
                    "role": "tool",
                    "tool_call_id": current_tool_call["call_id"],
                    "content": result_text,
                },
            )

            # Append assistant function_call + tool result for next round
            api_input = list(api_input)
            api_input.append({
                "type": "function_call",
                "call_id": current_tool_call["call_id"],
                "name": fn_name,
                "arguments": fn_args_str,
            })
            api_input.append({
                "type": "function_call_output",
                "call_id": current_tool_call["call_id"],
                "output": result_text,
            })
            tool_call_index += 1
            continue  # next round
        else:
            break  # no more tool calls

    # Emit finish
    yield _cc_chunk(completion_id, model_name, {}, finish_reason="stop")
    yield "data: [DONE]\n\n"

server = OpenAIChatServer(
    CalculusAssistant,
    config_path="agent.yaml",
    title="Calculus Assistant",
)
server.responses_api_handler = stream_responses_api


@server.app.get("/v1/agent-info")
async def agent_info():
    agent = server._agent
    if agent is None:
        return {"error": "Agent not ready"}

    # Get system prompt from the first message (always role=system)
    system_prompt = ""
    if agent.messages and agent.messages[0].get("role") == "system":
        system_prompt = agent.messages[0]["content"]

    # Get tool list
    tools = []
    for t in agent.tools.get_llm_tools():
        tools.append({
            "name": t.name,
            "description": t.description,
            "parameters": t.parameters,
        })

    return {
        "model": {
            "name": agent.config.model.name,
            "temperature": agent.config.model.temperature,
            "max_tokens": agent.config.model.max_tokens,
        },
        "backends": {
            "direct": {
                "label": "Direct (vLLM)",
                "api_base": None,  # use default from agent.yaml
            },
            "llamastack": {
                "label": "LlamaStack",
                "api_base": "http://llama-stack-service.llamastack.svc.cluster.local:8321/v1",
                "responses_api": True,
            },
        },
        "system_prompt": system_prompt,
        "tools": tools,
    }


if __name__ == "__main__":
    server.run()
