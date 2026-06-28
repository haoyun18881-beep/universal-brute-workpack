# Universal Brute Workpack

[![npm version](https://img.shields.io/npm/v/universal-brute-workpack.svg)](https://www.npmjs.com/package/universal-brute-workpack)
[![npm downloads](https://img.shields.io/npm/dm/universal-brute-workpack.svg)](https://www.npmjs.com/package/universal-brute-workpack)
[![license: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](./LICENSE)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

Universal Brute Workpack is a full-capability, stdio-first Agent MCP workpack.

It is meant to be usable by Codex, OpenClaw, Claude Desktop, Cursor, Cline, Continue, or any other MCP client that can speak SSE or stdio.

It turns an Agent client into a local-first workbench: files, grep, patching, commands, web search fallback, memory recall fallback, and model-backed Agent tasks behind one MCP server.

## Why It Exists

Most Agent clients are strongest when they judge, decide, and close the loop. They are weaker, slower, or more expensive when they personally do every repetitive search, log scan, candidate implementation, and audit pass.

Universal Brute Workpack is designed to move that bulk work out of the main Agent thread:

- Local tools do zero-token work on the user's machine.
- Cheap API models can handle wide exploratory batches.
- Expensive/pro subscription Agents can stay focused on planning, review, and final decisions.
- Future host-mediated pipelines can let subscription Agents such as Codex Pro or other Agent IDEs act as the control plane for their own native subagents or threads.

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
| Filesystem MCP | File read/write | No web search, command execution, memory fallback, or Agent pipeline. |
| Context7 | Documentation lookup | Not a general local workbench; no file/code/command pipeline. |
| Playwright MCP | Browser automation | Not a local file/search/code/Agent workpack. |
| Exa/Tavily MCP | Web search | Usually key-first and search-only; no local fallback bundle. |
| Bare Agent client | Reasoning and editing | Bulk searches, repetitive audits, and multi-pass evidence collection consume main-thread time/limits. |
| Universal Brute Workpack | Local workbench + graceful degradation + Agent pipeline direction | Not a browser-only or search-only tool; 100-way portable orchestration is the next target, not claimed as fully shipped in v0.1.0. |

## Capability Model

Available now:

- Full-capability MCP tool bundle with stdio and SSE transports.
- 18 neutral tools for search, fetch, file operations, code patching, commands, validation, memory search/recall, status, and Agent spawn/pipeline.
- Zero-key first run: DuckDuckGo fallback for web search and local text/JSON/Markdown/log fallback for memory search.
- Configurable profiles, deny lists, filesystem roots, provider keys, memory backends, LLM endpoints, pipeline task limits, and stagger timing.
- OpenAI-compatible API mode for `agent.spawn` and `agent.pipeline`.

Proven pattern / next target:

- OpenClaw has already demonstrated 100-way prompt-contained pre-audit as an external orchestration pattern.
- Universal Brute Workpack is being shaped to make that pattern portable: TaskCards, run directories, collector contracts, EvidenceBundles, failure thresholds, and main-Agent review gates.
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

No API key is required for first run. File tools, command execution, validation, DuckDuckGo fallback search, and local keyword memory search work out of the box.

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
agent.pipeline
tasks:
  - prompt: "Review src/tools/core.js for command execution risks."
  - prompt: "Review src/lib/profiles.js for profile bypass risks."
model: "cheap-review-model"
staggerMs: 50
```

If no LLM endpoint is configured, Agent tasks return `not_configured` instead of crashing. Local tools still work.

## Environment Quick Reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `UBW_CONFIG` | package example config | Path to a custom main config JSON. |
| `UBW_PROFILES` | package example profiles | Path to a custom profile/deny JSON. |
| `UBW_PROFILE` | `admin` | Active profile. |
| `UBW_ROOTS` | `*` | Allowed filesystem roots, separated by `;`. |
| `TAVILY_API_KEY` | empty | Optional Tavily web search key. |
| `EXA_API_KEY` | empty | Optional Exa web search key. |
| `UBW_MEMORY_URL` | empty | Optional external memory/vector service endpoint. |
| `LLM_BASE_URL` | empty | Optional OpenAI-compatible base URL for Agent tasks. |
| `LLM_API_KEY` | empty | Optional model API key. |
| `LLM_MODEL` | provider default | Optional model name. |
| `UBW_AGENT_MAX_PIPELINE_TASKS` | `100` | Pipeline task cap. |
| `UBW_AGENT_STAGGER_MS` | `0` | Delay between pipeline tasks. |
| `UBW_AGENT_TASK_TIMEOUT_MS` | `300000` | Agent task timeout. |

## Defaults

- Tool names are neutral: `search.web`, `file.read`, `command.exec`, `agent.spawn`, and so on.
- Default mode is full capability: `profile=admin`, `roots=["*"]`.
- Narrow profiles and per-profile `deny` lists exist only as optional compatibility knobs for clients that want them.
- Provider keys, memory/vector service URLs, model endpoints, pipeline limits, and stagger timing are configured through `config/universal-brute-workpack.example.json`, `.env`, or your MCP client environment.
- `memory.search` / `memory.recall` prefer a configured memory service, then fall back to local text/JSON/Markdown/log search instead of failing.
- `agent.spawn` / `agent.pipeline` run through the built-in OpenAI-compatible adapter by default. Set `LLM_BASE_URL`, optional `LLM_API_KEY`, and `LLM_MODEL` for real model calls.

## Start

stdio, for MCP clients:

```bash
npx -y universal-brute-workpack serve --stdio
```

SSE, for clients that prefer a local server:

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
  └─ MCP stdio/SSE
      └─ Universal Brute Workpack bridge
          ├─ local tools: fs/search/file/code/command/validate
          ├─ fallback tools: DuckDuckGo, local memory keyword scan
          ├─ in-process Agent adapter: OpenAI-compatible API
          └─ optional sidecar / future host-mediated pipeline
```

## Tools

See `docs/tools.md`.

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

Not fully in v0.1.0. OpenClaw has demonstrated the 100-way pre-audit pattern. UBW v0.1.0 ships the portable MCP workpack foundation and API pipeline; portable 100-way orchestration with collector contracts and host-mediated pipelines is the next target.

**Can this use Codex Pro or another subscription Agent as workers?**

Not directly by taking a hidden API key. The planned host-mediated mode lets the host Agent use its own native subagents, threads, or tools while UBW manages task cards, run directories, collector contracts, and evidence bundles.

## Contributing

Issues and pull requests are welcome for bug fixes, docs, provider adapters, and safer tool implementations. For development:

```bash
npm install
npm run doctor
npm run smoke
npm run smoke:stdio
npm run pack:dry
```

## Verify

```powershell
node --check .\src\bridge.js
node --check .\src\tools\core.js
node --check .\sidecar\server.js
npm run smoke
npm run smoke:stdio
npm run doctor
npm run pack:dry
```
