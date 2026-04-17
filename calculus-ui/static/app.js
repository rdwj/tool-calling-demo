"use strict";

// Conversation history sent to the agent each turn. Only user and
// assistant content are tracked; tool decisions / results are
// agent-internal details and don't round-trip through the client.
let messages = [];
let streaming = false;

// -- Settings panel state ---------------------------------------------------
let agentInfo = null;
let userTemperature = null;  // null = use server default
let userMaxTokens = null;
let userTopP = null;
let userTopK = null;
let userFreqPenalty = null;
let userPresencePenalty = null;
let userRepPenalty = null;
let userReasoningEffort = null;
let userApiBase = null;  // null = use default (direct vLLM)

async function loadAgentInfo() {
  try {
    const resp = await fetch("/v1/agent-info");
    if (!resp.ok) return;
    agentInfo = await resp.json();
    populateSettings();
  } catch (e) {
    console.warn("Could not load agent info:", e);
  }
}

function populateSettings() {
  if (!agentInfo) return;

  // Model name in header subtitle
  const modelNameEl = document.getElementById("model-name");
  if (modelNameEl && agentInfo.model) {
    // Show just the model's short name, e.g. "gpt-oss-20b" from "openai/RedHatAI/gpt-oss-20b"
    const parts = agentInfo.model.name.split("/");
    modelNameEl.textContent = parts[parts.length - 1];
  }

  // Model info section
  const modelInfoEl = document.getElementById("model-info");
  if (modelInfoEl && agentInfo.model) {
    modelInfoEl.innerHTML =
      '<div class="info-row"><span class="info-label">Name</span><span class="info-value">' +
      agentInfo.model.name.split("/").pop() + '</span></div>' +
      '<div class="info-row"><span class="info-label">Default Temperature</span><span class="info-value">' +
      agentInfo.model.temperature + '</span></div>' +
      '<div class="info-row"><span class="info-label">Default Max Tokens</span><span class="info-value">' +
      agentInfo.model.max_tokens + '</span></div>';
  }

  // Set parameter controls to defaults
  const tempSlider = document.getElementById("param-temperature");
  const tempValue = document.getElementById("temp-value");
  const maxTokensInput = document.getElementById("param-max-tokens");
  if (tempSlider && agentInfo.model) {
    tempSlider.value = agentInfo.model.temperature;
    tempValue.textContent = agentInfo.model.temperature;
  }
  if (maxTokensInput && agentInfo.model) {
    maxTokensInput.value = agentInfo.model.max_tokens;
  }

  const topPSlider = document.getElementById("param-top-p");
  const topPValue = document.getElementById("top-p-value");
  if (topPSlider) { topPValue.textContent = ""; }

  const freqSlider = document.getElementById("param-freq-penalty");
  const freqValue = document.getElementById("freq-penalty-value");
  if (freqSlider) { freqSlider.value = 0; freqValue.textContent = "0"; }

  const presSlider = document.getElementById("param-presence-penalty");
  const presValue = document.getElementById("presence-penalty-value");
  if (presSlider) { presSlider.value = 0; presValue.textContent = "0"; }

  const repSlider = document.getElementById("param-rep-penalty");
  const repValue = document.getElementById("rep-penalty-value");
  if (repSlider) { repSlider.value = 1; repValue.textContent = "1"; }

  // Backend selector
  const backendSelect = document.getElementById("param-backend");
  const responsesGroup = document.getElementById("responses-api-group");
  const responsesCheckbox = document.getElementById("param-responses-api");
  if (backendSelect && agentInfo.backends) {
    // Show/hide Responses API option based on LlamaStack availability
    if (agentInfo.backends.llamastack && agentInfo.backends.llamastack.responses_api) {
      responsesCheckbox.disabled = false;
      responsesGroup.querySelector(".param-hint").textContent = "";
    }
  }

  // System prompt
  const promptEl = document.getElementById("system-prompt");
  if (promptEl) {
    promptEl.textContent = agentInfo.system_prompt || "(none)";
  }

  // Tools list
  const toolsListEl = document.getElementById("tools-list");
  const toolsCountEl = document.getElementById("tools-count");
  if (toolsListEl && agentInfo.tools) {
    toolsCountEl.textContent = "(" + agentInfo.tools.length + ")";
    toolsListEl.innerHTML = "";
    for (const tool of agentInfo.tools) {
      const details = document.createElement("details");
      details.className = "tool-info";
      const summary = document.createElement("summary");
      summary.textContent = tool.name;
      details.appendChild(summary);
      const desc = document.createElement("p");
      desc.className = "tool-description";
      desc.textContent = tool.description;
      details.appendChild(desc);
      if (tool.parameters && tool.parameters.properties) {
        const params = document.createElement("div");
        params.className = "tool-params";
        const keys = Object.keys(tool.parameters.properties);
        params.textContent = "Parameters: " + keys.join(", ");
        details.appendChild(params);
      }
      toolsListEl.appendChild(details);
    }
  }
}

