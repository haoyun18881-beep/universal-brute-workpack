# Host-Mediated Audit Flow

Host-mediated mode is for Agent clients that already have native subagents, background threads, review passes, or other human-controlled worker channels.

UBW does not try to steal the host subscription model. Instead, it provides the audit scaffolding:

- TaskCards and prompt files.
- A stable runDir.
- A report dropbox.
- Report ingestion.
- Collector summaries.
- EvidenceBundle and gate files.

The host Agent decides how to dispatch the work. UBW decides how to collect it.

## When To Use It

Use host-mediated mode when:

- You want Codex, Cursor, Cline, OpenClaw, or another host to create its own native workers.
- You need a runDir that records tasks, reports, collector output, and gate status.
- You want to fan out only after missing/failed/parse-bad reports stay below a failure threshold.
- You want the main Agent to sample raw worker reports before accepting findings.

Use `audit.run` instead when you want UBW to call an OpenAI-compatible model backend directly.

## Flow

1. Call `audit.prepare` with a list of tasks.
2. Read the returned `host_instructions_path`.
3. Dispatch each prompt in `prompts/` to native host workers or subagents.
4. Require each worker to return compact JSON matching the report contract.
5. Call `audit.ingest_report` once for each worker result.
6. Call `audit.collect`.
7. Read `gate.json` and sample the recommended raw report paths before accepting findings.

`audit.prepare` creates this layout:

```text
manifest.json
host-instructions.md
taskcards/
prompts/
reports/
results/
```

After collection, UBW also writes:

```text
collector-summary.json
evidence-bundle.json
gate.json
```

## Prepare

Example task list:

```json
{
  "runDir": ".ubw/runs/rules-audit-001",
  "failureThreshold": 0.2,
  "maxFindingsPerTask": 3,
  "tasks": [
    {
      "title": "Review command execution risks",
      "category": "security",
      "scope": "src/tools/core.js",
      "prompt": "Find command execution risks. Return compact JSON only."
    },
    {
      "title": "Review profile bypass risks",
      "category": "security",
      "scope": "src/lib/profiles.js",
      "prompt": "Find profile bypass risks. Return compact JSON only."
    }
  ]
}
```

`audit.prepare` returns the runDir, taskcard paths, prompt paths, expected report paths, `host_instructions_path`, and next actions.

## Worker Report Contract

Each worker should return one compact JSON object:

```json
{
  "task_id": "task-001",
  "status": "completed",
  "findings": [
    {
      "finding_id": "task-001-finding-1",
      "severity": "medium",
      "category": "security",
      "claim": "Short factual claim.",
      "evidence_paths": ["src/tools/core.js:10"],
      "confidence": 0.75,
      "needs_main_review": true
    }
  ],
  "sensitive_scan_result": "none-found",
  "read_status": "complete",
  "evidence_paths_read": ["src/tools/core.js"],
  "evidence_paths_not_read": [],
  "not_inspected": [],
  "notes": "short optional note"
}
```

The worker must not output secrets, keys, tokens, cookies, Authorization headers, Bearer strings, passwords, private keys, or full private config values. Sensitive hits should be reported only as category, location, and handling action.

## Ingest

For each worker result, call `audit.ingest_report`:

```json
{
  "runDir": ".ubw/runs/rules-audit-001",
  "taskId": "task-001",
  "workerId": "codex-subagent-1",
  "status": "completed",
  "output": "{ \"task_id\": \"task-001\", \"status\": \"completed\", \"findings\": [] }"
}
```

`output` can be the worker's compact JSON string. UBW redacts sensitive-shaped values before writing the report.

## Collect And Gate

Call `audit.collect`:

```json
{
  "runDir": ".ubw/runs/rules-audit-001",
  "failureThreshold": 0.2,
  "mainThreadSampleRate": 0.2
}
```

The collector writes:

- `collector-summary.json`: counts, failure rate, and artifact paths.
- `evidence-bundle.json`: deduped candidate findings, risks, sample plan, and raw report paths.
- `gate.json`: expansion decision fields.

If `gate.json.status` is `blocked_failure_threshold`, do not expand fan-out. Inspect missing, failed, blocked, unknown, or parse-bad reports and rerun a smaller or clearer batch.

If `gate.json.status` is `needs_main_review`, the batch may continue only after the main Agent samples the recommended raw reports and accepts or rejects findings.

## Local Fixture

The repository includes a host-mediated fixture that does not call an LLM or MCP client. It creates a temporary runDir, prepares three tasks, ingests two simulated host worker reports, collects the run, and verifies the gate and EvidenceBundle shape:

```bash
npm run smoke:host
```

## Boundary

Host-mediated mode is a control-plane pattern. It does not grant UBW hidden access to subscription Agent model quotas. The host Agent uses its own native worker mechanism; UBW provides the files, contracts, collector, and gate.
