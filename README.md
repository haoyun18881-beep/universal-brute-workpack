# Universal Brute Workpack

[![npm version](https://img.shields.io/npm/v/universal-brute-workpack.svg)](https://www.npmjs.com/package/universal-brute-workpack)
[![npm downloads](https://img.shields.io/npm/dm/universal-brute-workpack.svg)](https://www.npmjs.com/package/universal-brute-workpack)
[![license: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](./LICENSE)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

Universal Brute Workpack is a full-capability, stdio-first Agent MCP workpack.

It is meant to be usable by Codex, OpenClaw, Claude Desktop, Cursor, Cline, Continue, or any other MCP client that can speak stdio, Streamable HTTP, or legacy SSE.

It turns an Agent client into a local-first workbench: files, CPU-parallel grep, rollback-aware patching, commands, web search fallback, memory recall fallback, and model-backed Agent tasks behind one MCP server.

## Why It Exists

Most Agent clients are strongest when they judge, decide, and close the loop. They are weaker, slower, or more expensive when they personally do every repetitive search, log scan, candidate implementation, and audit pass.

Universal Brute Workpack is designed to move that bulk work out of the main Agent thread:

- Local tools do zero-token work on the user's machine.
- The worker pool uses the user's available CPU parallelism by default, so big machines are allowed to be fast.
- Cheap API models can handle wide exploratory batches.
- Expensive/pro subscription Agents can stay focused on planning, review, and final decisions.
- Host-mediated audit flows can let subscription Agents such as Codex Pro or other Agent IDEs act as the control plane for their own native subagents or threads.

The goal is not to replace the main Agent. The goal is to make one strong Agent feel like a coordinated workbench.

## Who Should Use This

| User | What It Gives You |
| --- | --- |
| Codex Pro users | Keep the strong main thread for planning/review while local tools and cheap API workers handle bulk work. |
| Cursor / Cline / Continue users | Add search, grep, file operations, command execution, memory fallback, and Agent tasks through one MCP package. |
| Claude Desktop users | Get a local workbench for files, search, validation, and command execution without stitching many MCP servers together. |
| OpenClaw users | Package the useful SC-style tool and orchestration ideas into a portable MCP server, without binding them to one machine. |
| Solo builders and small teams | Run local workers and evidence collection on your own computer before paying for cloud services. |

## Why Not Just Use X

| Option | Good At | Missing Compared With UBW |
| --- | --- | --- |
| Filesystem MCP | File read/write | No web search, command execution, memory fallback, Agent pipeline, CPU worker pool, or patch rollback. |
| Context7 | Documentation lookup | Not a general local workbench; no file/code/command pipeline. |
| Playwright MCP | Browser automation | Not a local file/search/code/Agent workpack. |
| Exa/Tavily MCP | Web search | Usually key-first and search-only; no local fallback bundle when quota or keys fail. |
| Bare Agent client | Reasoning and editing | Bulk searches, repetitive audits, and multi-pass evidence collection consume main-thread time/limits. |
| Universal Brute Workpack | Local workbench + graceful degradation + worker pool + managed Agent sidecar + audit runDir collector | Browser automation and local vector adapters are optional future/provider layers, not the core package. |

## Capability Model

Available now:

- Full-capability MCP tool bundle with stdio, Streamable HTTP, and legacy SSE transports.
- 26 neutral tools for search, fetch, file operations, code patching/review, commands, validation, memory search/recall, worker analyze/diff, audit chain, status, and Agent spawn/pipeline.
- CPU-parallel `fs.grep` through a local worker pool. By default it uses available machine parallelism; set `UBW_WORKER_POOL_SIZE` only when you want to limit it.
- `code.patch` uses exact replacements and rolls back JS-like files when `node --check` fails.
- Managed sidecar mode for `agent.spawn` and `agent.pipeline`; users do not need to start a second terminal for the sidecar.
- Concurrent API-backed `agent.pipeline` with configurable task cap, concurrency, stagger timing, and timeout.
- TaskCard/runDir/collector/EvidenceBundle audit chain through `audit.prepare`, `audit.ingest_report`, `audit.run`, and `audit.collect`.
- Zero-key first run: DuckDuckGo fallback for web search and local text/JSON/Markdown/log fallback for memory search.
- Configurable profiles, deny lists, filesystem roots, provider keys, memory backends, LLM endpoints, pipeline task limits, and stagger timing.
- OpenAI-compatible API mode for `agent.spawn` and `agent.pipeline`; if no model backend is configured, Agent tools return `not_configured` instead of killing the MCP process.
- Optional Codex companion skills under `integrations/codex-skills/` for scenario-based, low-token UBW usage.
- Optional Codex plugin wrapper under `plugins/universal-brute-workpack/` plus `.agents/plugins/marketplace.json` for users who want UBW to appear in the Codex plugin UI.

Proven pattern / current portable base:

- OpenClaw has already demonstrated 100-way prompt-contained pre-audit as an external orchestration pattern.
- Universal Brute Workpack now ships the portable base for that pattern: local worker pool, managed sidecar, concurrent pipeline controls, TaskCards, run directories, collector contracts, EvidenceBundles, failure thresholds, and main-Agent review gates.
- Host-mediated mode lets Codex/Cursor/Cline/other Agent hosts create native subagents while UBW owns prompts, report ingestion, collection, and gate artifacts.
- The high-value path is a two-layer audit loop: broad low-cost candidate discovery, then focused high-quality review by a smaller number of stronger Agents.

## Quick Start

Most MCP clients can auto-start the workpack with `npx`:

```json
{
  "mcpServers": {
    "universal-brute-workpack": {
      "command": "npx",
      "args": ["-y", "universal-brute-workpack", "serve", "--stdio"]
    }
  }
}
```

For Codex:

```toml
[mcp_servers.universal_brute_workpack]
command = "npx"
args = ["-y", "universal-brute-workpack", "serve", "--stdio"]
```

This direct MCP setup gives Codex the tools, but it does not make UBW appear in Codex's plugin browser or `@` plugin picker.

If you want the plugin UI experience, install the optional Codex plugin wrapper from this repository's marketplace. This does not require official marketplace curation; a user can add this repository marketplace directly:

```bash
codex plugin marketplace add <path-or-repo-root-containing-.agents/plugins/marketplace.json>
codex plugin add universal-brute-workpack@universal-brute-workpack
```

That wrapper still launches the npm package with `npx`; it is a Codex-facing shell around the same MCP server. If your Codex build exposes plugin installation through the app UI instead of the CLI, add this repository marketplace there, install the wrapper, then start a new thread before `@Universal Brute Workpack` and its MCP tools are visible.

No API key is required for first run. File tools, command execution, validation, DuckDuckGo fallback search, and local keyword memory search work out of the box.

If Tavily or Exa is not configured, exhausted, or unavailable, `search.web` falls back instead of crashing. If no memory/vector service is configured, `memory.search` falls back to local text search. If no LLM endpoint is configured, `agent.spawn` and `agent.pipeline` report `not_configured` while every local tool continues working.

## Optional Codex Plugin Wrapper

There are two Codex integration layers:

| Layer | What It Does | Install Path |
| --- | --- | --- |
| MCP server | Gives Codex the actual UBW tools through `npx universal-brute-workpack serve --stdio`. | Add `[mcp_servers.universal_brute_workpack]` to Codex config. |
| Codex plugin wrapper | Makes UBW show as a Codex plugin and bundles the companion skills. | Add this repository marketplace, then install from `.agents/plugins/marketplace.json`. |

The plugin wrapper is manual for now. npm cannot automatically register a Codex plugin in every user's app, and official marketplace curation is not required for self-distribution. The wrapper is included so users can install it deliberately and understand that it points back to the npm MCP server.

## Registry Metadata

The package includes draft-ready official MCP Registry metadata in `server.json` and `package.json#mcpName`. See `docs/distribution.md` for the registry, aggregator, Smithery, and Codex plugin-wrapper status before publishing a new release.

## MCPB Bundle

For the local stdio bundle route, UBW can stage, validate, and pack an MCPB directory:

```bash
npm run mcpb:stage
npm run mcpb:validate
npm run mcpb:pack
```

See `docs/mcpb.md`. This is separate from Smithery URL publishing, which still requires a public HTTPS Streamable HTTP endpoint.

## Optional Codex Skills

Codex users can copy the lightweight companion skills so Codex loads short scenario guides instead of repeatedly reading the full UBW manual:

```powershell
Copy-Item -Recurse .\integrations\codex-skills\ubw-* "$env:USERPROFILE\.codex\skills\"
```

Included skills: `ubw-research`, `ubw-files`, `ubw-edit`, `ubw-code`, `ubw-audit`, and `ubw-agent`.

## Example Use Cases

After connecting the MCP server, call tools from your Agent client:

```text
search.web
query: "latest MCP client stdio configuration"
```

```text
fs.grep
root: "."
pattern: "TODO"
maxResults: 50
```

```text
worker.diff
left: "src"
right: "backup/src"
maxFiles: 10000
```

```text
code.review
path: "src"
maxFiles: 200
maxFindings: 30
```

```text
agent.pipeline
tasks:
  - prompt: "Review src/tools/core.js for command execution risks."
  - prompt: "Review src/lib/profiles.js for profile bypass risks."
model: "cheap-review-model"
concurrency: 20
staggerMs: 50
```

```text
audit.prepare
tasks:
  - title: "Review tool permissions"
    prompt: "Find profile bypasses and report compact JSON findings."
maxFindingsPerTask: 3
```

If no LLM endpoint is configured, Agent tasks return `not_configured` instead of crashing. Local tools still work.

## Environment Quick Reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `UBW_CONFIG` | package example config | Path to a custom main config JSON. |
| `UBW_PROFILES` | package example profiles | Path to a custom profile/deny JSON. |
| `UBW_PROFILE` | `admin` | Active profile. |
| `UBW_ROOTS` | `*` | Allowed filesystem roots, separated by `;`. |
| `UBW_WORKER_POOL_ENABLED` | `1` | Enable CPU worker pool for local bulk work. |
| `UBW_WORKER_POOL_SIZE` | available CPU parallelism | Override worker pool size; empty means auto. |
| `UBW_WORKER_MIN_PARALLEL_FILES` | `1` | Minimum candidate files before parallel grep. |
| `UBW_WORKER_MAX_FILE_BYTES` | `2000000` | Per-file worker scan cap. |
| `TAVILY_API_KEY` | empty | Optional Tavily web search key. |
| `EXA_API_KEY` | empty | Optional Exa web search key. |
| `UBW_MEMORY_URL` | empty | Optional external memory/vector service endpoint. |
| `LLM_BASE_URL` | empty | Optional OpenAI-compatible base URL for Agent tasks. |
| `LLM_API_KEY` | empty | Optional model API key. |
| `LLM_MODEL` | provider default | Optional model name. |
| `UBW_SIDECAR_MODE` | `managed` | `managed`, `inprocess`, or `external`. |
| `UBW_SIDECAR_URL` | empty | External sidecar URL when using external mode. |
| `UBW_SIDECAR_PORT` | `0` | Managed sidecar port; `0` means auto-pick. |
| `UBW_AGENT_MAX_PIPELINE_TASKS` | `100` | Pipeline task cap. |
| `UBW_AGENT_CONCURRENCY` | `20` | Concurrent Agent tasks inside pipeline. |
| `UBW_AGENT_STAGGER_MS` | `0` | Delay between pipeline tasks. |
| `UBW_AGENT_TASK_TIMEOUT_MS` | `300000` | Agent task timeout. |
| `UBW_AGENT_TASK_HISTORY_LIMIT` | `1000` | Managed sidecar task record cap. |

## Defaults

- Tool names are neutral: `search.web`, `file.read`, `command.exec`, `agent.spawn`, and so on.
- Default mode is full capability: `profile=admin`, `roots=["*"]`.
- Narrow profiles and per-profile `deny` lists exist only as optional compatibility knobs for clients that want them.
- Provider keys, memory/vector service URLs, model endpoints, pipeline limits, and stagger timing are configured through `config/universal-brute-workpack.example.json`, `.env`, or your MCP client environment.
- `memory.search` / `memory.recall` prefer a configured memory service, then fall back to local text/JSON/Markdown/log search instead of failing.
- `agent.spawn` / `agent.pipeline` use the managed sidecar by default. Set `LLM_BASE_URL`, optional `LLM_API_KEY`, and `LLM_MODEL` for real model calls.

## Start

stdio, for MCP clients:

```bash
npx -y universal-brute-workpack serve --stdio
```

Streamable HTTP, for clients or hosted gateways that need a single HTTP MCP endpoint:

```bash
npx -y universal-brute-workpack serve --transport streamable-http --port 18890 --profile admin
```

The MCP endpoint is `http://127.0.0.1:18890/mcp`. A static server card is exposed at `http://127.0.0.1:18890/.well-known/mcp/server-card.json`.

For a Smithery URL publishing hosting recipe, see `docs/smithery-hosting.md`.

Legacy SSE, for older clients that prefer a local server:

```bash
npx -y universal-brute-workpack serve --transport sse --port 18890 --profile admin
```

Doctor:

```bash
npx -y universal-brute-workpack doctor
```

For local development, copy `.env.example` to `.env`.

## Architecture

```text
Agent Client
  └─ MCP stdio / Streamable HTTP / legacy SSE
      └─ Universal Brute Workpack bridge
          ├─ local tools: fs/search/file/code/command/validate
          ├─ CPU worker pool: parallel grep and local bulk scans
          ├─ fallback tools: DuckDuckGo, local memory keyword scan
          ├─ managed sidecar: isolated Agent spawn/pipeline process
          └─ audit layer: TaskCards, reports, collector, EvidenceBundles, gate
```

## Tools

See `docs/tools.md`.

For the host-mediated audit flow, where the host Agent dispatches native workers and UBW owns the runDir, reports, collector, EvidenceBundle, and gate, see `docs/host-mediated.md`.

## Configuration

See `docs/configuration.md` for provider keys, memory backends, profiles, deny lists, roots, and pipeline limits.

## License

Business Source License 1.1. The source is available for personal, research, academic, and small non-commercial use. Enterprise production use, commercial products, SaaS, hosted MCP services, Agent platforms, marketplace redistribution, OEM/white-label use, and commercial derivatives require written authorization from the licensor.

Change License: Apache License v2.0.

Change Date: 2030-06-29.

See `LICENSE` for the full English and Chinese terms.

## FAQ

**Do I need an API key?**

No for first run. Local tools, DuckDuckGo fallback, and local memory keyword search work without keys. You only need keys for stronger web providers or model-backed Agent tasks.

**Does BUSL restrict personal use?**

Personal, academic, research, and small non-commercial use are free under the included license. Enterprise production use, commercial services, SaaS, hosted MCP services, Agent platforms, marketplace redistribution, OEM/white-label use, and commercial derivatives require written authorization before the Change Date.

**Is 100-way Agent orchestration already shipped?**

The portable base is shipped in v0.1.x: worker pool, managed sidecar, concurrent API pipeline, TaskCards, runDir, report ingestion, collector summary, EvidenceBundle, gate file, optional Codex companion skills, and an optional Codex plugin wrapper. OpenClaw has demonstrated the 100-way pre-audit pattern in a larger system; UBW provides the generic MCP package foundation for that style of workflow.

**What happens when keys or quotas are missing?**

The workpack degrades instead of dying: Tavily/Exa can fall back to DuckDuckGo, external memory can fall back to local keyword search, and Agent tools return `not_configured` without breaking file/search/command tools.

**Can this use Codex Pro or another subscription Agent as workers?**

Not directly by taking a hidden API key. The host-mediated audit flow lets the host Agent use its own native subagents, threads, or tools while UBW manages task cards, run directories, report ingestion, collector contracts, and evidence bundles.

## Contributing

Issues and pull requests are welcome for bug fixes, docs, provider adapters, and safer tool implementations. For development:

```bash
npm install
npm run doctor
npm run smoke
npm run smoke:host
npm run smoke:stdio
npm run pack:dry
```

## Verify

```powershell
node --check .\src\bridge.js
node --check .\src\tools\core.js
node --check .\sidecar\server.js
npm run smoke
npm run smoke:host
npm run smoke:stdio
npm run doctor
npm run pack:dry
```

## Contact

For collaboration, licensing, or partnership inquiries, contact: haoyun18881@gmail.com
