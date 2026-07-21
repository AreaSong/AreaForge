# v1.1 Batch 3 工作区 / Inbox / Migration 1–3

```yaml
status: backlog
phase: awaiting-high-risk-confirmation
blockers:
  - batch1-2-gate-review
  - product-data-migration-confirmation
  - dependency-admission
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm db:validate
  - pnpm check
residualRiskIds: []
releaseRequired: false
```

## 目标

在隔离环境实施 Migration 1–3、考试工作区/科目兼容、知识卡片关系、里程碑/依赖与 PlanInbox core；只提供 API/fixture，不开放生产入口。

## 禁止

- 不新增生产可路由页面或导航入口。
