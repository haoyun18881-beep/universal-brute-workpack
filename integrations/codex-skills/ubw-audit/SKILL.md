---
name: ubw-audit
description: Use Universal Brute Workpack for TaskCard, runDir, report ingestion, collector, EvidenceBundle, gate, or audit-chain workflows. Trigger when Codex needs to prepare, run, collect, or normalize multi-agent audit evidence through UBW.
---

# UBW Audit

Use the `ubw` MCP server when available.

Preferred tools:

- `audit.prepare` to create TaskCards, runDir, prompt files, and report dropbox for host-mediated work.
- `audit.ingest_report` to add Codex native subagent, external agent, or human worker reports.
- `audit.collect` to produce collector output, EvidenceBundle, and gate artifacts.
- `audit.run` for UBW-managed API-backed audit execution when the task contract explicitly wants external model workers.

Use this as the default UBW route for multi-agent evidence. Host-mediated mode means UBW owns the task cards and evidence ledger while Codex, another host, or a human does the work. API-backed mode means UBW calls configured OpenAI-compatible workers such as DeepSeek. Treat weak/API-agent reports as candidate findings only. Main-thread review owns final conclusions and any real file changes.
