# 0041 v1.6 完整数据生命周期

```yaml
status: backlog
phase: planning
blockers:
  - 0040 ownership and authorization model must complete
  - EXPORT and DELETE confirmation packets required before implementation
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm db:validate
  - pnpm risk:preflight
  - pnpm check
residualRiskIds:
  - AF-RISK-DATA-001
releaseRequired: true
```

## 目标

实现数据清单、Workspace/账户导出、回收站、删除预览、冷静期、物理删除、附件对账和备份删除账本。

## 独立确认包

- DATA-EXPORT：导出范围、脱敏、临时包、一次性下载和撤销。
- DATA-DELETE：不可逆范围、冷静期、冻结、附件、失败补偿、备份恢复后删除账本重放。

## 验收与关闭

- 对象、附件、manifest 和 hash 一致；敏感 secret/internal path 不导出。
- 删除预览与实际范围一致，kill-point/重试/恢复/备份复活防护通过。
- 完成证据只能让 `AF-RISK-DATA-001` 进入人工关闭复核，不自动关闭。

## 回滚

- 导出可撤销 grant 并清理临时包；删除开始前保存范围 hash 和受控备份，处理中断进入可恢复状态。
