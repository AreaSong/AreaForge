# 标准 Release 记录模板

本模板用于后续每个进入线上的 AreaForge 版本。若发布记录需要进入仓库可追溯证据，复制为
`docs/development/release-vX.Y.Z-record.md`；服务器私有备份、updater 原始日志和 smoke 明细可以保留在
运维目录，但仓库记录必须摘要 Release tag、镜像 digest、健康检查、update-agent 状态、回滚目标和残余风险。

本模板不是发布授权，不执行 GitHub Release、Docker、备份、恢复、migration 或 updater。真实生产发布、
备份恢复、migration deploy、签名策略变化、自动应用策略变化和服务器命令仍需高风险确认。

发布记录完成后运行：

```bash
pnpm release:evidence:validate docs/development/release-vX.Y.Z-record.md attachment-reconciliation.csv attachment-reconciliation-summary.json
```

校验器会强制 `releaseEvidenceBundleHash` 存在，并与当前记录字段计算出的 bundle hash 一致；草稿生成器应先写入该 hash，再交给维护者复核。

发布或更新后的运行态证据另行生成：

```bash
pnpm ops:evidence:bundle
pnpm ops:alert:preview
```

若本次 Release 用于关闭或复核 `AF-RISK-SC-001` / `AF-RISK-SC-002`，另建
`docs/development/release-supply-chain-vX.Y.Z.md` 并运行：

```bash
AREAFORGE_SC002_RELEASE_RECORD=docs/development/release-supply-chain-vX.Y.Z.md pnpm sc:sc-002:preflight
pnpm release:supply-chain:validate docs/development/release-supply-chain-vX.Y.Z.md
```

附件对账 CSV 和双向 summary 是发布记录必需输入：

```bash
pnpm release:evidence:validate docs/development/release-vX.Y.Z-record.md attachment-reconciliation.csv attachment-reconciliation-summary.json
```

附件对账 CSV 只能是 `report_only`；summary 只保存计数和 file-only/unsafe 文件名 SHA256。不得把密钥、数据库 URL、完整 prompt/raw response、附件内容、绝对上传路径或生产 `.env` 写入发布记录。

## 模板

```text
releaseId: <release-id>
releasedAt: <ISO-8601 timestamp>
operator: <operator>
gitCommit: <commit-sha>
sourceBaseline:
  sourceDocs: <docs/tasks/workflow paths>
  sourceHashOrCommit: <commit-or-sha256-summary>
claimBoundary:
  doesNotProve: production updater apply, backup/restore execution, migration execution, rollback execution, residual risk closure
releaseTag: vX.Y.Z
releaseUrl: https://github.com/AreaSong/AreaForge/releases/tag/vX.Y.Z
AREAFORGE_IMAGE: ghcr.io/areasong/areaforge-web:vX.Y.Z
imageDigest: ghcr.io/areasong/areaforge-web:vX.Y.Z@sha256:<64-hex>
webImageDigest: ghcr.io/areasong/areaforge-web:vX.Y.Z@sha256:<64-hex>
migrationImageDigest: ghcr.io/areasong/areaforge-migration:vX.Y.Z@sha256:<64-hex>
sbomAsset: areaforge-sbom.spdx.json
sbomSha256: <64-hex-or-not-applicable>
provenanceAsset: areaforge-provenance.json
provenanceSha256: <64-hex-or-not-applicable>
supplyChainEvidence: <SHA256SUMS includes manifest/SBOM/provenance/compose; signature verification result>
releaseSupplyChainEvidenceHash: <sha256 emitted by pnpm release:supply-chain:validate or not-applicable>
composeHash: <64-hex>
nginxConfigHash: <64-hex>
previousImage: <previous-image-or-not-applicable>
previousAppVersion: <previous-version>
databaseBackupPath: <private-ops-path-or-not-applicable>
databaseBackupSha256: <64-hex>
uploadsBackupPath: <private-ops-path-or-not-applicable>
uploadsBackupSha256: <64-hex>
envBackupPath: <private-ops-path-or-not-applicable>
envBackupSha256: <64-hex>
composeConfigBackupPath: <private-ops-path-or-not-applicable>
nginxConfigBackupPath: <private-ops-path-or-not-applicable>
migrationVersion: <migration-version-or-not-applicable>
migrationApplied: yes/no
migrationRunner: controlled_release_workdir/one_off_migration_job/not-applicable
signatureVerification: <SHA256SUMS and cosign/GPG result>
updateAgentStatus: <current/latest/blocker/timer/rollback summary>
rollbackTargetVersion: <version-or-not-applicable>
rollbackTargetImage: <image@sha256-or-not-applicable>
releaseEvidenceBundleHash: <sha256 emitted by pnpm release:evidence:validate>
operationalEvidenceBundleHash: <bundleHash emitted by pnpm ops:evidence:bundle>
alertPreviewStatus: <ok|watch|warning|critical from pnpm ops:alert:preview>
preflight:
  pnpmCheck: PASS/FAIL
  composeConfig: PASS/FAIL
  prodComposeConfig: PASS/FAIL
restoreDrill:
  databaseImported: yes/no
  uploadsRestored: yes/no
  attachmentHashMatched: yes/no/not-applicable
attachmentReconciliationCsvPath: reports/attachment-reconciliation.csv
attachmentReconciliationCsvSha256: sha256:<64-hex>
attachmentReconciliationSummaryPath: reports/attachment-reconciliation-summary.json
attachmentReconciliationSummaryHash: sha256:<64-hex>
attachmentReconciliationStatus: pass/mismatch
postReleaseSmoke:
  health: PASS/FAIL
  login: PASS/FAIL
  dashboard: PASS/FAIL
  taskTimerReview: PASS/FAIL
  syllabusNotesAnalyticsReports: PASS/FAIL
  attachmentSmoke: PASS/FAIL
  aiFallbackOrProvider: PASS/FAIL
rollbackDecision: <keep-current|rollback|roll-forward|not-applicable>
rollbackPlan: <rollback or remediation plan>
rollbackDrillResult: <result>
rollbackDurationMinutes: <integer-minutes>
databaseRestoreRequired: yes/no
uploadsRestoreRequired: yes/no
rollbackFailureReason: <reason-or-none>
residualRisk: <summary>
residualRiskIds: <comma-separated AF-RISK-* IDs or none>
followUpTasks: <task/docs/workflow links or none>
expectedFailureOrStopConditions:
  migrationFailed: <stop condition>
  smokeFailed: <stop condition>
  logLeakDetected: <stop condition>
  attachmentHashMismatch: <stop condition>
  backupMissing: <stop condition>
```

