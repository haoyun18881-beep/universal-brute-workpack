---
name: ubw-research
description: Use Universal Brute Workpack for web research, page fetching, memory lookup, or evidence recall. Trigger when Codex should search the web through UBW, fetch a URL, query UBW memory, recall prior evidence, or gather sourced context without loading the whole UBW tool manual.
---

# UBW Research

Use the `ubw` MCP server when available.

Preferred tools:

- `search.web` for web search with provider fallback.
- `search.fetch` for fetching a specific URL or search result.
- `memory.search` for local/vector memory lookup.
- `memory.recall` for prior evidence or conversation recall.

Keep outputs sourced and compact. UBW memory fallback is a general evidence path; use project-specific memory skills when the task specifically depends on OpenClaw or another named memory source. Do not paste secrets, tokens, cookies, or full private config values. If the UBW server is unavailable, say that and use the normal available research path.
