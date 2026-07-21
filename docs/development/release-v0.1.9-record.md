releaseId: release-v0.1.9
releasedAt: 2026-07-21T05:08:11Z
operator: maintainer-confirmed production updater apply (G5 on la)
gitCommit: 749692ba719d801f14186a94af97b96350380141
sourceBaseline:
  sourceDocs: AGENTS.md, README.md, docs/development/release-train.md, docs/development/high-risk-confirmation-packets.md, docs/development/residual-risk-ledger.md, workflow/versions/v0.1.9-long-term-operations-release.md
  sourceHashOrCommit: 749692ba719d801f14186a94af97b96350380141
claimBoundary:
  doesNotProve: database restore, uploads restore, auto-apply policy change, Web runtime server commands, OPS-002 write smoke, OPS-006 residual closure, secret disclosure, full product UX verification, OPS-007/OPS-008 production migration or updater hold/drain execution
  evidenceStatus: production apply to 0.1.9 recorded with redacted backup hashes; read-only extra smoke, OPS-006 controlled probe, and controlled write-path smoke (task/timer/review, attachment upload/download, AI local_rule fallback) passed in mw-residual-closeout-20260721 / closeout sudo window
releaseTag: v0.1.9
releaseUrl: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.9
AREAFORGE_IMAGE: ghcr.io/areasong/areaforge-web:v0.1.9
imageDigest: ghcr.io/areasong/areaforge-web:v0.1.9@sha256:2d91436a4c54a77365676265172ccd88242b05377666e40328f1390c3d747b4d
webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.9@sha256:2d91436a4c54a77365676265172ccd88242b05377666e40328f1390c3d747b4d
migrationImageDigest: ghcr.io/areasong/areaforge-migration:v0.1.9@sha256:cb9c3ecfe8cb2d1ccad7eb63c439ea872f6c53f81416a6cc17f4794a15ff06ab
sbomAsset: areaforge-sbom.spdx.json
sbomSha256: 4b823198c5a80a21aa72e7087c0d8bfe7da4652cd09467b78d8489f7a360477f
provenanceAsset: areaforge-provenance.json
provenanceSha256: aebaa96aa7d4ce8311a60e7559b03dc5f080c1aad1b9b666bd7aaa2c486ae208
supplyChainEvidence: SHA256SUMS covers manifest, SBOM, provenance and compose; sha256sum -c passed; cosign verify-blob returned Verified OK; unsigned placeholder absent
releaseSupplyChainEvidenceHash: sha256:403b7dfbe9228058d8d52cb4f9a60139955f25d36c693a31d8e5d7e69317afbb
composeHash: 52f22f07fd81ab5021b29a07ff7141034d34574509f88790e0181050b290461d
nginxConfigHash: 34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46
previousImage: ghcr.io/areasong/areaforge-web:v0.1.7
previousAppVersion: 0.1.7
serverUpdateRecordPath: /opt/areaforge/backups/github-release-updates/github-0.1.9-20260721050738/update-record.txt
databaseBackupPath: <redacted-root-only-path>
databaseBackupSha256: 19a4e1b19fba058c54f5dda8165f9732f8369c9aceb1756ee3f0ed0b98a90b6e
uploadsBackupPath: <redacted-root-only-path>
uploadsBackupSha256: 44a36c3c0f6a36512f97a8efacd63720456fae87379c907fe1285365af6b3b04
envBackupPath: <redacted-root-only-path>
envBackupSha256: b7b54caed99c48445fd1308fefd9d30ccd1b19a278b980ac94939974ee10e128
composeConfigBackupPath: <redacted-root-only-path>
nginxConfigBackupPath: <redacted-root-only-path>
migrationVersion: 20260718010000_add_active_session_unique_index
migrationApplied: yes
migrationRunner: one_off_migration_job
signatureVerification: SHA256SUMS passed and cosign verify-blob --key docs/deployment/keys/areaforge-cosign.pub --bundle SHA256SUMS.sig SHA256SUMS returned Verified OK
updateAgentStatus: validated redacted export; APP_VERSION=0.1.9; releaseTag=v0.1.9; smokeHealth=PASS; extraSmoke=PASS; rollbackAttempted=no; databaseRestoreAttempted=no; uploadsRestoreAttempted=no; failureReason=none; autoApply=none; signatureRequired=true; rollbackTargetVersion=0.1.7; updateRecordSha256=sha256:3b73a9a2b26182e1d9cfa24a588d6dd4d229c72b1d3f764070fdbe0ae93937e4
publicHealthEvidence: GET https://forge.areasong.top/api/health returned {"ok":true,"service":"AreaForge","version":"0.1.9"}
readinessSummaryEvidence: local pnpm ops:readiness:summary without production env returns needs_attention; production apply evidence comes from G5 updater apply and redacted export on la
rollbackTargetVersion: 0.1.7
rollbackTargetImage: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd
releaseEvidenceBundleHash: sha256:146bb35e0ae4f5b17bb0c0f9ce36ab2a221af6b0c22a64b2605391321cdb2708
operationalEvidenceBundleHash: sha256:bb73dfd74e9620fb161237201d9419152b325eaeee075726e4183dd81860c53b
alertPreviewStatus: warning
attachmentReconciliationCsvPath: ops-006-production-evidence-v0.1.9-20260721/attachment-reconciliation.csv
attachmentReconciliationCsvSha256: sha256:21e4fd44193daa6f950f25d2cde42498f74d17ee5816ae3cc56bc1ca96bb972d
attachmentReconciliationSummaryPath: ops-006-production-evidence-v0.1.9-20260721/attachment-reconciliation-summary.json
attachmentReconciliationSummaryHash: sha256:769f16956b4aa640a198a26dd8c916d5dd4e28986cfcc79d9754ad05f541e58a
attachmentReconciliationStatus: pass
preflight:
  pnpmCheck: PASS
  composeConfig: PASS
  prodComposeConfig: PASS
