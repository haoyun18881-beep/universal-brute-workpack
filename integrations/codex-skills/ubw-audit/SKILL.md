---
name: ubw-audit
description: UBW 高级审计入口。仅当当前工具列表已经有 UBW audit 工具时，用于 TaskCard、runDir、报告回收、collector、EvidenceBundle、gate 或审计链流程。
---

# UBW 审计

仅在当前工具列表已经暴露所需 audit 工具时使用。

这是高级审计路线，不是普通文件/搜索/代码入口。若当前工具列表没有所需 audit 工具，使用 Codex 原生子 Agent，或把缺失工具记录为 setup issue。

优先工具：

- `audit.prepare`：创建 TaskCards、runDir、prompt 文件和报告投递目录。
- `audit.ingest_report`：接收 Codex 原生子 Agent、外部 Agent 或人工 worker 报告。
- `audit.collect`：生成 collector 输出、EvidenceBundle 和 gate 产物。
- `audit.run`：仅在任务合同明确需要外部模型 worker 时运行 UBW 管理的 API-backed audit。

Host-mediated 模式下，UBW 负责任务卡和证据账本，Codex、其他宿主或人工 worker 做实际工作。API-backed 模式下，UBW 调用已配置的 OpenAI-compatible worker。弱模型/API Agent 报告只算候选发现；最终结论和真实文件改动归 Codex 主线程。

严肃证据工作优先走 audit 工具。fan-out、预算、超时和禁止动作必须写清楚。
