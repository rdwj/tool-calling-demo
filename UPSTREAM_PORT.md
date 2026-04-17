# Feature Port Analysis: tool-calling-demo -> Upstream Templates

Comparison of the calculus-demo UI/gateway/agent against the upstream
ui-template, gateway-template, and fipsagents package to identify features
that should be ported back.

---

## 1. Port to ui-template

### 1.1 Settings panel (sidebar drawer)

A slide-out settings panel showing model info, tunable sampling parameters,
the active system prompt, and the registered tool list. Accessible via a gear
icon in the header.

- **Files changed:** `calculus-ui/static/index.html` (added `<aside>`,
  overlay div, settings button in header), `calculus-ui/static/style.css`
  (`.settings-panel`, `.settings-overlay`, `.header-row`, `.param-group`,
  `.tool-info`, etc.), `calculus-ui/static/app.js` (`setupSettings()`,
  `populateSettings()`, all slider/input event handlers)
- **Dependencies:** Requires the `/v1/agent-info` endpoint (see sections 2.1
  and 3.1). Without the endpoint the panel just stays empty, so the UI change
  is safe to ship independently with a graceful fallback.
- **Self-contained:** Mostly. The HTML/CSS/JS changes are all within the
  static assets. The panel gracefully degrades if the backend doesn't
  implement `/v1/agent-info`.
- **Suggested issue title:** `ui-template: Add settings panel with model info, parameters, and tools`

### 1.2 Collapsible tool-call pills

In the upstream template, tool-call pills are plain `<div>` elements --
the args and result are always visible. The demo changes them to `<details>`
elements so users can collapse/expand individual tool calls.

- **Files changed:** `calculus-ui/static/app.js` (`startToolCall()` --
  changed `document.createElement("div")` to `document.createElement("details")`
  for the pill, and `"div"` to `"summary"` for the header),
  `calculus-ui/static/style.css` (`.tool-header` gains `cursor: pointer`,
  `user-select: none`, `list-style: none`; new rules for `::marker`,
  `::-webkit-details-marker`, `::before` arrow rotation on
  `.tool-call[open]`)
- **Dependencies:** None.
- **Self-contained:** Yes.
- **Suggested issue title:** `ui-template: Make tool-call pills collapsible with <details>/<summary>`

### 1.3 Stream metrics bar

After each assistant turn completes, a metrics bar is rendered showing TTFT,
total time, token count, model call count, tool call count, and average
inter-token latency.

- **Files changed:** `calculus-ui/static/app.js` (`setMetrics()` and
  `finalize()` in `createStreamRenderer`; SSE parsing now detects
  `parsed.stream_metrics` chunks), `calculus-ui/static/style.css`
  (`.stream-metrics`, `.metric`, `.metric-label`, `.metric-value`)
- **Dependencies:** The upstream fipsagents SSE serializer already emits
  `stream_metrics` chunks. The gateway already relays them transparently.
  The only missing piece is the UI consuming them.
- **Self-contained:** Yes -- the data is already on the wire; this is
  purely a UI addition.
- **Suggested issue title:** `ui-template: Display stream metrics (TTFT, tokens, latency) after each turn`

### 1.4 Raw API response viewer

A `{ }` button appears below each assistant message's metrics bar. Clicking
it opens a modal showing the raw SSE JSON chunks that arrived during that
turn.

- **Files changed:** `calculus-ui/static/app.js` (`pushRawChunk()`,
  `getRawChunks()`, `showRawResponse()`, and the modal creation logic in
  `finalize()`), `calculus-ui/static/style.css` (`.raw-response-btn`,
  `.raw-modal`, `.raw-modal-content`, `.raw-modal-header`,
  `.raw-modal-close`, `.raw-modal-body`)
- **Dependencies:** None beyond the stream metrics feature (which provides
  the natural location for the button). Could ship independently.
- **Self-contained:** Yes.
- **Suggested issue title:** `ui-template: Add raw API response viewer per message`

### 1.5 KaTeX math rendering

Inline (`\(...\)`) and display (`\[...\]`) LaTeX math is rendered via KaTeX
before markdown processing. Rendered KaTeX HTML is stored as placeholders
and restored after all escaping and markdown transforms.

