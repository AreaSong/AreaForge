# OPS-006 Production Evidence Template

## 目的

该模板只保存 `AF-RISK-OPS-006` 的脱敏生产终态证据。它不能替代签名 Release、生产执行确认、通用 Release evidence、人工 residual 复核或长期运营 gate。

证据顺序固定为：

```text
local_verified
-> matching signed Release
-> independent production rollout confirmation
-> fresh before doctor
-> backup and additive migration/deploy
-> health and authenticated read-only smoke
-> separately confirmed controlled synthetic concurrency probe
-> fresh after doctor
-> ready_for_ops006_human_review
```

## 主记录

复制下列字段到一个新的版本化记录，例如 `ops-006-production-evidence-v0.1.8-YYYYMMDD.txt`。所有 hash 均由实际文件或 validator 输出填入，不得使用占位值。

```text
recordId:
recordedAt:
environment: production
releaseTag:
packageVersion:
gitCommit:
webImageDigest:
migrationImageDigest:
migrationPath: prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql
migrationSha256:
implementationSha256:
maintenanceWindowId:
rolloutConfirmationId:
rolloutConfirmationScopeSha256:
controlledProbeConfirmationId:
controlledProbeConfirmationScopeSha256:
rollbackTargetImage:
databaseBackupSha256:
releaseSupplyChainRecordSha256:
releaseEvidenceRecordSha256:
localVerificationStatus: pass
signedReleaseStatus: pass
rolloutConfirmationStatus: pass
controlledProbeConfirmationStatus: pass
productionMigrationStatus: pass
productionDeploymentStatus: pass
canonicalIndexVerificationStatus: pass
authenticatedSmokeStatus: pass
controlledConcurrencyProbeStatus: pass
rollbackTargetStatus: pass
migrationVersion: 20260718010000_add_active_session_unique_index
migrationRunner: <controlled_release_workdir-or-one_off_migration_job>
indexRollbackPolicy: retain
beforeDoctorFile: doctor-before-v0.1.8.json
beforeDoctorFileSha256:
beforeDoctorHash:
afterDoctorFile: doctor-after-v0.1.8.json
afterDoctorFileSha256:
afterDoctorHash:
rolloutEvidenceFile: rollout-v0.1.8.json
rolloutEvidenceFileSha256:
rolloutEvidenceHash:
releaseSupplyChainEvidenceHash:
releaseEvidenceBundleHash:
evidenceFreshnessMaxAgeHours: 24
residualRiskIds: AF-RISK-OPS-006
doesNotProve: AF-RISK-OPS-006 residual closure,historical production data repair,future concurrency safety after this evidence window,database or uploads restore execution,secrets absence beyond validator scan
recordHash:
safetyFacts:
  secretValuePrinted: no
  realUserBusinessDataWritten: no
  syntheticProbeWriteAttempted: yes
  historicalRepairAttempted: no
  destructiveMigrationAttempted: no
  destructiveRollbackAttempted: no
  businessTextIncluded: no
  objectIdentifiersIncluded: no
  databaseUrlIncluded: no
  residualLedgerUpdated: no
  webRuntimeServerCommandAttempted: no
```

`implementationSha256` 绑定 Release commit 中以下实现文件的有序 source hash：

- `apps/web/lib/study/check-in-service.ts`
- `apps/web/lib/study/concurrency.ts`
- `apps/web/lib/study/service.ts`
- `apps/web/lib/study/simulation-service.ts`
- `apps/web/lib/study/syllabus-service.ts`
- `apps/web/lib/study/task-debt-reorder-service.ts`

validator 必须用 `git show <release-commit>:<path>` 重算这些值，不得读取脏工作树代替 Release source。

## Rollout JSON

`rolloutEvidenceFile` 使用 exact-key JSON：

