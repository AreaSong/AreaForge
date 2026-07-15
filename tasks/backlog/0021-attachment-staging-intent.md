# 附件 Staging 与写入意图

```yaml
status: awaiting-high-risk-confirmation
risk: high
ownerSkill: areaforge-file-storage-safety
validation:
  - attachment crash-window selftest
  - pnpm attachment:reconciliation:summary:selftest
  - pnpm risk:preflight
residualRiskIds:
  - AF-RISK-OPS-007
releaseRequired: true
```

目标：用 staging file、fsync、PENDING -> READY 写入意图和条件补偿缩小“文件已落盘但 metadata 未提交”的
崩溃窗口。实施前需另行确认 additive migration、旧附件兼容、备份/恢复和回滚边界；不自动清理孤儿文件。