- **Files changed:** `calculus-ui/static/index.html` (KaTeX CSS and JS CDN
  links), `calculus-ui/static/app.js` (`renderContent()` -- Phase 0 added
  before HTML escaping; LaTeX placeholder/restore logic),
  `calculus-ui/static/style.css` (`.katex-display-block`,
  `.response-content .katex`)
- **Dependencies:** External CDN dependency (katex@0.16.21). The template
  should conditionally load KaTeX only when needed, or document the CDN
  dependency.
- **Self-contained:** Yes, though agents that never produce math don't need
  the overhead. Consider making KaTeX opt-in via a flag or lazy-loading it
  on first math detection.
- **Suggested issue title:** `ui-template: Add KaTeX math rendering for LaTeX in responses`

### 1.6 Client-side parameter overrides sent to backend

The `sendMessage()` function now builds the request body dynamically,
attaching any non-null parameter overrides (temperature, max_tokens, top_p,
top_k, frequency_penalty, presence_penalty, repetition_penalty,
reasoning_effort) that the user configured via the settings panel.

- **Files changed:** `calculus-ui/static/app.js` (global state variables
  for each parameter; the `reqBody` construction in `sendMessage()`)
- **Dependencies:** Requires the fipsagents server to accept these fields
  (see section 4.1). The gateway passes them through transparently.
- **Self-contained:** Coupled with the settings panel (1.1) and the server
  parameter forwarding (4.1).
- **Suggested issue title:** `ui-template: Forward user-configured sampling parameters in chat requests`

### 1.7 Model name display in header

The header shows the active model's short name (e.g. "gpt-oss-20b") as a
subtitle below the agent title, populated from `/v1/agent-info`.

- **Files changed:** `calculus-ui/static/index.html` (`<span id="model-name"
  class="model-subtitle">`), `calculus-ui/static/style.css`
  (`.model-subtitle`, `.header-row`), `calculus-ui/static/app.js`
  (`populateSettings()`)
- **Dependencies:** Requires `/v1/agent-info`.
- **Self-contained:** Part of the settings panel feature (1.1). Could be
  ported as part of that or independently.
- **Suggested issue title:** (Covered by 1.1)

### 1.8 Client-side TTFT measurement

The client records `performance.now()` at request start and calculates
client-side TTFT when the first content delta arrives. This is used as a
fallback if the server doesn't provide `time_to_first_content`.

- **Files changed:** `calculus-ui/static/app.js` (`requestStart`,
  `clientTtft` variables in `sendMessage()`; `finalize(clientTtft)` call)
- **Dependencies:** None.
- **Self-contained:** Yes.
- **Suggested issue title:** (Covered by 1.3 -- part of metrics display)

---

## 2. Port to gateway-template

### 2.1 Proxy `/v1/agent-info` endpoint

The gateway adds a `GET /v1/agent-info` route that proxies transparently
to the backend agent's `/v1/agent-info` endpoint.

- **Files changed:** `calculus-gateway/cmd/server/main.go` (added
  `mux.HandleFunc("GET /v1/agent-info", ...)` with `io.Copy` relay)
- **Dependencies:** Requires the backend agent to implement `/v1/agent-info`
  (see section 3.1).
- **Self-contained:** Yes -- a single `HandleFunc` addition.
- **Suggested issue title:** `gateway-template: Add /v1/agent-info proxy route`

---

## 3. Port to agent-template (server)

### 3.1 `/v1/agent-info` endpoint on OpenAIChatServer

The agent's `server.py` adds a `GET /v1/agent-info` endpoint that returns
the model config (name, temperature, max_tokens), the system prompt, and
a list of LLM-callable tools with their names, descriptions, and parameter
schemas.

- **Files changed:** `calculus-agent/src/server.py` (the `@server.app.get`
  decorator and `agent_info()` handler)
- **Dependencies:** Uses `server._agent` (private attribute), accesses
  `agent.messages`, `agent.tools.get_llm_tools()`, `agent.config.model`.
  These are all stable BaseAgent APIs.
- **Self-contained:** The endpoint logic itself is simple, but the question
  is where it belongs. It should be a built-in route on
  `OpenAIChatServer._register_routes()` rather than requiring every agent
  to add it manually in `server.py`.
