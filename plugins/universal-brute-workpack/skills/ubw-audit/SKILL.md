---
name: ubw-audit
description: Use Universal Brute Workpack for TaskCard, runDir, report ingestion, collector, EvidenceBundle, gate, or audit-chain workflows. Trigger when Codex needs to prepare, run, collect, or normalize multi-agent audit evidence through UBW.
---

# UBW Audit

Use the `universal_brute_workpack` MCP server when available.

Preferred tools:

- `audit.prepare` to create a TaskCard/runDir scaffold.
- `audit.run` for UBW-managed audit execution.
- `audit.ingest_report` to add host-mediated or external agent reports.
- `audit.collect` to produce collector output, EvidenceBundle, and gate artifacts.

Treat weak-agent reports as candidate findings only. Main-thread review owns final conclusions and any real file changes.
