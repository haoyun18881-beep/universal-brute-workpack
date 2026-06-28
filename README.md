# Universal Brute Workpack

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

## Tools

See `docs/tools.md`.

## Configuration

See `docs/configuration.md` for provider keys, memory backends, profiles, deny lists, roots, and pipeline limits.

## License

Business Source License 1.1. The source is available for personal, research, academic, and small non-commercial use. Enterprise production use, commercial products, SaaS, hosted MCP services, Agent platforms, marketplace redistribution, OEM/white-label use, and commercial derivatives require written authorization from the licensor.

Change License: Apache License v2.0.

Change Date: 2030-06-29.

See `LICENSE` for the full English and Chinese terms.

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
