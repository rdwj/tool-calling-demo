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

if __name__ == "__main__":
    server.run()
