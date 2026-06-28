# Universal Brute Workpack Tools

Default launch mode is `admin`, so all tools are visible and callable unless the caller explicitly selects a narrower profile.

| Tool | Purpose |
| --- | --- |
| `search.web` | Web search through Exa, Tavily, or DuckDuckGo fallback. |
| `search.fetch` | Fetch HTTP/HTTPS pages as text. |
| `fs.glob` | File discovery. |
| `fs.grep` | Plain text search. |
| `fs.list` | Directory listing. |
| `file.read` | Read files. |
| `file.write` | Write files. |
| `file.copy` | Copy files or directories. |
| `file.move` | Move files or directories. |
| `code.patch` | Exact text replacement with JS syntax check rollback. |
| `command.exec` | Local shell command execution. |
| `validate.check` | Lightweight syntax/config validation. |
| `validate.diff` | Git diff adapter. |
| `memory.search` | Memory/vector search through a configured service, with local text fallback. |
| `memory.recall` | Alias of `memory.search` for clients that use recall wording. |
| `worker.status` | Local workpack process status. |
| `agent.spawn` | Built-in OpenAI-compatible single agent task, or external sidecar when configured. |
| `agent.pipeline` | Multi-task pipeline with configurable task count and stagger timing. |
