"""HTTP server — OpenAI-compatible chat completions endpoint.

Wraps CalculusAssistant with the fipsagents OpenAIChatServer for
deployment behind the gateway.
"""

from fipsagents.server import OpenAIChatServer

from src.agent import CalculusAssistant

server = OpenAIChatServer(
    CalculusAssistant,
    config_path="agent.yaml",
    title="Calculus Assistant",
)

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
        "system_prompt": system_prompt,
        "tools": tools,
    }


if __name__ == "__main__":
    server.run()
