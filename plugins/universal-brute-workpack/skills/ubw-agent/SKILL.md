---
name: ubw-agent
description: Use Universal Brute Workpack for advanced raw API-backed agent.spawn / agent.pipeline work. Prefer ubw-audit for TaskCard, runDir, EvidenceBundle, gate, or serious multi-agent review.
---

# UBW Agent

Use the `ubw` MCP server when available.

This is the low-level external model worker layer. It does not create Codex Pro/GPT native subagents, and it does not by itself enforce TaskCards, runDir, EvidenceBundle, or gate files. For serious audits, use `ubw-audit` first.

Preferred tools:

- `agent.spawn` for one OpenAI-compatible API-backed LLM task.
- `agent.pipeline` for multiple OpenAI-compatible API-backed LLM tasks with configured concurrency.
- `worker.status` only when local worker or sidecar state is relevant.

Use this for connectivity smoke tests, cheap candidate discovery, or advanced direct model delegation. Give agents narrow prompts, small output schemas, fan-out limits, budget/timeout limits, and explicit forbidden actions. Treat weak/API-agent output as candidate evidence only; Codex main-thread or stronger Codex workers own final decisions.