```json
{
  "schemaVersion": 1,
  "mode": "redacted_ops006_production_rollout",
  "recordedAt": "<ISO-8601>",
  "environment": "production",
  "identity": {
    "releaseTag": "v0.1.8",
    "packageVersion": "0.1.8",
    "gitCommit": "<40-hex>",
    "webImageDigest": "<immutable digest>",
    "migrationImageDigest": "<immutable digest>",
    "migrationPath": "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql",
    "migrationVersion": "20260718010000_add_active_session_unique_index",
    "migrationSha256": "sha256:<64-hex>",
    "implementationSha256": "sha256:<64-hex>",
    "maintenanceWindowId": "<redacted id>"
  },
  "deployment": {
    "startedAt": "<ISO-8601>",
    "finishedAt": "<ISO-8601>",
    "confirmationId": "<redacted id>",
    "confirmationScopeSha256": "sha256:<64-hex>",
    "backupStatus": "pass",
    "databaseBackupSha256": "<64-hex>",
    "agentUpdaterMatchStatus": "pass",
    "migrationRunner": "one_off_migration_job",
    "migrationApplied": true,
    "applicationDeploymentStatus": "pass",
    "canonicalIndex": {
      "name": "StudySession_one_active_idx",
      "unique": true,
      "expression": "(1)",
      "statuses": ["RUNNING", "PAUSED"],
      "verificationStatus": "pass",
      "definitionHash": "<validator canonical hash>"
    }
  },
  "controlledProbe": {
    "recordedAt": "<ISO-8601>",
    "confirmationId": "<independent redacted probe confirmation id>",
    "confirmationScopeSha256": "sha256:<canonical controlled-probe scope hash>",
    "syntheticScope": true,
    "start": {
      "successCount": 1,
      "conflictCount": 1,
      "httpStatus": 409,
      "reasonCode": "ACTIVE_SESSION_EXISTS",
      "activeSessionCountAfter": 1
    },
    "end": {
      "successCount": 1,
      "conflictCount": 1,
      "httpStatus": 409,
      "reasonCode": "SESSION_STATE_CONFLICT"
    },
    "taskCas": {
      "successCount": 1,
      "conflictCount": 1,
      "httpStatus": 409,
      "reasonCode": "TASK_STATE_CONFLICT",
      "eventOrChildDuplicateCount": 0
    },
    "sideEffects": {
      "effectiveMinutes": 25,
      "taskMinutesDelta": 25,
      "syllabusMinutesDelta": 25,
      "auditEventDelta": 1,
      "taskDebtEventDelta": 1,
      "checkInSessionDelta": 1
    },
    "checkIn": {
      "concurrentWrites": 2,
      "committedWrites": 2,
      "aggregateMatchesCommittedTaskState": true
    },
    "cleanupStatus": "pass"
  },
  "healthSmoke": {
    "recordedAt": "<ISO-8601>",
    "health": "pass",
    "authenticatedReadOnlySmoke": "pass"
  },
  "doctorBinding": {
    "beforeDoctorHash": "sha256:<64-hex>",
    "afterDoctorHash": "sha256:<64-hex>"
  },
  "rollback": {
    "targetImage": "<immutable previous Web digest>",
    "applicationRollbackReady": true,
    "indexPolicy": "retain",
    "databaseRestoreAttempted": false,
    "uploadsRestoreAttempted": false
  },
  "safetyFacts": {
    "secretValuePrinted": false,
    "realUserBusinessDataWritten": false,
    "syntheticProbeWriteAttempted": true,
    "historicalRepairAttempted": false,
    "destructiveMigrationAttempted": false,
    "destructiveRollbackAttempted": false,
    "businessTextIncluded": false,
    "objectIdentifiersIncluded": false,
    "databaseUrlIncluded": false,
    "residualLedgerUpdated": false,
    "webRuntimeServerCommandAttempted": false
  },
  "rolloutHash": "sha256:<canonical hash>"
}
```

不得保存账号、用户 ID、task/session/check-in ID、标题、正文、原始请求/响应、cookie、数据库 URL 或服务器日志。controlled probe 只能使用独立 synthetic scope，并需要与基础 rollout 分开的写入型确认。`migrationRunner` 必须把占位符替换为 `controlled_release_workdir` 或 `one_off_migration_job` 中的一个合法值，不能保留组合文本。

## Doctor 绑定

- before/after 都必须通过 `pnpm ops:data-integrity:validate`。
- `source.database=configured_read_only_query`、`databaseReadAttempted=true`。
- session/task 四项和附件 reconciliation 全部为 `pass`，`overall=pass`。
- before 与 after 的文件 SHA 和 `doctorHash` 必须不同。
- `AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD` 必须与 OPS-006 after-doctor 的文件 SHA 和 `doctorHash` 完全一致。

## 验证

```bash
pnpm ops:ops-006:evidence:selftest
pnpm ops:ops-006:production:preflight:selftest
pnpm ops:ops-006:confirmation-scopes <production-record-draft>
pnpm ops:ops-006:evidence:validate \
  <production-record> \
  <release-supply-chain-record> \
  <release-assets-dir> \
  <release-evidence-record> \
  <attachment-reconciliation.csv> \
  <attachment-reconciliation-summary.json>

AREAFORGE_OPS006_RELEASE_RECORD=<release-record> \
AREAFORGE_OPS006_RELEASE_ASSETS_DIR=<release-assets-dir> \
AREAFORGE_OPS006_RELEASE_EVIDENCE_RECORD=<release-evidence-record> \
AREAFORGE_OPS006_RELEASE_RECONCILIATION_CSV=<attachment-reconciliation.csv> \
AREAFORGE_OPS006_RELEASE_RECONCILIATION_SUMMARY=<attachment-reconciliation-summary.json> \
AREAFORGE_OPS006_PRODUCTION_EVIDENCE_RECORD=<production-record> \
AREAFORGE_OPS006_ROLLOUT_CONFIRMATION_ID=<redacted-rollout-confirmation-id> \
AREAFORGE_OPS006_ROLLOUT_CONFIRMATION_SCOPE_SHA256=sha256:<canonical-rollout-scope> \
AREAFORGE_OPS006_PROBE_CONFIRMATION_ID=<independent-redacted-probe-confirmation-id> \
AREAFORGE_OPS006_PROBE_CONFIRMATION_SCOPE_SHA256=sha256:<canonical-controlled-probe-scope> \
pnpm ops:ops-006:production:preflight -- --require-human-review-ready
```

`confirmation-scopes` 只读取草稿中的 Release tag/commit、Web/migration immutable digest 和 rollback target，输出 domain-separated rollout/probe canonical SHA256。将两个值分别写入确认包、主记录和对应环境变量；它不构成确认，也不授权 Release、rollout 或 probe。

以上命令全部只读。它们不创建 Release，不运行 migration/deploy/probe，不访问服务器，不备份或恢复，不读取密钥，也不修改 residual 台账。
