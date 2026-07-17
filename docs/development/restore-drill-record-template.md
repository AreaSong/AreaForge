# Restore Drill Record Template

本模板用于记录例行或维护窗口中的恢复演练。它只适用于 local、staging 或 temporary 环境；不授权生产 restore，不删除备份，不移动上传目录，不修改生产数据。

记录完成后运行：

```bash
pnpm restore:drill:validate docs/development/restore-drill-<date-or-id>.md
```

## 模板

```text
drillId: <restore-drill-id>
drilledAt: <ISO-8601 timestamp>
operator: <operator>
environment: local/staging/temporary
scope: monthly/release/pre-migration/post-incident
sourceBackupVersion: <version-or-label>
databaseBackupHash: <sha256-or-not-applicable>
uploadsBackupHash: <sha256-or-not-applicable>
envConfigBackupHash: <sha256-or-not-applicable>
restoreTarget: <temporary target summary>
restoreCommandSummary: <redacted command summary, no secrets>
databaseRestoreResult: PASS/FAIL/not-applicable
uploadsRestoreResult: PASS/FAIL/not-applicable
attachmentHashMatched: PASS/FAIL/not-applicable
homeReadResult: PASS/FAIL/not-applicable
loginResult: PASS/FAIL/not-applicable
appHealthAfterRestore: PASS/FAIL/not-applicable
rollbackDecision: not-needed/repeat-drill/open-incident/defer
drillEvidenceHash: <sha256>
residualRiskIds: <AF-RISK-* IDs or none>
followUpTasks: <task/docs/workflow links or none>
safetyFacts:
  productionRestoreAttempted: no
  productionWriteAttempted: no
  destructiveActionAttempted: no
  serverCommandAttempted: no
  secretValuePrinted: no
  realStudyContentIncluded: no
  backupDeleted: no
  uploadDeleted: no
```

## 关闭条件

- 数据库、上传目录、附件对账、首页读取、登录和应用健康六项结果必须全部是 `PASS`，才能作为一次成功恢复演练。
- `drillEvidenceHash` 必须等于排除自身后的规范化记录 evidence hash；修改任一记录字段后旧 hash 必须失效。validator 只证明记录内容绑定，不证明备份归档真实存在或恢复动作真实执行。
- 失败项必须关联 residual ID、任务或 incident follow-up。
- 记录不得包含数据库 URL、备份私有路径中的敏感段、生产 `.env`、密码、API key、附件内容或真实学习内容。
