# v1.1 阶段包索引（S0–S5）

本文件是学习行动中心**阶段划分的执行索引**，不替代 `workflow/versions/v1.1-learning-action-center.md` 规格正文。

| 大阶段 | Batch | Task | 本会话交付 | 后续实现 |
|---|---|---|---|---|
| S0 基线对齐 | — | workflow 头信息 + 隔离分支 | 已完成 | — |
| S1 文档与任务 | 0 | `tasks/active/0025-v11-batch0-doc-sync.md` | Exact docs / DATA-001 / 确认包骨架 / 任务拆分 | 维护者审阅后可将 0025 移入 done |
| S2 安全门禁 | 1–2 | `tasks/backlog/0026-v11-batch1-2-ops-gate-review.md` | `docs/development/v11-s2-ops006-007-gate-review.md` | 维护者认可后归档 task |
| S3 数据与核心服务 | 3 | `tasks/done/0027-v11-batch3-workspace-inbox-core.md` | Migration 1–3 + workspace/Inbox core API/fixture（隔离，无生产入口） | Batch 4–6 |
| S3 数据与核心服务 | 4 | `tasks/done/0028-v11-batch4-learning-tree-preview.md` | Migration 4 + V1 parser/preview/templates/export（隔离，无 confirm） | Batch 5 |
| S3 数据与核心服务 | 5 | `tasks/done/0029-v11-batch5-resources-import-confirm.md` | Migration 5 + StudyResource 隔离 API + 原子 confirm/历史/导出；DATA-001 生命周期已接受（residual 未关） | Batch 6 |
| S3 数据与核心服务 | 6 | `tasks/done/0030-v11-batch6-review-checkin-v2.md` | Migration 6 + 统一复习/CheckIn v2/恢复三阶/桥接/Inbox convert（隔离，无生产入口） | Batch 7 |
| S4 可见产品 | 7 | `tasks/done/0031-v11-batch7-app-shell-today.md` | App Shell + `/today*` + `/focus` + `/quick-review` + 基础设置（隔离验收入口；无知识/动机/通知/AI/阶段全入口） | Batch 8 |
| S4 可见产品 | 8–10 | `0032`–`0034` | 任务包已拆分，**未写业务代码** | 画布与知识台起逐步开放 |
| S5 完整 minor | 11 | `0035` | 任务包已拆分 | Release admission + 生产另确认 |

硬约束：

- Batch 3–6 不得加生产可路由入口。
- Batch 4 仅 preview；Batch 5 已开放隔离 confirm（须 Migration 4+5 与 DATA-001 生命周期接受；residual 不自动关）。
- 生产只在 Batch 11 一次切换。
