# Tool Calling Demo

A demonstration of **GPT-OSS-20B native tool calling** served by vLLM on
OpenShift. An AI calculus assistant uses MCP tools to solve derivatives,
integrals, limits, and differential equations — with full visibility into
the model's reasoning, tool invocations, and performance metrics.

## What this demonstrates

- **Native tool calling** — GPT-OSS-20B generates proper OpenAI-compatible
  `tool_calls` through vLLM, no framework-level tool injection needed.
- **MCP integration** — The agent discovers tools at startup from a
  calculus-helper MCP server via streamable-http transport.
- **Observable AI** — The chat UI surfaces everything a reviewer needs to
  see: the model's thinking/reasoning, each tool call with arguments and
  results, the final response, live performance metrics, and the raw API
  response for deep inspection.
- **Tunable generation** — Temperature, top-p, top-k, penalties, reasoning
  effort, and max tokens are all adjustable in the UI and forwarded
  per-request to vLLM.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  calculus-ui  │────▶│ calculus-gateway  │────▶│  calculus-agent   │
│   (Go, :3000) │     │   (Go, :8080)    │     │ (Python, :8080)  │
└──────────────┘     └──────────────────┘     └────────┬─────────┘
                                                       │
                                         ┌─────────────┼─────────────┐
                                         ▼                           ▼
                                ┌─────────────────┐       ┌──────────────────┐
                                │ calculus-helper  │       │   GPT-OSS-20B    │
                                │   MCP server    │       │   (vLLM, :443)   │
                                └─────────────────┘       └──────────────────┘
```

All inter-service communication uses the OpenAI `/v1/chat/completions`
contract (both sync JSON and SSE streaming). Any OpenAI-compatible client
can talk to the gateway directly.

### Components

**calculus-agent** — A
[BaseAgent](https://github.com/redhat-ai-americas/agent-template) subclass
wrapped in an OpenAI-compatible FastAPI server. Connects to the calculus MCP
server at startup, discovers its tools, and exposes them to the LLM. The
agent's `step()` method is a straightforward tool-calling loop: call the
model, execute any tool calls, feed results back, repeat until done.

**calculus-gateway** — A Go reverse proxy that speaks
`/v1/chat/completions` and `/v1/agent-info`. Handles SSE streaming with
immediate flush, health checks, and request logging. Sits between the UI
and the agent so the browser avoids CORS and the agent stays behind an
internal Service.

**calculus-ui** — A minimal Go binary serving embedded static files. The
frontend is vanilla JS with no build step. It renders:
- **Thinking panel** — collapsible, shows the model's `reasoning_content`
- **Tool call pills** — each tool invocation with name, arguments, status,
  and result (collapsible)
- **LaTeX math** — rendered via KaTeX for proper typeset equations
- **Stream metrics** — TTFT, thinking time, total time, token count, model
  calls, tool calls, and average inter-token latency
- **Raw response viewer** — `{ }` button on each response opens a modal
  with the complete SSE chunk stream for debugging and analysis
- **Settings panel** — gear icon opens a slide-out panel with:
  - Model info (name, defaults)
  - System prompt (read-only)
  - Tool list with descriptions and parameters (expandable)
  - Generation parameters: temperature, max tokens, top-p, top-k,
    frequency penalty, presence penalty, repetition penalty
  - Reasoning effort control (low / medium / high)

## How it was built

Each component was scaffolded using the
[fips-agents CLI](https://github.com/redhat-ai-americas/fips-agents-cli):

```bash
fips-agents create agent calculus-agent --local --no-git -y
fips-agents create gateway calculus-gateway --local --no-git -y
fips-agents create ui calculus-ui --local --no-git -y
```

The templates produce production-ready projects with Helm charts, Red Hat
UBI Containerfiles, health probes, OpenShift BuildConfigs, and Makefiles.
From there, customization was:

- **Agent**: replaced the example research assistant with a ~30-line
  `CalculusAssistant`, pointed `agent.yaml` at GPT-OSS-20B and the
  calculus MCP server, added an HTTP server entry point using
  `OpenAIChatServer`, and added a `/v1/agent-info` endpoint.
- **Gateway**: changed `BACKEND_URL` to the agent's Service, added a GET
  proxy for `/v1/agent-info`.
- **UI**: added KaTeX math rendering, stream metrics display, expandable
  tool call and thinking panels, a settings panel with generation parameter
  controls, and a raw API response viewer.

Two scaffolding bugs were found and filed
([rdwj/fips-agents-cli#8](https://github.com/rdwj/fips-agents-cli/issues/8),
[rdwj/fips-agents-cli#9](https://github.com/rdwj/fips-agents-cli/issues/9)):
Go import paths and Helm template helpers weren't updated during `create`.
See `CLI_AUDIT.md` for the full audit.

The long-term goal is for `fips-agents create` to handle more of this
wiring automatically — asking for the model endpoint, MCP server URLs, and
component names during scaffolding so that the three-component stack deploys
out of the box with zero manual edits.

## Deployment (OpenShift)

All three components deploy to a single namespace. Only the UI gets a
public Route; the gateway and agent communicate over internal Services.

```bash
# Create namespace
oc new-project tool-calling-demo

