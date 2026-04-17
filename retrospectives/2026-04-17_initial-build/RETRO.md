# Retrospective: Tool Calling Demo — Initial Build

**Date:** 2026-04-17
**Effort:** Build and deploy a three-component demo showcasing GPT-OSS-20B native tool calling with vLLM, including a calculus MCP server, observable UI, and LlamaStack integration.
**Issues:** rdwj/tool-calling-demo#1
**Commits:** 74ef3d1..2c47df2 (23 commits)

## What We Set Out To Do

Deploy a demo on the mcp-rhoai OpenShift cluster:
- UI → gateway → agent stack using `fips-agents create`
- GPT-OSS-20B with native tool calling (not LlamaStack tool injection)
- Calculus helper MCP server for computation tools
- UI showing tool calls, thinking, and output

## What Changed

| Change | Type | Rationale |
|--------|------|-----------|
| KaTeX math rendering added to UI | Scope expansion | Model outputs LaTeX; raw delimiters unreadable |
| Settings panel with full param controls | Scope expansion | Reviewers need to see and tune config |
| Raw API response viewer | Scope expansion | Needed for debugging and analysis |
| LlamaStack backend toggle | Good pivot | Opportunity to compare direct vLLM vs LlamaStack in-session |
| Responses API translator | Good pivot | LlamaStack got Responses API enabled mid-session |
| Vendored fipsagents into build context | Workaround | PyPI 0.4.0 missing server/streaming; build pods air-gapped |
| Filed 8 issues on upstream template repos | Process win | Captured scaffolding bugs and port-back items immediately |
| MCP tool result fix (repr → text) | Bug fix found | `_register_mcp_tool` was calling `str()` on `CallToolResult` |
| System prompt strengthened for tool usage | Scope adjustment | Model was skipping tools on multi-step problems |

## What Went Well

- **`fips-agents create` got us 80% there** despite scaffolding bugs. Three commands produced three deployable projects with Helm charts, Containerfiles, and Makefiles.
- **Iterative deploy loop was tight.** Build → deploy → test → fix cycles were fast once the BuildConfig pattern was established.
- **CLI audit and upstream port docs written in-session.** `CLI_AUDIT.md` (3 bugs, 5 missing features) and `UPSTREAM_PORT.md` (13 features categorized) were not deferred. 8 issues filed across 4 repos.
- **The MCP tool result fix** is a real upstream bug. The vendored fix in this demo is the reference implementation for redhat-ai-americas/agent-template#65.
- **Responses API translator was clean.** The SSE event mapping is straightforward; multi-turn tool loops work.
- **11 of 23 commits were fixes, but 5 of those were scaffolding bugs** (Go imports, Helm helpers) — not our code.

## Gaps Identified

| Gap | Severity | Resolution |
|-----|----------|------------|
| PyPI fipsagents 0.4.0 is stale — missing server, events, streaming | Fix now | redhat-ai-americas/agent-template#64 |
| MCP tool result shows repr instead of text content | Fix now | redhat-ai-americas/agent-template#65 |
| No tests for Responses API translator | Follow-up | rdwj/tool-calling-demo#2 |
| No stream metrics on Responses API path | Follow-up | rdwj/tool-calling-demo#3 |
| KaTeX rendering unconfirmed in browser | Accept | Switched from auto-render to `renderToString`; should work but needs visual check |
| No automated tests for any UI changes | Accept | Template-level concern; vanilla JS has no test framework |
| Vendored fipsagents will drift from upstream | Follow-up | Remove once PyPI is current (blocked by #64) |
| Go import path + Helm helper scaffolding bugs | Fix now | rdwj/fips-agents-cli#8, rdwj/fips-agents-cli#9 |

## Action Items

- [x] File PyPI staleness issue — redhat-ai-americas/agent-template#64
- [x] File MCP tool result fix — redhat-ai-americas/agent-template#65
- [x] File Responses API test coverage — rdwj/tool-calling-demo#2
- [x] File Responses API metrics — rdwj/tool-calling-demo#3
- [x] Update rdwj/tool-calling-demo#1 with LlamaStack toggle status
- [x] File upstream port issues — redhat-ai-americas/ui-template#8-12, gateway-template#6, agent-template#62-63
- [x] File CLI scaffolding bugs — rdwj/fips-agents-cli#8, #9

## Patterns

**Start:**
- Test scaffolded projects immediately after `fips-agents create` — the Go import and Helm bugs cost ~30 minutes of rebuild cycles
- When vendoring a package, pin to a specific commit hash, not just "copy from main"

**Stop:**
- Assuming PyPI packages match the dev branch — check the wheel contents before depending on unreleased features

**Continue:**
- Writing CLI audits and upstream port analyses in-session rather than deferring
- Filing issues as bugs are found, not batching them for later
- Using the three-component stack pattern — it proved out cleanly
