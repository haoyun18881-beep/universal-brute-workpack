# Universal Brute Workpack

Universal Brute Workpack is a full-capability, stdio-first Agent MCP workpack.

It is meant to be usable by Codex, OpenClaw, Claude Desktop, Cursor, Cline, Continue, or any other MCP client that can speak SSE or stdio.

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
