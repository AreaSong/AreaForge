# Maintenance Window Record Template

本模板用于记录每日、每周、每月、release 或 incident 后维护窗口的只读检查摘要。它不执行检查本身，不连接生产，不读取密钥，不写生产，也不替代 release record、incident record 或 restore drill record。

记录完成后运行：

```bash
pnpm maintenance:window:validate docs/development/maintenance-window-<date-or-id>.md
```

如果已经保存 `pnpm residuals:review-due`、`pnpm ops:readiness:summary`、`pnpm ops:evidence:bundle` 和 `pnpm ops:alert:preview`
的 redacted 输出，可先生成记录草稿：

```bash
AREAFORGE_MAINTENANCE_OPERATOR=<operator> \
AREAFORGE_MAINTENANCE_CADENCE=weekly \
AREAFORGE_MAINTENANCE_ENVIRONMENT=production \
AREAFORGE_MAINTENANCE_READINESS_FILE=/path/to/readiness-summary.json \
AREAFORGE_MAINTENANCE_EVIDENCE_BUNDLE_FILE=/path/to/operational-evidence-bundle.json \
AREAFORGE_MAINTENANCE_ALERT_PREVIEW_FILE=/path/to/alert-preview.json \
AREAFORGE_MAINTENANCE_RESIDUAL_REVIEW_FILE=/path/to/residual-review-due.log \
pnpm maintenance:window:record > /path/to/maintenance-window-record.txt
pnpm maintenance:window:validate /path/to/maintenance-window-record.txt
```

生成器只读取本地 redacted 证据文件和显式环境字段；`dueResidualRiskIds` 只从 residual review 文件或显式 `AREAFORGE_MAINTENANCE_DUE_RESIDUAL_IDS` 推导，不把普通告警 residual 当作到期复核项。它不连接生产、不读取密钥、不执行服务器命令、不写生产、不执行 backup/restore/migration/updater/rollback。

## 模板

```text
windowId: <maintenance-window-id>
startedAt: <ISO-8601 timestamp>
finishedAt: <ISO-8601 timestamp>
operator: <operator>
cadence: daily/weekly/monthly/release/incident
environment: production/staging/local/ci
commandsRun: pnpm enterprise:operability:preflight, pnpm maintenance:cadence:preflight, pnpm residuals:review-due, pnpm ops:readiness:summary, pnpm ops:evidence:bundle, pnpm ops:alert:preview
readinessOverall: pass/warn/fail/blocked/unknown/not-applicable
evidenceBundleStatus: ready/needs_attention/blocked/not-applicable
alertPreviewStatus: ok/watch/warning/critical/not-applicable
healthStatus: pass/warn/fail/blocked/unknown/not-applicable
updateAgentStatus: pass/warn/fail/blocked/unknown/not-applicable
authenticatedSmokeStatus: pass/warn/fail/blocked/unknown/not-applicable
backupStatus: pass/warn/fail/blocked/unknown/not-applicable
infrastructureStatus: pass/warn/fail/blocked/unknown/not-applicable
readinessSummaryHash: <sha256-or-not-applicable>
evidenceBundleHash: <sha256-or-not-applicable>
alertPreviewHash: <sha256-or-not-applicable>
residualReviewHash: <sha256-or-not-applicable>
residualReviewStatus: pass/warn/fail
dueResidualRiskIds: <AF-RISK-* IDs or none>
claimBoundary:
  doesNotProve: production health without live evidence, updater apply completion, backup/restore execution, migration execution, rollback execution, residual risk closure
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
- `claimBoundary.doesNotProve` 必须明确说明维护窗口记录不能替代 live evidence、updater apply、backup/restore、migration、rollback 或 residual risk closure 证据。
- 记录不得包含生产 `.env`、密钥、数据库 URL、session cookie、附件内容、完整 prompt/raw response 或真实学习内容。
