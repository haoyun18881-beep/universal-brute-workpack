---
name: ubw-code
description: Use Universal Brute Workpack for code review, code patch verification, syntax checks, static module inspection, command execution, or git diff validation. Trigger when Codex needs UBW code tools rather than the full UBW orchestration stack.
---

# UBW Code

Use the `universal_brute_workpack` MCP server when available.

Preferred tools:

- `code.review` for focused code review findings.
- `validate.check` for syntax or command-style validation.
- `validate.load` for static module/package inspection; do not treat it as proof of runtime behavior.
- `validate.diff` for git diff summaries.
- `command.exec` for explicit test, build, lint, or diagnostic commands.

Lead with findings for reviews. For implementation work, validate the changed surface and report anything not run.
