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
| S4 可见产品 | 8 | `tasks/done/0032-v11-batch8-canvas-knowledge.md` | Migration 7 + `@xyflow/react` + `/knowledge/*` 画布/概览/考纲/卡片/错题/资料/导入/统一复习（动机/通知/AI/阶段仍隐藏） | Batch 9 |
| S4 可见产品 | 9 | `tasks/done/0033-v11-batch9-motivation-ai.md` | 动机内容库/提醒、通知偏好与前台通知、四类显式 AI 草稿、`AI_PAYLOAD_BINDING_SECRET`；开放设置 profile/notifications/ai | Batch 10 |
| S4 可见产品 | 10 | `tasks/done/0034-v11-batch10-stage-simulation-loop.md` | Migration 8 + 七天计划/模拟/报告/阶段 canonical 入口 + 结构化失分/补救入箱/报告与阶段确认闭环；临时库、新增事务/只读/跨页 fixture 与 current-bound 桌面/移动/409 证据已通过 | Batch 11 Release admission |
| S5 完整 minor | 11 | `tasks/active/0035-v11-batch11-minor-release.md` | `v1.1.0` 本地完成记录、完整验证候选与候选 commit 冻结；SC-002/SC-004 按目标 commit 重采 | complete minor Release admission、签名 Release 与生产动作分别确认 |

硬约束：

- Batch 3–6 不得加生产可路由入口。
- Batch 4 仅 preview；Batch 5 已开放隔离 confirm（须 Migration 4+5 与 DATA-001 生命周期接受；residual 不自动关）。
- 生产只在 Batch 11 一次切换。
- Batch 10 current-bound 体验记录为 `docs/development/product-experience-review-20260722-v11-batch10.md`；它只证明隔离本地 checkout，不替代签名 Release、生产 migration 或生产 smoke，也不自动关闭 residual。
- Batch 11 当前只推进本地候选：目标版本 `1.1.0`；签名 Release、production apply 与 residual 关闭均未执行。SC-002/SC-004 必须在候选 commit 冻结后按该 commit 重采，不能复用 `v0.1.9` 历史证据。
