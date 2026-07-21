# v1.1 Batch 6 统一复习与 CheckIn v2

```yaml
status: done
phase: complete
blockers: []
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm check
  - pnpm db:validate
  - pnpm ops:v11:m6:runtime:selftest
  - pnpm --filter @areaforge/core test
residualRiskIds: []
releaseRequired: false
```

## 目标

Migration 6、统一复习、CheckIn v2、恢复三阶、任务桥接与 PlanInbox 原子转换；隔离 API/fixture，无生产入口。

## 完成摘要（2026-07-21）

- Migration 6：`20260721220000_v11_m6_review_checkin_v2`（ReviewSchedule/Event、CheckIn v2 字段、Recovery v2、桥接、Note/Mistake archivedAt、MasteryRetest.reviewEventId）
- 隔离 API：`/api/review-schedules/**`、corrections、`/api/check-ins`、`/api/recovery/**`、plan-inbox convert、bridge-*
- Core：间隔、CheckIn v2 聚合、Recovery 三阶规则
- 临时库 selftest：`AREAFORGE_V11_M6_ISOLATED_DB=1 pnpm ops:v11:m6:runtime:selftest`
- **无**生产页面/导航；**未**生产 migration；**未**关闭 residual

## 验证收口（2026-07-21）

| 命令 | 结果 |
|---|---|
| `pnpm db:validate` | PASS |
| `DATABASE_URL=…@127.0.0.1:54333/areaforge_v11m6 pnpm db:migrate:deploy` | PASS（含 Migration 6） |
| `AREAFORGE_V11_M6_ISOLATED_DB=1 pnpm ops:v11:m6:runtime:selftest` | PASS |
| `pnpm --filter @areaforge/core test` | PASS（68） |
| `pnpm --filter @areaforge/web typecheck` | PASS |

## 禁止（仍有效）

- 不新增生产可路由页面或导航入口。
- 不在本批执行生产 migration / updater / residual 关闭。
