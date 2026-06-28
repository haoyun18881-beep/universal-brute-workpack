# Universal Brute Workpack Tools

Default launch mode is `admin`, so all tools are visible and callable unless the caller explicitly selects a narrower profile.

| Tool | Purpose |
| --- | --- |
| `search.web` | Web search through Exa, Tavily, or DuckDuckGo fallback. |
| `search.fetch` | Fetch HTTP/HTTPS pages as text. |
| `fs.glob` | File discovery. |
| `fs.grep` | Plain text search through the local CPU worker pool. |
| `fs.list` | Directory listing. |
| `file.read` | Read files. |
| `file.write` | Write files. |
| `file.copy` | Copy files or directories. |
| `file.move` | Move files or directories. |
| `code.patch` | Exact text replacement with JS syntax check rollback. |
| `code.review` | Structured heuristic code review for files or directories. |
| `command.exec` | Local shell command execution. |
| `validate.check` | Lightweight syntax/config validation. |
| `validate.load` | Load JSON or JS modules and return a structured summary. |
| `validate.diff` | Git diff adapter. |
| `memory.search` | Memory/vector search through a configured service, with local text fallback. |
| `memory.recall` | Alias of `memory.search` for clients that use recall wording. |
| `worker.analyze` | Parallel file statistics, extension counts, line counts, TODO/FIXME summaries, and largest-file hints. |
| `worker.diff` | Parallel file or directory diff by sha256, size, and existence. |
| `audit.prepare` | Prepare a host-mediated audit runDir with TaskCards, prompts, manifest, and report dropbox. |
| `audit.ingest_report` | Ingest one host-mediated worker report into an audit runDir. |
| `audit.run` | Run API-backed TaskCard dispatch and collector in one call. |
| `audit.collect` | Collect an existing runDir into EvidenceBundle, collector summary, and gate files. |
| `worker.status` | Local workpack, worker-pool, and sidecar status. |
| `agent.spawn` | OpenAI-compatible single Agent task through managed, in-process, or external sidecar mode. |
| `agent.pipeline` | Multi-task Agent pipeline with configurable task cap, concurrency, and stagger timing. |

## Local Worker Pool

`fs.grep` is the single file-content search entrypoint and uses Node worker threads for local bulk search. By default the pool size follows the machine's available CPU parallelism. Set `UBW_WORKER_POOL_SIZE` only when you want to cap it.

Important controls:

| Variable | Purpose |
| --- | --- |
| `UBW_WORKER_POOL_ENABLED` | `1` enables the pool; `0` forces single-thread fallback. |
| `UBW_WORKER_POOL_SIZE` | Empty means auto. A number pins the worker count. |
| `UBW_WORKER_MIN_PARALLEL_FILES` | Minimum candidate file count before parallel grep. |
| `UBW_WORKER_MAX_FILE_BYTES` | Per-file scan cap. |

## Patch And Review

`code.patch` applies exact text replacement. For `.js`, `.mjs`, and `.cjs` files it runs `node --check`; if syntax validation fails, it writes the original content back and reports a rollback.

`code.review` is a structured heuristic review pass. It is useful for quick candidate finding, not a substitute for a main Agent or human final review. Each finding includes severity, category, evidence path, line, confidence, and `needs_main_review`.

## Validation

`validate.check` verifies JSON syntax and JS-like syntax. `validate.load` parses JSON or statically summarizes JS/CJS/MJS modules without executing module top-level code.

## Audit Chain

The audit chain is now a first-class tool surface:

| Flow | Tools |
| --- | --- |
| API-backed dispatch | `audit.run` prepares a runDir, dispatches through the managed sidecar, writes reports, collects, and emits gate files. |
| Host-mediated dispatch | `audit.prepare` creates runDir/prompts/taskcards, the host Agent or native subagents do the work, `audit.ingest_report` writes each report, then `audit.collect` builds the EvidenceBundle. |

RunDir layout:

```text
manifest.json
taskcards/
prompts/
reports/
results/
collector-summary.json
evidence-bundle.json
gate.json
```

The collector marks missing reports, parse failures, failure rate, expansion gate, raw report paths, sample plan, and sensitive redaction status. A failure rate above the configured threshold blocks expansion instead of pretending the batch is healthy.

## Sidecar And Agent Pipeline

Default sidecar mode is `managed`: the bridge starts an isolated sidecar process on the first `agent.spawn` or `agent.pipeline` call. Users do not need a second terminal.

Modes:

| Mode | Behavior |
| --- | --- |
| `managed` | Auto-starts and owns a sidecar process. |
| `inprocess` | Runs the OpenAI-compatible adapter inside the bridge. |
| `external` | Uses `UBW_SIDECAR_URL` or config `sidecar.url`. |

`agent.pipeline` supports `maxTasks`, `concurrency`, and `staggerMs`. Without `LLM_BASE_URL` or `OPENAI_BASE_URL`, Agent calls return `not_configured` while local tools keep working.

## Pipeline Direction

The current package includes an OpenAI-compatible API pipeline with managed sidecar isolation and a host-mediated audit flow. In host-mediated mode, Universal Brute Workpack manages TaskCards, run directories, collector contracts, failure thresholds, and EvidenceBundles, while the host Agent decides how to create native subagents, threads, or review passes.
