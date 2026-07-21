# v1.1 Batch 3 工作区 / Inbox / Migration 1–3

```yaml
status: done
phase: complete
blockers: []
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm db:validate
  - pnpm check
  - pnpm ops:v11:m1m3:runtime:selftest
residualRiskIds: []
releaseRequired: false
```

## 目标

在隔离环境实施 Migration 1–3、考试工作区/科目兼容、知识卡片关系、里程碑/依赖与 PlanInbox core；只提供 API/fixture，不开放生产入口。

## 完成摘要（2026-07-21）

- Migration 1–3 已落库：`20260721120000` / `20260721130000` / `20260721140000`
- Subject `code` → 可空 `legacyCode`；partial unique 覆盖 workspace / legacy 范围
- API：`/api/exam-workspaces/**`、`/api/plan-milestones/**`、`/api/plan-inbox/**`（dismiss/reopen，无 convert）、`/api/tasks/:id/dependencies/**`
- `packages/core` 工作区/legacy/依赖/Inbox/知识卡片规则 + 单元测试
- 临时库 selftest：`AREAFORGE_V11_M1M3_ISOLATED_DB=1 pnpm ops:v11:m1m3:runtime:selftest`
- Batch 3 **无 lockfile 新依赖**；不开放生产页面；**无** PlanInbox convert（Batch 6）；**未**生产 migration deploy；**未**关闭 residual

## 禁止（仍有效）

- 不新增生产可路由页面或导航入口。
- 不在本批执行生产 migration / updater / residual 关闭。
