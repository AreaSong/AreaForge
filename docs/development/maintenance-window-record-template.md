# Maintenance Window Record Template

本模板用于记录每日、每周、每月、release 或 incident 后维护窗口的只读检查摘要。它不执行检查本身，不连接生产，不读取密钥，不写生产，也不替代 release record、incident record 或 restore drill record。

记录完成后运行：

```bash
pnpm maintenance:window:validate docs/development/maintenance-window-<date-or-id>.md
```

## 模板

```text
windowId: <maintenance-window-id>
startedAt: <ISO-8601 timestamp>
finishedAt: <ISO-8601 timestamp>
operator: <operator>
cadence: daily/weekly/monthly/release/incident
environment: production/staging/local/ci
commandsRun: pnpm enterprise:operability:preflight, pnpm maintenance:cadence:preflight, pnpm residuals:review-due, pnpm ops:readiness:summary, pnpm ops:evidence:bundle, pnpm ops:alert:preview
readinessSummaryHash: <sha256-or-not-applicable>
evidenceBundleHash: <sha256-or-not-applicable>
alertPreviewHash: <sha256-or-not-applicable>
residualReviewStatus: pass/warn/fail
dueResidualRiskIds: <AF-RISK-* IDs or none>
decisions: <decisions made, or none>
followUpTasks: <task/docs/workflow links or none>
result: pass/warn/fail/blocked
residualRiskIds: <AF-RISK-* IDs or none>
safetyFacts:
  productionWriteAttempted: no
  serverCommandAttempted: no
  backupRestoreAttempted: no
  migrationAttempted: no
  updaterApplyAttempted: no
  rollbackAttempted: no
  secretValuePrinted: no
```

## 关闭条件

- `commandsRun` 至少包含 `pnpm maintenance:cadence:preflight` 和 `pnpm residuals:review-due`。
- 若存在 due 或 overdue residual，必须在 `dueResidualRiskIds` 中列出，并说明 follow-up。
- `result: pass` 不能和 `residualReviewStatus: fail` 同时出现。
- 记录不得包含生产 `.env`、密钥、数据库 URL、session cookie、附件内容、完整 prompt/raw response 或真实学习内容。
