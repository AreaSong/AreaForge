# Rollback Proof Record Template

本模板用于记录已获明确高风险确认后完成的 AreaForge 回滚证明。它不执行 rollback、restore、backup、migration、Docker、Nginx、compose 或服务器命令，也不自动重新开放更新通道、修改 residual 台账或证明未来持续健康。

记录完成后运行：

```bash
pnpm rollback:proof:validate <rollback-proof-record.md|txt>
```

```text
rollbackProofId: <rollback-proof-id>
recordedAt: <ISO-8601 timestamp>
rollbackStartedAt: <ISO-8601 timestamp>
rollbackFinishedAt: <ISO-8601 timestamp>
operator: <operator>
environment: production/staging/local
evidenceClass: production/runtime/local
rollbackSource: updater/manual-operator
highRiskConfirmation: yes
sourceVersion: <X.Y.Z>
sourceImage: <image@sha256:64-hex>
targetVersion: <X.Y.Z>
targetImage: <image@sha256:64-hex>
sourceUpdateRecordHash: sha256:<64-hex>
rollbackOperationRecordHash: sha256:<64-hex>
postRollbackUpdateRecordHash: sha256:<64-hex>
postRollbackEvidenceBundleHash: sha256:<64-hex>
postRollbackSmokeRecordHash: sha256:<64-hex>
postRollbackHealth: pass/fail
postRollbackAuthenticatedSmoke: pass/fail
databaseAccessible: pass/fail/not-checked
uploadsAccessible: pass/fail/not-checked
attachmentAccess: pass/fail/not-applicable/not-checked
autoApplyPolicy: none/patch
updateAgentBlocker: none/present/unknown
historicalRecordsPreserved: yes/no
databaseRestoreAttempted: yes/no
uploadsRestoreAttempted: yes/no
rollbackDurationMinutes: <positive integer>
reopenDecision: keep-closed/ready-for-human-review
reopenConditions: <explicit conditions for allowing future update/apply attempts>
residualRiskIds: <AF-RISK-* comma list or none>
doesNotProve: future production health, production restore readiness, residual risk closure, automatic update-channel reopen
safetyFacts:
  secretValuePrinted: no
  realStudyContentIncluded: no
  residualLedgerUpdated: no
  updateChannelReopened: no
```

`ready-for-human-review` 只表示记录已达到人工复核门槛，仍不自动重新开放 updater apply、自动应用策略或 residual 台账。生产记录必须使用 `evidenceClass: production`，并要求 health、authenticated smoke、database、uploads 和 attachment access 全部达到允许状态，`autoApplyPolicy: none`、`updateAgentBlocker: none`、`historicalRecordsPreserved: yes`。

数据库或 uploads restore 是否执行必须如实记录；该字段不授权 restore，也不能用应用镜像回滚证明数据恢复已完成。记录不得包含 `.env`、密码文件、token、私钥、数据库 URL、附件内容、真实学习正文、生产绝对备份路径或原始日志。