附件对账字段必须进入 `releaseEvidenceBundleHash`。`yes` 只用于至少一条附件且 CSV 全匹配、summary=`pass`；`no` 必须绑定 `mismatch` summary；`not-applicable` 必须绑定仅表头 CSV 和数据库/上传目录双零计数 summary。summary 只报告 `fileOnlyCount`、`unsafeEntryCount` 等计数及文件名 SHA256，不保存绝对路径、文件内容，也不授权清理、移动或修复。

## 关闭条件

- GitHub Release workflow 成功，stable release 没有 unsigned placeholder。
- `SHA256SUMS` 与签名校验结果记录清楚。
- 新发布若由当前 Release workflow 生成，记录 SBOM/provenance 资产名、hash 和校验摘要；历史 `v0.1.5` 这类发布没有对应资产时，不回填假证据，必须在残余风险中保留 `AF-RISK-SC-001`。
- 若本次 Release 用于关闭或复核 `AF-RISK-SC-001` / `AF-RISK-SC-002`，`releaseSupplyChainEvidenceHash` 必须记录 `pnpm release:supply-chain:validate` 的输出 hash；未生成签名 Release 供应链记录时写 `not-applicable` 并保留对应 residual。
- Web 和 migration image 使用不可变 digest。
- 生产更新前备份路径与 hash 可追溯，且不提交备份本体或密钥。
- migration runner 与结果明确；无 migration 时写 `migrationApplied: no` 和 `migrationRunner: not-applicable`。
- 发布后至少记录公网 health；若缺少登录/核心只读 smoke，必须记录残余风险 ID。
- update-agent 状态、rollback target 和 `AREAFORGE_AUTO_APPLY` 策略明确。
- 残余风险使用 `docs/development/residual-risk-ledger.md` 中的稳定 ID。
- `pnpm release:evidence:validate` 输出的 `releaseEvidenceBundleHash` 已写入发布记录或运维交接摘要。
- `pnpm ops:evidence:bundle` 输出的 `operationalEvidenceBundleHash` 已写入发布记录或运维交接摘要；若证据包状态不是 `ready`，必须保留对应 residual risk IDs。
- `pnpm ops:alert:preview` 输出的 `alertPreviewStatus` 已写入发布记录或运维交接摘要；若 `wouldNotify=true` 或状态不是 `ok`，必须记录 owner、recommendedAction 和 residual risk IDs。
- `claimBoundary.doesNotProve` 必须明确说明该 Release 记录不能单独证明生产 updater apply、backup/restore、migration、rollback 或 residual risk closure。
