# v1.1 Batch 8 画布与知识工作台

```yaml
status: backlog
phase: awaiting-high-risk-confirmation
blockers:
  - batch7-complete
risk: high
ownerSkill: areaforge-product-experience
validation:
  - pnpm check
  - pnpm governance:preflight
residualRiskIds: []
releaseRequired: false
```

## 目标

Migration 7 layout/motivation/notification schema；隔离验收开放画布、考纲、卡片、错题、资料、导入与统一复习页。动机/通知/AI 入口继续隐藏。依赖 `@xyflow/react` 须先过 dependency admission。
