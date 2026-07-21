releaseId: release-v0.1.9
releasedAt: 2026-07-21T05:08:11Z
operator: maintainer-confirmed production updater apply (G5 on la)
gitCommit: 749692ba719d801f14186a94af97b96350380141
sourceBaseline:
  sourceDocs: AGENTS.md, README.md, docs/development/release-train.md, docs/development/high-risk-confirmation-packets.md, docs/development/residual-risk-ledger.md, workflow/versions/v0.1.9-long-term-operations-release.md
  sourceHashOrCommit: 749692ba719d801f14186a94af97b96350380141
claimBoundary:
  doesNotProve: database restore, uploads restore, auto-apply policy change, Web runtime server commands, OPS-002 write smoke, OPS-006 residual closure, secret disclosure, full product UX verification, OPS-007/OPS-008 production migration or updater hold/drain execution
  evidenceStatus: production apply to 0.1.9 recorded with redacted backup hashes; read-only extra smoke and OPS-006 controlled probe passed; write-path task/timer, attachment upload, and AI provider production smoke intentionally not executed in this scope
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
releaseSupplyChainEvidenceHash: sha256:9eca6fcfdce942b894b5105ab290b2b332bb6eb17995c84bc75f5712e7f5b987
composeHash: 52f22f07fd81ab5021b29a07ff7141034d34574509f88790e0181050b290461d
nginxConfigHash: 34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46
previousImage: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd
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
migrationVersion: 20260718010000_add_active_session_unique_index and 20260721010000_attachment_staging_write_intent via v0.1.9 migration image
migrationApplied: yes
migrationRunner: one_off_migration_job
signatureVerification: SHA256SUMS passed and cosign verify-blob --key docs/deployment/keys/areaforge-cosign.pub --bundle SHA256SUMS.sig SHA256SUMS returned Verified OK
updateAgentStatus: validated redacted export; APP_VERSION=0.1.9; releaseTag=v0.1.9; smokeHealth=PASS; extraSmoke=PASS; rollbackAttempted=no; databaseRestoreAttempted=no; uploadsRestoreAttempted=no; failureReason=none; autoApply=none; signatureRequired=true; rollbackTargetVersion=0.1.7; updateRecordSha256=sha256:3b73a9a2b26182e1d9cfa24a588d6dd4d229c72b1d3f764070fdbe0ae93937e4
publicHealthEvidence: GET https://forge.areasong.top/api/health returned {"ok":true,"service":"AreaForge","version":"0.1.9"}
readinessSummaryEvidence: local pnpm ops:readiness:summary without production env returns needs_attention; production apply evidence comes from G5 updater apply and redacted export on la
rollbackTargetVersion: 0.1.7
rollbackTargetImage: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd
releaseEvidenceBundleHash: sha256:836bc6a1b2226d2b2e2635a37286bd138df3b5818dfc781a356ae27daba904e0
operationalEvidenceBundleHash: sha256:bb73dfd74e9620fb161237201d9419152b325eaeee075726e4183dd81860c53b
alertPreviewStatus: warning
attachmentReconciliationCsvPath: ops-006-production-evidence-v0.1.9-20260721/attachment-reconciliation.csv
attachmentReconciliationCsvSha256: sha256:21e4fd44193daa6f950f25d2cde42498f74d17ee5816ae3cc56bc1ca96bb972d
attachmentReconciliationSummaryPath: ops-006-production-evidence-v0.1.9-20260721/attachment-reconciliation-summary.json
attachmentReconciliationSummaryHash: sha256:bb42ecc447ce0729f50e74f9308eff8c62d2b71174eb8899640f0fdfb1f6a9ff
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
  scope: server-side updater health plus read-only extra smoke and OPS-006 controlled synthetic concurrency probe; write-path task/timer review smoke, attachment upload smoke, and AI provider production smoke were intentionally not executed in this scope (OPS-002 excluded)
  health: PASS
  login: PASS
  dashboard: PASS
  taskTimerReview: FAIL
  syllabusNotesAnalyticsReports: PASS
  attachmentSmoke: FAIL
  aiFallbackOrProvider: FAIL
extraSmokeChecks: health,login,auth/me,dashboard,notes,syllabus,analytics,reports,long-term-risks,update-status
rollbackDecision: no rollback needed for scoped updater apply; health and extra read-only smoke passed; OPS-006 controlled probe passed; write smoke and OPS-006 full evidence sequence remain residual
rollbackPlan: If a future regression is confirmed, use the server-side updater rollback path to return the app image and APP_VERSION to 0.1.7 immutable digest; database/uploads restore requires separate high-risk confirmation and is not automatic; additive partial index and OPS-007 migration remain on rollback
rollbackDrillResult: not-applicable-no-rollback-attempted
rollbackDurationMinutes: 0
databaseRestoreRequired: no
uploadsRestoreRequired: no
rollbackFailureReason: none-no-rollback-attempted
residualRisk: v0.1.9 is applied in production on la and public health reports 0.1.9. Auto-apply remains none. Backup hashes copied from validated redacted export; root-only paths remain on host. OPS-006 controlled probe passed but full production evidence validate is blocked by missing pre-deploy full data-integrity doctor and by release smoke binding requiring write-path PASS. OPS-001 redacted export references prod-readonly-smoke-output.log hash but the file is not present in output/release-v0.1.9/redacted-export/. OPS-004 local alert preview is warning without server receiver/timer. SC-004 raw ruleset JSON saved under output/sc004/ but not normalized to validator readback schema. OPS-007/OPS-008 local_verified only; production hold/drain not executed.
residualRiskIds: AF-RISK-OPS-001,AF-RISK-OPS-002,AF-RISK-OPS-004,AF-RISK-OPS-006,AF-RISK-OPS-007,AF-RISK-OPS-008,AF-RISK-REL-001,AF-RISK-SC-001,AF-RISK-SC-004,AF-RISK-UX-001
followUpTasks: docs/development/residual-risk-ledger.md,tasks/indexes/residuals.md,workflow/versions/v0.1.9-long-term-operations-release.md
expectedFailureOrStopConditions:
  migrationFailed: stop future production updater apply and keep production on prior version
  smokeFailed: stop future production updater apply or rollback to recorded prior image
  logLeakDetected: stop release promotion and rotate affected secret if any value is exposed
  attachmentHashMismatch: stop future production updater apply and keep attachment reconciliation report_only
  backupMissing: stop future production updater apply before migration or switch
