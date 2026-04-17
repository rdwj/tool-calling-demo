"""Calculus Assistant — demonstrates GPT-OSS-20B native tool calling.

Connects to a calculus-helper MCP server for computation tools. The LLM
decides which tools to call and interprets results for the user.
"""

from __future__ import annotations

import json
import logging

from fipsagents.baseagent import BaseAgent, StepResult

logger = logging.getLogger(__name__)


class CalculusAssistant(BaseAgent):
    """A calculus assistant that uses MCP tools for computation."""

    async def step(self) -> StepResult:
        response = await self.call_model()

        while response.tool_calls:
            self.messages.append({
                "role": "assistant",
                "content": response.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in response.tool_calls
                ],
            })
            for tc in response.tool_calls:
                fn = tc.function
                args = json.loads(fn.arguments) if fn.arguments else {}
                result = await self.tools.execute(fn.name, **args)
                self.messages.append({
                    "role": "tool",
                    "content": result.result,
                    "tool_call_id": tc.id,
                })
            response = await self.call_model()

        return StepResult.done(result=response.content or "")
