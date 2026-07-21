# v1.1 Batch 8 画布与知识工作台

```yaml
status: done
phase: complete
blockers: []
risk: high
ownerSkill: areaforge-product-experience
validation:
  - pnpm check
  - pnpm governance:preflight
  - pnpm audit:prod
  - pnpm smoke:local-ux:selftest
residualRiskIds: []
releaseRequired: false
```

## 目标

Migration 7 layout/motivation/notification schema；隔离验收开放画布、考纲、卡片、错题、资料、导入与统一复习页。动机/通知/AI 入口继续隐藏。依赖 `@xyflow/react` 须先过 dependency admission。

## 完成摘要

- Migration 7 additive schema：`KnowledgeCanvasLayout/NodeLayout`、`MotivationItem/ReminderState`、`NotificationPreference`、`AiDraftOperation`；临时库 `areaforge_v11m7` migrate deploy 通过。
- `@xyflow/react@12.11.2` 准入至 `@areaforge/web`；governance/audit 通过；无 telemetry SaaS。
- `GET /api/knowledge-canvas` + `PUT|DELETE /api/knowledge-canvas/layout`；Note API 扩展 kind/相关节点等。
- `/knowledge/*` 页面与 App Shell「知识」入口；legacy `/syllabus|/notes|/mistakes` 重定向；动机/通知/AI/阶段仍隐藏。
- **未**生产 migration deploy；**未**关闭 residual。

## 验证收口（本会话）

| 命令 | 结果 |
|---|---|
| `pnpm db:validate` | PASS |
| `pnpm check` | PASS |
| `pnpm governance:preflight` | PASS（`@xyflow/react` 准入边界沿用） |
| `pnpm audit:prod` | PASS（`--audit-level high`；现存 moderate `yaml` 与 xyflow 无关） |
| `DATABASE_URL=…@127.0.0.1:54333/areaforge_v11m7 pnpm db:migrate:deploy` | PASS（含 `20260721230000_v11_m7_canvas_motivation_notification`） |
| `pnpm --filter @areaforge/core test` | PASS（含 `knowledge canvas layout conflict, layered load, and mobile read-only layout`） |
| `pnpm smoke:local-ux:selftest` | PASS（nav 隔离 + 移动只读/快捷创建 fixture） |

硬条件：

1. 代码审阅：分层 `selectCanvasChildren`；布局 CAS `expectedRevision` → `LAYOUT_REVISION_CONFLICT`；Migration 7 additive；快捷创建仅链到 canonical `/knowledge/*` 与 `/today/plan`，无画布私有写对象。
2. 新增测：core 布局冲突/分层 depth/移动只读 + selftest 客户端只读/无私有写 API fixture。
3. App Shell 禁止 `/motivation`、`/settings/notifications`、`/stage`；无 AI 导航入口。