# Build each component on-cluster (binary builds)
cd calculus-agent  && oc start-build calculus-agent  --from-dir=. -n tool-calling-demo --follow
cd calculus-gateway && oc start-build calculus-gateway --from-dir=. -n tool-calling-demo --follow
cd calculus-ui     && oc start-build calculus-ui     --from-dir=. -n tool-calling-demo --follow

# Deploy via Helm
cd calculus-agent  && helm upgrade --install calculus-agent  chart/ -n tool-calling-demo --wait
cd calculus-gateway && helm upgrade --install calculus-gateway chart/ -n tool-calling-demo --wait
cd calculus-ui     && helm upgrade --install calculus-ui     chart/ -n tool-calling-demo --wait
```

The UI will be available at:
`https://calculus-ui-tool-calling-demo.apps.<cluster-domain>`

## Local development

```bash
# Agent (terminal 1)
cd calculus-agent && make install && make run-local

# Gateway (terminal 2)
cd calculus-gateway && BACKEND_URL=http://localhost:8080 go run ./cmd/server

# UI (terminal 3)
cd calculus-ui && API_URL=http://localhost:8080 go run ./cmd/server
# Open http://localhost:3000
```

## Configuration

Key environment variables for the agent (set via `agent.yaml` or OpenShift
ConfigMap):

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_ENDPOINT` | GPT-OSS-20B vLLM URL | LLM inference endpoint |
| `MODEL_NAME` | `openai/RedHatAI/gpt-oss-20b` | litellm model identifier |
| `MCP_CALCULUS_URL` | calculus-helper MCP URL | MCP server for tools |
| `OPENAI_API_KEY` | `not-required` | Required by litellm, any non-empty string works for unauthenticated endpoints |

### Per-request parameters

These can be adjusted in the UI settings panel and are sent per-request:

| Parameter | Range | Default | Notes |
|---|---|---|---|
| `temperature` | 0.0–2.0 | 0.3 | Controls randomness |
| `max_tokens` | 256–16384 | 4096 | Maximum response length |
| `top_p` | 0.0–1.0 | — | Nucleus sampling |
| `top_k` | 0–200 | — | Top-k sampling (0 = disabled) |
| `frequency_penalty` | -2.0–2.0 | 0 | Penalize repeated tokens by frequency |
| `presence_penalty` | -2.0–2.0 | 0 | Penalize tokens that have appeared |
| `repetition_penalty` | 0.5–2.0 | 1.0 | vLLM repetition penalty |
| `reasoning_effort` | low/medium/high | — | Controls thinking budget |

## API

**`GET /v1/agent-info`** — Returns model configuration, system prompt, and
discovered tool list (proxied through gateway and UI):

```json
{
  "model": { "name": "openai/RedHatAI/gpt-oss-20b", "temperature": 0.3, "max_tokens": 4096 },
  "system_prompt": "You are a Calculus Assistant...",
  "tools": [
    { "name": "differentiate", "description": "...", "parameters": {...} },
    { "name": "integrate", "description": "...", "parameters": {...} }
  ]
}
```

**`POST /v1/chat/completions`** — Standard OpenAI-compatible chat endpoint.
Accepts all sampling parameters listed above. Supports both sync JSON and
SSE streaming responses. Streaming responses include a final usage chunk
with `stream_metrics` (TTFT, inter-token latency, etc.).

## Related

- [rdwj/tool-calling-demo#1](https://github.com/rdwj/tool-calling-demo/issues/1) — Try routing through LlamaStack instead of direct vLLM
- [agent-template](https://github.com/redhat-ai-americas/agent-template) — The BaseAgent framework and templates
- [fips-agents CLI](https://github.com/redhat-ai-americas/fips-agents-cli) — Scaffolding tool for the templates
- [CLI_AUDIT.md](CLI_AUDIT.md) — Audit of fips-agents CLI gaps found during this build
