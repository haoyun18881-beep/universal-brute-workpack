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
| `server` | SSE host and port. stdio does not need a port. |
| `transport` | `stdio` or `sse`. |
| `roots` | Allowed file roots. `["*"]` means full filesystem access. |
| `search.providers` | Exa, Tavily, and DuckDuckGo endpoints and key env names. |
| `memory` | External memory/vector service URL plus local fallback scan limits. |
| `llm` | OpenAI-compatible base URL, key env name, model, timeout, temperature. |
| `agent` | Pipeline max task count, stagger milliseconds, task timeout. |
| `limits` | Output, fetch, and command timeout limits. |

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
npx -y universal-brute-workpack serve --stdio --profile admin_no_shell
```

## Degradation

No key or service is required for first run.

| Tool | Best Path | Fallback |
| --- | --- | --- |
| `search.web` | Exa or Tavily key | DuckDuckGo instant answer |
| `memory.search` | External memory/vector URL | Local text/JSON/Markdown/log keyword scan |
| `agent.spawn` | OpenAI-compatible LLM endpoint | Returns `not_configured` without crashing |