function setupSettings() {
  const btn = document.getElementById("settings-btn");
  const panel = document.getElementById("settings-panel");
  const overlay = document.getElementById("settings-overlay");
  const closeBtn = document.getElementById("settings-close");

  function toggle() {
    const open = panel.classList.toggle("open");
    overlay.classList.toggle("open", open);
  }

  if (btn) btn.addEventListener("click", toggle);
  if (closeBtn) closeBtn.addEventListener("click", toggle);
  if (overlay) overlay.addEventListener("click", toggle);

  // Temperature slider
  const tempSlider = document.getElementById("param-temperature");
  const tempValue = document.getElementById("temp-value");
  if (tempSlider) {
    tempSlider.addEventListener("input", function () {
      tempValue.textContent = this.value;
      userTemperature = parseFloat(this.value);
    });
  }

  // Max tokens input
  const maxTokensInput = document.getElementById("param-max-tokens");
  if (maxTokensInput) {
    maxTokensInput.addEventListener("change", function () {
      userMaxTokens = parseInt(this.value, 10) || null;
    });
  }

  // Top P slider
  const topPSlider = document.getElementById("param-top-p");
  const topPValue = document.getElementById("top-p-value");
  if (topPSlider) {
    topPSlider.addEventListener("input", function () {
      topPValue.textContent = this.value;
      userTopP = parseFloat(this.value) || null;
    });
  }

  // Top K
  const topKInput = document.getElementById("param-top-k");
  if (topKInput) {
    topKInput.addEventListener("change", function () {
      const v = parseInt(this.value, 10);
      userTopK = (v > 0) ? v : null;
    });
  }

  // Frequency penalty
  const freqSlider = document.getElementById("param-freq-penalty");
  const freqValue = document.getElementById("freq-penalty-value");
  if (freqSlider) {
    freqSlider.addEventListener("input", function () {
      freqValue.textContent = this.value;
      userFreqPenalty = parseFloat(this.value) || null;
    });
  }

  // Presence penalty
  const presSlider = document.getElementById("param-presence-penalty");
  const presValue = document.getElementById("presence-penalty-value");
  if (presSlider) {
    presSlider.addEventListener("input", function () {
      presValue.textContent = this.value;
      userPresencePenalty = parseFloat(this.value) || null;
    });
  }

  // Repetition penalty
  const repSlider = document.getElementById("param-rep-penalty");
  const repValue = document.getElementById("rep-penalty-value");
  if (repSlider) {
    repSlider.addEventListener("input", function () {
      repValue.textContent = this.value;
      const v = parseFloat(this.value);
      userRepPenalty = (v !== 1.0) ? v : null;
    });
  }

  // Reasoning effort
  const reasoningSelect = document.getElementById("param-reasoning");
  if (reasoningSelect) {
    reasoningSelect.addEventListener("change", function () {
      userReasoningEffort = this.value || null;
    });
  }

  // Backend selector
  const backendSelect = document.getElementById("param-backend");
  const responsesGroup = document.getElementById("responses-api-group");
  if (backendSelect) {
    backendSelect.addEventListener("change", function () {
      const val = this.value;
      if (val === "llamastack" && agentInfo && agentInfo.backends && agentInfo.backends.llamastack) {
        userApiBase = agentInfo.backends.llamastack.api_base;
        responsesGroup.style.display = "block";
      } else {
        userApiBase = null;
        responsesGroup.style.display = "none";
      }
    });
  }
}

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const chatEl = document.getElementById("chat");

async function init() {
  setupSettings();
  loadAgentInfo();
}

