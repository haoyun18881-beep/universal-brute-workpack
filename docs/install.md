# Install

Universal Brute Workpack is stdio-first. Most MCP clients can auto-start it with `npx`.

## Codex

Direct MCP setup:

```toml
[mcp_servers.universal_brute_workpack]
command = "npx"
args = ["-y", "universal-brute-workpack", "serve", "--stdio"]
```

This gives Codex the UBW tools, but it does not make UBW appear as a plugin card or `@` plugin entry.

Optional Codex plugin wrapper:

```bash
codex plugin marketplace add <path-or-repo-root-containing-.agents/plugins/marketplace.json>
codex plugin add universal-brute-workpack@universal-brute-workpack
```

The wrapper is declared in `.agents/plugins/marketplace.json` and lives at `plugins/universal-brute-workpack/`. It launches the same npm MCP server with `npx universal-brute-workpack@0.1.3 serve --stdio --profile admin` and includes the companion skills.

Important: this plugin layer is manual. npm install or `npx` does not automatically register a Codex plugin for every user, and official marketplace curation is not required for self-distribution. If your Codex build exposes plugin installation through the app UI instead of the CLI, add this repository marketplace there. After installing or enabling the wrapper in Codex, start a new thread before expecting `@Universal Brute Workpack` or the MCP tools to appear.

## Claude Desktop / Cursor / Cline / Continue

Use the JSON files in `examples/`.

## Optional Environment

Copy `.env.example` to `.env` for local development, or set env vars in your MCP client.

No key is required for first run. `search.web` falls back to DuckDuckGo when `TAVILY_API_KEY` and `EXA_API_KEY` are unset. `memory.search` falls back to local text/JSON/Markdown/log search when `UBW_MEMORY_URL` is unset.

For more control, copy `config/universal-brute-workpack.example.json` and set `UBW_CONFIG` to that file. Tool allow/deny choices live in `config/profiles.example.json`; copy it and set `UBW_PROFILES` if you want a custom boundary.

## Optional Codex Companion Skills

The package includes short Codex skills under `integrations/codex-skills/`. They do not change the MCP server; they teach Codex when to use the right subset of UBW tools.

From a cloned repo or unpacked npm tarball:

```powershell
Copy-Item -Recurse .\integrations\codex-skills\ubw-* "$env:USERPROFILE\.codex\skills\"
```

Skill groups:

- `ubw-research`: `search.web`, `search.fetch`, `memory.search`, `memory.recall`
- `ubw-files`: `fs.glob`, `fs.grep`, `fs.list`, `file.read`, `worker.analyze`, `worker.diff`
- `ubw-edit`: `file.write`, `file.copy`, `file.move`, `code.patch`
- `ubw-code`: `code.review`, `validate.*`, `command.exec`
- `ubw-audit`: `audit.prepare`, `audit.ingest_report`, `audit.run`, `audit.collect`
- `ubw-agent`: `agent.spawn`, `agent.pipeline`

`agent.spawn` and `agent.pipeline` require an OpenAI-compatible backend:

```text
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
```

Pipeline controls are config-driven:

```text
UBW_AGENT_MAX_PIPELINE_TASKS=100
UBW_AGENT_CONCURRENCY=20
UBW_AGENT_STAGGER_MS=0
UBW_AGENT_TASK_TIMEOUT_MS=300000
```

## First-Run Verify

```bash
npx -y universal-brute-workpack doctor
```

Healthy first run should show:

- `version: "0.1.3"`
- `tools.count: 26`
- `profile: "admin"` unless you selected another profile
- `worker_pool.enabled: true`
- `sidecar.mode: "managed"`

It is normal for `llm_base_url` to be false before you configure a model endpoint. In that state, local tools work and Agent tools return `not_configured` instead of crashing.

## License

Universal Brute Workpack uses BUSL-1.1. Personal, academic, research, and small non-commercial use are free. Enterprise production use, commercial services, SaaS, hosted MCP services, Agent platforms, marketplace redistribution, OEM/white-label use, and commercial derivatives require written authorization before the Change Date.

Change License: Apache License v2.0. Change Date: 2030-06-29.

## SSE Mode

SSE is optional for clients that prefer a long-running local service:

```powershell
npx -y universal-brute-workpack serve --transport sse --port 18890 --profile admin
```
