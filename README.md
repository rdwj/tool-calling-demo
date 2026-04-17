# Tool Calling Demo

Demonstrates GPT-OSS-20B native tool calling with vLLM, using a calculus
helper MCP server for computation.

## Architecture

```
calculus-ui (Go) → calculus-gateway (Go) → calculus-agent (Python/FastAPI)
                                                    ↓
                                           calculus-helper MCP server
                                                    ↓
                                              GPT-OSS-20B (vLLM)
```

Three components following the
[fips-agents](https://github.com/redhat-ai-americas/agent-template) stack
pattern:

- **calculus-agent** — BaseAgent subclass with OpenAI-compatible HTTP server.
  Connects to the calculus-helper MCP server for tools. Uses GPT-OSS-20B
  directly via vLLM for native tool calling.
- **calculus-gateway** — Go reverse proxy speaking OpenAI `/v1/chat/completions`.
- **calculus-ui** — Minimal Go chat UI with thinking, tool call, and metrics
  display.

## Deployment

Each component deploys to OpenShift via Helm charts in `chart/`.

```bash
# Create namespace
oc new-project tool-calling-demo

# Build and deploy each component
cd calculus-agent && make build-openshift PROJECT=tool-calling-demo && make deploy PROJECT=tool-calling-demo
cd calculus-gateway && make build-openshift PROJECT=tool-calling-demo && make deploy PROJECT=tool-calling-demo
cd calculus-ui && make deploy PROJECT=tool-calling-demo
```

## Local Development

```bash
# Agent
cd calculus-agent && make install && make run-local

# Gateway (in another terminal)
cd calculus-gateway && BACKEND_URL=http://localhost:8080 go run ./cmd/server

# UI (in another terminal)
cd calculus-ui && API_URL=http://localhost:8080 go run ./cmd/server
# Open http://localhost:3000
```
