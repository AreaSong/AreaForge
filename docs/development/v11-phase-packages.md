# v1.1 阶段包索引（S0–S5）

本文件是学习行动中心**阶段划分的执行索引**，不替代 `workflow/versions/v1.1-learning-action-center.md` 规格正文。

| 大阶段 | Batch | Task | 本会话交付 | 后续实现 |
|---|---|---|---|---|
| S0 基线对齐 | — | workflow 头信息 + 隔离分支 | 已完成 | — |
| S1 文档与任务 | 0 | `tasks/active/0025-v11-batch0-doc-sync.md` | Exact docs / DATA-001 / 确认包骨架 / 任务拆分 | 维护者审阅后可将 0025 移入 done |
| S2 安全门禁 | 1–2 | `tasks/backlog/0026-v11-batch1-2-ops-gate-review.md` | `docs/development/v11-s2-ops006-007-gate-review.md` | 维护者认可后归档 task |
| S3 数据与核心服务 | 3–6 | `0027`–`0030` | 任务包已拆分，**未写业务代码** | 确认后按 Batch 顺序实施 |
| S4 可见产品 | 7–10 | `0031`–`0034` | 任务包已拆分，**未写业务代码** | App Shell 起逐步开放隔离入口 |
| S5 完整 minor | 11 | `0035` | 任务包已拆分 | Release admission + 生产另确认 |

硬约束：

- Batch 3–6 不得加生产可路由入口。
- Batch 4 仅 preview；confirm 须 Migration 4+5 与 `AF-RISK-DATA-001`。
- 生产只在 Batch 11 一次切换。