restoreDrill:
  databaseImported: no
  uploadsRestored: no
  attachmentHashMatched: yes
postReleaseSmoke:
  scope: server-side updater health plus read-only extra smoke, OPS-006 controlled synthetic concurrency probe, and controlled write-path smoke on the dedicated smoke account with [AF_SMOKE] synthetic titles (task/timer/review, attachment PNG upload/download, AI stage draft local_rule fallback)
  health: PASS
  login: PASS
  dashboard: PASS
  taskTimerReview: PASS
  syllabusNotesAnalyticsReports: PASS
  attachmentSmoke: PASS
  aiFallbackOrProvider: PASS
extraSmokeChecks: health,login,auth/me,dashboard,notes,syllabus,analytics,reports,long-term-risks,update-status,taskTimerReview,attachmentSmoke,aiFallbackOrProvider
rollbackDecision: no rollback needed for scoped updater apply; health, extra read-only smoke, write-path smoke, and OPS-006 controlled probe passed
rollbackPlan: If a future regression is confirmed, use the server-side updater rollback path to return the app image and APP_VERSION to 0.1.7 immutable digest; database/uploads restore requires separate high-risk confirmation and is not automatic; additive partial index and OPS-007 migration remain on rollback
rollbackDrillResult: not-applicable-no-rollback-attempted
rollbackDurationMinutes: 0
databaseRestoreRequired: no
uploadsRestoreRequired: no
rollbackFailureReason: none-no-rollback-attempted
residualRisk: v0.1.9 is applied in production on la and public health reports 0.1.9. Auto-apply remains none. Backup hashes copied from validated redacted export; root-only paths remain on host. Phase B residual closeout collected before/after doctors, hold/barrier/clear, OPS-007 reconciliation, OPS-005 EXPECTED_BEFORE_MISMATCH, and controlled write smoke. Remaining residuals outside this closeout set stay open until their own evidence closes.
residualRiskIds: AF-RISK-OPS-002,AF-RISK-OPS-003,AF-RISK-REL-001
followUpTasks: docs/development/residual-risk-ledger.md,tasks/indexes/residuals.md,workflow/versions/v0.1.9-long-term-operations-release.md
expectedFailureOrStopConditions:
  migrationFailed: stop future production updater apply and keep production on prior version
  smokeFailed: stop future production updater apply or rollback to recorded prior image
  logLeakDetected: stop release promotion and rotate affected secret if any value is exposed
  attachmentHashMismatch: stop future production updater apply and keep attachment reconciliation report_only
  backupMissing: stop future production updater apply before migration or switch
