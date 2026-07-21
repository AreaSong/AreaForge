# v1.1 Batch 5 资料与导入 confirm

```yaml
status: backlog
phase: awaiting-high-risk-confirmation
blockers:
  - batch4-complete
  - AF-RISK-DATA-001-lifecycle-confirmation
  - ops007-local-and-signed-patch
risk: high
ownerSkill: areaforge-file-storage-safety
validation:
  - pnpm check
  - pnpm db:validate
residualRiskIds:
  - AF-RISK-DATA-001
releaseRequired: false
```

## 目标

实现 FILE/LINK 资料与 Migration 5 导入历史/原子 confirm/一次性导出。DATA-001 未接受前不得开放 confirm。