function appendMessage(role, content) {
  const el = document.createElement("div");
  el.classList.add("message", role);
  el.innerHTML = renderContent(content);
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function appendError(text) {
  const el = document.createElement("div");
  el.classList.add("message", "error");
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

function renderContent(text) {
  // Phase 0: Render LaTeX blocks directly to HTML via KaTeX.
  // We do this before HTML escaping so the TeX source isn't mangled.
  // The rendered HTML is stored as a placeholder and restored after
  // all markdown processing.
  var latexBlocks = [];
  // Display math: \[...\]
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, function (_, tex) {
    var idx = latexBlocks.length;
    var html;
    try {
      html = katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
      html = '<div class="katex-display-block">' + html + '</div>';
    } catch (e) {
      html = "\\[" + tex + "\\]";
    }
    latexBlocks.push(html);
    return "\x00LATEX" + idx + "\x00";
  });
  // Inline math: \(...\)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, function (_, tex) {
    var idx = latexBlocks.length;
    var html;
    try {
      html = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch (e) {
      html = "\\(" + tex + "\\)";
    }
    latexBlocks.push(html);
    return "\x00LATEX" + idx + "\x00";
  });

  // Escape HTML first
  var safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Phase 1: Extract code blocks so they aren't parsed for markdown.
  // Replace each code block with a placeholder token.
  var codeBlocks = [];
  safe = safe.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
    var idx = codeBlocks.length;
    codeBlocks.push("<pre><code>" + code.trimEnd() + "</code></pre>");
    return "\x00CODEBLOCK" + idx + "\x00";
  });

  // Phase 2: Extract inline code spans.
  var inlineCode = [];
  safe = safe.replace(/`([^`]+)`/g, function (_, code) {
    var idx = inlineCode.length;
    inlineCode.push("<code>" + code + "</code>");
    return "\x00INLINE" + idx + "\x00";
  });

  // Phase 3: Process block-level markdown on each line.
  var paragraphs = safe.split(/\n\n+/);
  var rendered = [];

  for (var p = 0; p < paragraphs.length; p++) {
    var para = paragraphs[p];

    if (/^\x00CODEBLOCK\d+\x00$/.test(para.trim())) {
      rendered.push(para.trim());
      continue;
    }

    var lines = para.split("\n");
    var out = [];
    var listType = null;
    var listItems = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      var ulMatch = /^(\-|\*) (.+)$/.exec(line);
      var olMatch = /^(\d+)\. (.+)$/.exec(line);

      if (ulMatch) {
        if (listType && listType !== "ul") {
          out.push("<" + listType + ">" + listItems.join("") + "</" + listType + ">");
          listItems = [];
        }
        listType = "ul";
        listItems.push("<li>" + processInline(ulMatch[2]) + "</li>");
        continue;
      }

      if (olMatch) {
        if (listType && listType !== "ol") {
          out.push("<" + listType + ">" + listItems.join("") + "</" + listType + ">");
          listItems = [];
        }
        listType = "ol";
        listItems.push("<li>" + processInline(olMatch[2]) + "</li>");
        continue;
      }

      if (listType) {
        out.push("<" + listType + ">" + listItems.join("") + "</" + listType + ">");
        listType = null;
        listItems = [];
      }

      var headerMatch = /^(#{1,3}) (.+)$/.exec(line);
      if (headerMatch) {
        var level = headerMatch[1].length;
        out.push("<h" + level + ">" + processInline(headerMatch[2]) + "</h" + level + ">");
        continue;
      }

      out.push(processInline(line));
    }

    if (listType) {
      out.push("<" + listType + ">" + listItems.join("") + "</" + listType + ">");
    }

    var joined = "";
    for (var j = 0; j < out.length; j++) {
      if (joined && !isBlockElement(out[j]) && !isBlockElement(out[j - 1 >= 0 ? j - 1 : 0])) {
        joined += "<br>";
      } else if (joined) {
        // no separator needed between block elements
      }
      joined += out[j];
    }

    rendered.push(joined);
  }

  var result;
  if (rendered.length === 1) {
    result = rendered[0];
  } else {
    var parts = [];
    for (var k = 0; k < rendered.length; k++) {
      if (isBlockElement(rendered[k])) {
        parts.push(rendered[k]);
      } else if (rendered[k].trim()) {
        parts.push("<p>" + rendered[k] + "</p>");
      }
    }
    result = parts.join("");
  }

  result = result.replace(/\x00CODEBLOCK(\d+)\x00/g, function (_, idx) {
    return codeBlocks[parseInt(idx, 10)];
  });
  result = result.replace(/\x00INLINE(\d+)\x00/g, function (_, idx) {
    return inlineCode[parseInt(idx, 10)];
  });
  result = result.replace(/\x00LATEX(\d+)\x00/g, function (_, idx) {
    return latexBlocks[parseInt(idx, 10)];
  });

  return result;
}

function processInline(text) {
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return text;
}

function isBlockElement(html) {
  if (!html) return false;
  return /^<(h[1-3]|ul|ol|pre|p|blockquote)[\s>]/.test(html)
      || /^\x00CODEBLOCK\d+\x00$/.test(html);
}

function setStreaming(value) {
  streaming = value;
  sendBtn.disabled = value;
  inputEl.disabled = value;
}

// -- Per-message stream renderer --------------------------------------------
// Encapsulates the four-phase rendering (thinking / tool calls / response /
// done) for a single assistant turn. Constructed when the user submits;
// fed delta events as they arrive; finalized on stream completion.

function createStreamRenderer(assistantEl) {
  let thinkingPanel = null;     // <details> element, lazy-created
  let thinkingContent = null;   // <div> inside thinkingPanel
  let toolCallsContainer = null;
  let responseEl = null;
  let responseText = "";
  let responseIndicator = null;
  let streamMetrics = null;     // server-sent metrics object
  let rawChunks = [];

  // Per-tool state: index -> { pillEl, nameEl, statusEl, argsEl, resultEl, args, name, callId }
  const toolCalls = new Map();

  function ensureThinkingPanel() {
    if (thinkingPanel) return;
    thinkingPanel = document.createElement("details");
    thinkingPanel.className = "thinking-panel";
    // Collapsed by default per design.
    const summary = document.createElement("summary");
    summary.textContent = "Thinking…";
    thinkingPanel.appendChild(summary);
    thinkingContent = document.createElement("div");
    thinkingContent.className = "thinking-content";
    thinkingPanel.appendChild(thinkingContent);
    assistantEl.appendChild(thinkingPanel);
  }

  function ensureToolCallsContainer() {
    if (toolCallsContainer) return;
    toolCallsContainer = document.createElement("div");
    toolCallsContainer.className = "tool-calls";
    assistantEl.appendChild(toolCallsContainer);
  }

  function ensureResponseEl() {
    if (responseEl) return;
    responseEl = document.createElement("div");
    responseEl.className = "response-content";
    responseIndicator = document.createElement("span");
    responseIndicator.className = "streaming-indicator";
    assistantEl.appendChild(responseEl);
    assistantEl.appendChild(responseIndicator);
  }

  function startToolCall(index, callId, name) {
    ensureToolCallsContainer();
    const pill = document.createElement("details");
    pill.className = "tool-call running";

    const header = document.createElement("summary");
    header.className = "tool-header";
    const icon = document.createElement("span");
    icon.className = "tool-icon";
    icon.textContent = "⚙";
    const nameEl = document.createElement("span");
    nameEl.className = "tool-name";
    nameEl.textContent = name;
    const statusEl = document.createElement("span");
    statusEl.className = "tool-status";
    statusEl.textContent = "running";
    header.appendChild(icon);
    header.appendChild(nameEl);
    header.appendChild(statusEl);

    const argsEl = document.createElement("pre");
    argsEl.className = "tool-args";
    argsEl.textContent = "";

    const resultEl = document.createElement("div");
    resultEl.className = "tool-result";
    resultEl.style.display = "none";

    pill.appendChild(header);
    pill.appendChild(argsEl);
    pill.appendChild(resultEl);
    toolCallsContainer.appendChild(pill);

    toolCalls.set(index, {
      pillEl: pill,
      nameEl,
      statusEl,
      argsEl,
      resultEl,
      args: "",
      name,
      callId,
    });
    scrollToBottom();
  }

  function appendToolArgs(index, argsDelta) {
    const tc = toolCalls.get(index);
    if (!tc) return;
    tc.args += argsDelta;
    tc.argsEl.textContent = tc.args;
    scrollToBottom();
  }

  function completeToolCall(callId, content, isError) {
    // Find the matching tool call by call_id.
    let match = null;
    for (const tc of toolCalls.values()) {
      if (tc.callId === callId) { match = tc; break; }
    }
    if (!match) return;
    match.pillEl.classList.remove("running");
    match.pillEl.classList.add(isError ? "error" : "done");
    match.statusEl.textContent = isError ? "error" : "done";
    match.resultEl.style.display = "block";
    match.resultEl.textContent = content;
    scrollToBottom();
  }

  function appendThinking(text) {
    ensureThinkingPanel();
    thinkingContent.textContent += text;
    scrollToBottom();
  }

  function appendContent(text) {
    ensureResponseEl();
    responseText += text;
    responseEl.innerHTML = renderContent(responseText);
    // Re-attach indicator (re-render replaced it)
    if (responseIndicator && !responseEl.contains(responseIndicator)) {
      // indicator lives as sibling, not inside responseEl, so this is OK
    }
    scrollToBottom();
  }

  function setMetrics(metrics, usage) {
    streamMetrics = { ...metrics, usage };
  }

  function finalize(clientTtft) {
    // Remove the streaming cursor.
    if (responseIndicator && responseIndicator.parentNode) {
      responseIndicator.parentNode.removeChild(responseIndicator);
    }
    // Mark thinking panel as no longer pulsing.
    if (thinkingPanel) {
      thinkingPanel.classList.add("done");
    }
    // KaTeX math is rendered inline during renderContent() via
    // katex.renderToString(). No post-pass needed.
    // If there was no response content (e.g. tool-only turn), make
    // that visible rather than leaving a blank message.
    if (!responseText.trim() && !toolCalls.size && !thinkingPanel) {
      assistantEl.textContent = "(no response)";
    }

    // Render metrics bar if we have data.
    const m = streamMetrics;
    if (!m) return;

    const bar = document.createElement("div");
    bar.className = "stream-metrics";

    const items = [];
    const ttft = m.time_to_first_content ?? clientTtft;
    if (ttft != null) items.push(["TTFT", ttft.toFixed(1) + "s"]);
    if (m.time_to_first_reasoning != null) items.push(["Thinking", m.time_to_first_reasoning.toFixed(1) + "s"]);
    if (m.total_time != null) items.push(["Total", m.total_time.toFixed(1) + "s"]);
    if (m.usage && m.usage.total_tokens != null) items.push(["Tokens", m.usage.total_tokens.toLocaleString()]);
    if (m.model_calls != null) items.push(["Model calls", m.model_calls]);
    if (m.tool_calls != null) items.push(["Tool calls", m.tool_calls]);
    if (m.inter_token_latencies && m.inter_token_latencies.length > 0) {
      const sum = m.inter_token_latencies.reduce(function (a, b) { return a + b; }, 0);
      const avg = sum / m.inter_token_latencies.length;
      items.push(["Avg ITL", (avg * 1000).toFixed(0) + "ms"]);
    }

    for (var i = 0; i < items.length; i++) {
      var span = document.createElement("span");
      span.className = "metric";
      span.innerHTML = '<span class="metric-label">' + items[i][0] + '</span>'
        + '<span class="metric-value">' + items[i][1] + '</span>';
      bar.appendChild(span);
    }

    assistantEl.appendChild(bar);

    // Raw API response button
    const rawBtn = document.createElement("button");
    rawBtn.className = "raw-response-btn";
    rawBtn.textContent = "{ }";
    rawBtn.title = "View raw API response";
    rawBtn.addEventListener("click", function () {
      showRawResponse(rawChunks);
    });
    assistantEl.appendChild(rawBtn);
  }

  function pushRawChunk(chunk) {
    rawChunks.push(chunk);
  }

  return {
    handleDelta(delta) {
      // Reasoning ("thinking") phase
      if (delta.reasoning_content) {
        appendThinking(delta.reasoning_content);
      }
      // Tool call deltas (decisions made by the model)
      if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          // First delta for this index brings id+name.
          if (tc.id && !toolCalls.has(idx)) {
            const name = (tc.function && tc.function.name) || "tool";
            startToolCall(idx, tc.id, name);
            // Some chunks include initial args along with id+name.
            const initialArgs = tc.function && tc.function.arguments;
            if (initialArgs) appendToolArgs(idx, initialArgs);
          } else if (tc.function && tc.function.arguments) {
            appendToolArgs(idx, tc.function.arguments);
          }
        }
      }
      // Tool execution result (role:"tool" message in the stream)
      if (delta.role === "tool" && delta.tool_call_id) {
        completeToolCall(delta.tool_call_id, delta.content || "", false);
      }
      // Assistant content (the user-visible response)
      if (delta.content && delta.role !== "tool") {
        appendContent(delta.content);
      }
      // delta.role === "assistant" with no other fields is a role
      // announcement we can safely ignore.
    },
    finalize,
    setMetrics,
    getResponseText: () => responseText,
    pushRawChunk,
    getRawChunks: () => rawChunks,
  };
}

function showRawResponse(chunks) {
  let modal = document.getElementById("raw-response-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "raw-response-modal";
    modal.className = "raw-modal";
    modal.innerHTML = '<div class="raw-modal-content">' +
      '<div class="raw-modal-header"><h3>Raw API Response</h3><button class="raw-modal-close">&times;</button></div>' +
      '<pre class="raw-modal-body"></pre></div>';
    document.body.appendChild(modal);
    modal.querySelector(".raw-modal-close").addEventListener("click", function () {
      modal.classList.remove("open");
    });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.classList.remove("open");
    });
  }
  const body = modal.querySelector(".raw-modal-body");
  body.textContent = JSON.stringify(chunks, null, 2);
  modal.classList.add("open");
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || streaming) return;

  inputEl.value = "";
  autoResize();
  appendMessage("user", text);
  messages.push({ role: "user", content: text });

  // Build the assistant message container and a renderer that owns it.
  const assistantEl = document.createElement("div");
  assistantEl.classList.add("message", "assistant");
  messagesEl.appendChild(assistantEl);
  scrollToBottom();

  const renderer = createStreamRenderer(assistantEl);
  const requestStart = performance.now();
  let clientTtft = null;

  setStreaming(true);

  try {
    const reqBody = { messages: messages, stream: true };
    if (userTemperature !== null) reqBody.temperature = userTemperature;
    if (userMaxTokens !== null) reqBody.max_tokens = userMaxTokens;
    if (userTopP !== null) reqBody.top_p = userTopP;
    if (userTopK !== null) reqBody.top_k = userTopK;
    if (userFreqPenalty !== null) reqBody.frequency_penalty = userFreqPenalty;
    if (userPresencePenalty !== null) reqBody.presence_penalty = userPresencePenalty;
    if (userRepPenalty !== null) reqBody.repetition_penalty = userRepPenalty;
    if (userReasoningEffort !== null) reqBody.reasoning_effort = userReasoningEffort;
    if (userApiBase !== null) reqBody.api_base = userApiBase;

    const resp = await fetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    if (!resp.ok) {
      throw new Error("API returned " + resp.status + ": " + resp.statusText);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE messages are separated by blank lines (\n\n). A single
      // ``data:`` line may also be split across read() boundaries, so
      // we keep any incomplete trailing line in the buffer.
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // skip malformed
        }

        renderer.pushRawChunk(parsed);

        // Surface backend errors that arrive mid-stream.
        if (parsed.error) {
          appendError("Stream error: " + (parsed.error.message || "unknown"));
          continue;
        }

        // Detect metrics chunk (empty choices array + stream_metrics).
        if (parsed.stream_metrics) {
          renderer.setMetrics(parsed.stream_metrics, parsed.usage);
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (delta) {
          // Record client-side TTFT on first content delta.
          if (delta.content && clientTtft === null) {
            clientTtft = (performance.now() - requestStart) / 1000;
          }
          renderer.handleDelta(delta);
        }
      }
    }
  } catch (err) {
    if (!renderer.getResponseText()) {
      assistantEl.remove();
      appendError("Error: " + err.message);
      setStreaming(false);
      return;
    }
  }

  renderer.finalize(clientTtft);
  const finalText = renderer.getResponseText();
  if (finalText) {
    messages.push({ role: "assistant", content: finalText });
  }
  setStreaming(false);
  inputEl.focus();
}

function autoResize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
}

document.getElementById("input-form").addEventListener("submit", function (e) {
  e.preventDefault();
  sendMessage();
});

inputEl.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener("input", autoResize);

init();
