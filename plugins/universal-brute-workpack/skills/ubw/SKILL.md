---
name: ubw
description: UBW 日常工具入口。用于联网搜索、大目录文件发现、CPU 并行 grep、可移植文件读取、本地批量分析/diff/status、只读代码审查和有界静态验证。普通本机小搜索、shell 诊断或 apply_patch 编辑不要触发。
---

# UBW 工具

只在 UBW 比 Codex 原生工具更有价值时使用 `ubw` MCP server。

默认 Codex 日常入口只按这个低噪声工具面理解：

- `fs.glob`、`fs.grep`、`fs.list`、`file.read`：大目录发现、CPU 并行 grep、目标文件读取。
- `search.web`：联网搜索，按配置使用 Exa/Tavily，再降级到无 key fallback。
- `worker.analyze`、`worker.diff`、`worker.status`：批量本地分析、hash/diff 比较、workpack 状态。
- `code.review`、`validate.check`、`validate.load`、`validate.diff`：有界静态审查和验证证据。

普通本机小范围搜索、本机诊断、dev server 和手工代码编辑优先用 Codex 原生工具。代码编辑默认用 `apply_patch`。

需要 TaskCard、runDir、EvidenceBundle、collector、gate 或多报告归集时，使用 `ubw-audit`，不要把这个日常入口升级成审计流程。最终结论和真实文件改动由 Codex 主线程负责。

不要粘贴 key、token、cookie、密码、Authorization header、private key 或完整私密配置值。UBW 不可用时，用 Codex 原生工具继续。
