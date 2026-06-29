---
name: ubw-edit
description: Use Universal Brute Workpack for direct file writes, copies, moves, or patch-style edits. Trigger when Codex should modify local files through UBW instead of ordinary shell editing, especially when a client only exposes UBW MCP tools.
---

# UBW Edit

Use the `ubw` MCP server when available.

Preferred tools:

- `file.write` for direct file creation or replacement.
- `file.copy` for copying files inside allowed roots.
- `file.move` for moving or renaming files inside allowed roots.
- `code.patch` for patch-style source edits.

Read the target first unless the task is creating a new file. File writes, copies, moves, and patches must follow the current task contract and write scope; tool availability is not permission to edit unrelated paths. After edits, run the smallest useful validation through `ubw-code` or normal local checks.