- **Suggested issue title:** `fipsagents: Add built-in /v1/agent-info endpoint to OpenAIChatServer`

---

## 4. Port to fipsagents package

### 4.1 Extended `ChatCompletionRequest` with sampling parameter fields

The demo's vendored fipsagents copy extends `ChatCompletionRequest` with
`top_p`, `top_k`, `frequency_penalty`, `presence_penalty`,
`repetition_penalty`, `reasoning_effort`, `logprobs`, and `top_logprobs`
fields. It also adds `_extract_overrides()` to split standard OpenAI params
from vLLM-specific params (forwarded via `extra_body`), and threads the
overrides through `_collect_sync()` and `_stream()`.

- **Files changed:** `calculus-agent/packages/fipsagents/src/fipsagents/server/__init__.py`
  (8 new fields on `ChatCompletionRequest`, new `_extract_overrides()`
  method, `overrides` kwarg on `_collect_sync()` and `_stream()`,
  `**overrides` passed to `agent.astep_stream()`)
- **Dependencies:** Requires `BaseAgent.astep_stream()` to accept `**kwargs`
  and forward them to `call_model()`. The upstream agent already does this.
- **Self-contained:** Yes. This is a pure server-layer change.
- **Suggested issue title:** `fipsagents: Accept extended sampling parameters (top_p, top_k, penalties, reasoning_effort) in OpenAIChatServer`

### 4.2 Built-in `/v1/agent-info` route

Rather than each agent defining this endpoint manually (as the demo does
in `server.py`), this should be a standard route registered by
`OpenAIChatServer._register_routes()`.

- **Files changed:** Would modify
  `packages/fipsagents/src/fipsagents/server/__init__.py`
- **Dependencies:** None beyond existing BaseAgent APIs.
- **Self-contained:** Yes.
- **Suggested issue title:** (Same as 3.1 -- `fipsagents: Add built-in /v1/agent-info endpoint to OpenAIChatServer`)

---

## 5. Demo-specific

### 5.1 "Calculus Assistant" branding

The page title, header text, and meta tags say "Calculus Assistant". This is
demo-specific naming.

- **Files changed:** `calculus-ui/static/index.html` (`<title>`,
  `<h1>` text)
- **Self-contained:** N/A
- **Notes:** The upstream template uses the placeholder "ui-template", which
  deployers replace during scaffolding. No action needed.

### 5.2 Calculus-specific tools and agent logic

The agent subclass, its tools (derivatives, integrals, etc.), the system
prompt, and the `agent.yaml` config are all calculus-domain-specific.

- **Files changed:** `calculus-agent/src/agent.py`,
  `calculus-agent/tools/*.py`, `calculus-agent/prompts/*.md`,
  `calculus-agent/agent.yaml`
- **Notes:** These are the demo payload. Nothing to port.

### 5.3 Vendored fipsagents package inside the demo

The demo vendors its own copy of fipsagents at
`calculus-agent/packages/fipsagents/` with the extended server. Once the
upstream package absorbs the changes (sections 4.1 and 4.2), this vendored
copy becomes unnecessary.

- **Notes:** Cleanup task after porting. Not a feature to port.

---

## Summary: Recommended port order

The changes have natural dependency chains. Recommended sequencing:

1. **fipsagents package** (4.1, 4.2) -- extend ChatCompletionRequest and
   add `/v1/agent-info`. These are the foundation.
2. **gateway-template** (2.1) -- add the `/v1/agent-info` proxy route.
   Trivial one-liner once the backend endpoint exists.
3. **ui-template** (1.2) -- collapsible tool calls. Zero dependencies,
   immediate UX win.
4. **ui-template** (1.3, 1.4, 1.8) -- stream metrics bar + raw response
   viewer. The data is already on the wire; this is pure UI.
5. **ui-template** (1.1, 1.6, 1.7) -- settings panel with parameter
   controls. Depends on `/v1/agent-info` and extended request fields.
6. **ui-template** (1.5) -- KaTeX rendering. Independent but has an external
   CDN dependency to consider. May warrant an opt-in mechanism.
