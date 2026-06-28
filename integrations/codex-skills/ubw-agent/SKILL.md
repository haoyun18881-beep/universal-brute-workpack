---
name: ubw-agent
description: Use Universal Brute Workpack for agent.spawn, agent.pipeline, sidecar-managed LLM workers, or bulk delegated task execution. Trigger when Codex should dispatch sub-agent work through UBW and collect concise structured results.
---

# UBW Agent

Use the `universal_brute_workpack` MCP server when available.

Preferred tools:

- `agent.spawn` for one delegated LLM task.
- `agent.pipeline` for multiple LLM tasks with configured concurrency.
- `worker.status` only when local worker or sidecar state is relevant.

Give agents narrow prompts, small output schemas, and explicit forbidden actions. Do not ask spawned agents to output secrets or make final decisions without main-thread review.
