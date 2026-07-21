# v1.1 Batch 4 学习树 preview 与 Migration 4

```yaml
status: backlog
phase: awaiting-high-risk-confirmation
blockers:
  - batch3-complete
risk: high
ownerSkill: areaforge-product-experience
validation:
  - pnpm check
  - pnpm db:validate
residualRiskIds: []
releaseRequired: false
```

## 目标

实现学习树 V1 parser/exporter、模板、无业务写入 preview、diff；实施 Migration 4 StudyResource schema。不开放 confirm。
