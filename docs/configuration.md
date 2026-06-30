# Configuration

Universal Brute Workpack starts with full capability by default:

```json
{
  "profile": "admin",
  "roots": ["*"]
}
```

Users decide their own boundary by copying the example files and pointing the process at them:

```text
UBW_CONFIG=/path/to/universal-brute-workpack.json
UBW_PROFILES=/path/to/profiles.json
```

## Main Config

Copy `config/universal-brute-workpack.example.json` to your own private location.

Important sections:

| Section | Purpose |
| --- | --- |
| `server` | HTTP host, port, and optional allowed origins. stdio does not need a port. |
| `transport` | `stdio`, `streamable-http`, or `sse`. |
| `roots` | Allowed file roots. `["*"]` means full filesystem access. |
| `search.providers` | Exa, Tavily, DuckDuckGo, and direct HTTP endpoints plus key env names. |
| `worker` | Local CPU worker pool controls for grep/analyze/diff. |
| `sidecar` | Managed, in-process, or external sidecar mode. |
| `memory` | External memory/vector service URL plus local fallback scan limits. |
| `llm` | OpenAI-compatible base URL, key env name, model, timeout, temperature. |
| `agent` | Pipeline max task count, concurrency, stagger milliseconds, task timeout, task history limit. |
| `limits` | Output, fetch, file-read, and command timeout limits. |

Keys can be placed directly in a private config file, but the recommended shareable pattern is to keep key fields empty and use env vars:

```json
{
  "llm": {
    "baseUrlEnv": "LLM_BASE_URL",
    "apiKeyEnv": "LLM_API_KEY",
    "modelEnv": "LLM_MODEL"
  }
}
```

For local-only installs, provider keys may also be placed in a separate file and referenced by `apiKeyFile`. Keep the path in a private config file and do not commit it:

```json
{
  "search": {
    "providers": {
      "tavily": {
        "apiKeyFile": "C:/Users/you/.secrets/tavily.key"
      }
    }
  }
}
```

## Profiles

Copy `config/profiles.example.json` if you want custom allow/deny behavior.

Default `admin` exposes every tool:

```json
{
  "admin": {
    "allow": ["*"],
    "deny": [],
    "write": true,
    "exec": true,
    "spawnDepth": 100
  }
}
```

Codex-specific profiles keep the default Desktop tool surface lighter:

| Profile | Intended use |
| --- | --- |
| `codex_daily` | Default `install codex` profile: `search.web`, `fs.*`, `file.read`, `worker.*`, `code.review`, and `validate.*`; no writes, arbitrary commands, URL fetch, memory fallback, audit, or raw Agent tools. |
| `codex_orchestrator` | Adds `search.fetch`, `memory.*`, `audit.*`, and `agent.*` for explicit orchestration tasks, still without writes or arbitrary command execution. |
| `developer` | Adds UBW write, patch, command, and diff tools for explicit MCP-only or non-Codex developer workflows. |
| `orchestrator` | Full developer surface plus audit and raw Agent tools. |
| `admin` / `full` | Full compatibility surface. |

To keep full capability except shell execution:

```json
{
  "admin_no_shell": {
    "extends": "admin",
    "deny": ["command.exec"],
    "exec": false
  }
}
```

Launch with:

```bash
npx -y universal-brute-workpack@0.1.8 serve --stdio --profile admin_no_shell
```

## Streamable HTTP

Use Streamable HTTP when a client or gateway expects a single HTTP MCP endpoint:

```bash
npx -y universal-brute-workpack@0.1.8 serve --transport streamable-http --port 18890 --profile admin
```

Endpoints:

| Endpoint | Purpose |
| --- | --- |
| `/mcp` | Streamable HTTP MCP JSON-RPC endpoint. |
| `/health` | Local health and endpoint summary. |
| `/.well-known/mcp/server-card.json` | Static server card for scanners. |
| `/sse` | Legacy HTTP+SSE compatibility endpoint. |

The server validates `Origin` headers to reduce local DNS rebinding risk. By default, localhost origins for the selected port are allowed. Add public or hosted origins through:

```json
{
  "server": {
    "allowedOrigins": ["https://example.com"]
  }
}
```

Or with env:

```text
UBW_ALLOWED_ORIGINS=https://example.com;https://another.example
```

## Worker Pool

The worker pool is on by default and uses available CPU parallelism unless capped:

```json
{
  "worker": {
    "enabled": true,
    "poolSize": 0,
    "minParallelFiles": 1,
    "maxFileBytes": 2000000
  }
}
```

`poolSize: 0` means auto. `fs.grep`, `worker.analyze`, and `worker.diff` use this pool.

## File Read Limit

`file.read` checks file size before reading so accidental huge-file reads fail quickly instead of loading the whole file into memory:

```json
{
  "limits": {
    "maxReadFileBytes": 2000000
  }
}
```

Set `maxReadFileBytes` to `0` only when you intentionally want no read-size guard.

## Sidecar And Agent Pipeline

Default sidecar mode is managed:

```json
{
  "sidecar": {
    "mode": "managed",
    "url": "",
    "port": 0,
    "startupTimeoutMs": 15000
  },
  "agent": {
    "maxPipelineTasks": 100,
    "concurrency": 20,
    "staggerMs": 0,
    "taskTimeoutMs": 300000,
    "taskHistoryLimit": 1000
  }
}
```

Use `inprocess` for the old single-process adapter or `external` with `UBW_SIDECAR_URL` when you manage the sidecar yourself.

## Audit Chain

`audit.run` is the one-call API-backed path. `audit.prepare` + `audit.ingest_report` + `audit.collect` is the host-mediated path for Codex, Cursor, Cline, or another Agent host to create native subagents and write reports back into a UBW runDir.

## Degradation

No key or service is required for first run.

| Tool | Best Path | Fallback |
| --- | --- | --- |
| `search.web` | Exa or Tavily key | DuckDuckGo instant answer, then direct HTTP search |
| `memory.search` | External memory/vector URL | Local text/JSON/Markdown/log keyword scan |
| `agent.spawn` | OpenAI-compatible LLM endpoint | Returns `not_configured` without crashing |
| `agent.pipeline` | OpenAI-compatible LLM endpoint | Returns `not_configured` results without breaking local tools |
