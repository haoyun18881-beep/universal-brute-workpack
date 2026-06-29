---
name: ubw-files
description: Use Universal Brute Workpack for local file discovery, CPU-parallel grep, directory listing, file reading, worker analysis, or file diff. Trigger when Codex needs to inspect many files, search a large tree, profile a folder, or compare files through UBW without loading unrelated UBW tools.
---

# UBW Files

Use the `ubw` MCP server when available.

Preferred tools:

- `fs.glob` for path discovery.
- `fs.grep` for file-content search; this is the single CPU-parallel search entrypoint.
- `fs.list` for directory listings.
- `file.read` for targeted reads after narrowing paths.
- `worker.analyze` or `worker.diff` for bulk local analysis or file comparison.
- `worker.status` when worker capacity or state matters.

Prefer UBW here for large trees, CPU-parallel grep, worker analysis, portable MCP file access, or hash/diff style comparisons. For tiny Codex-local reads, native file tools are fine. Search first, then read only the files needed for the task. Keep results short and path-grounded.
