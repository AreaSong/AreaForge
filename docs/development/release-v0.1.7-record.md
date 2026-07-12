releaseId: release-v0.1.7
releasedAt: 2026-07-12T04:39:00Z
operator: Codex user-confirmed release evidence closure
gitCommit: c1a25e4f897330fea493ad4c6dd889b62ef8f63a
sourceBaseline:
  sourceDocs: AGENTS.md, README.md, docs/development/release-train.md, docs/development/high-risk-confirmation-packets.md, docs/development/residual-risk-ledger.md
  sourceHashOrCommit: c1a25e4f897330fea493ad4c6dd889b62ef8f63a
claimBoundary:
  doesNotProve: production updater apply, backup/restore execution, migration execution, rollback execution, residual risk closure
releaseTag: v0.1.7
releaseUrl: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.7
AREAFORGE_IMAGE: ghcr.io/areasong/areaforge-web:v0.1.7
imageDigest: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd
webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd
migrationImageDigest: ghcr.io/areasong/areaforge-migration:v0.1.7@sha256:c2c27da7ed85be0796d4f6535557d3759bc14975a0238b725b99c1c0e232e654
sbomAsset: areaforge-sbom.spdx.json
sbomSha256: 4dd56f6c72db5e32528df4d2d443fe8e2510df9fe7be20a3d8c8c4d3cff24303
provenanceAsset: areaforge-provenance.json
provenanceSha256: 69f93bd9e4b7f6b8b9390ae2f0e3fa80650796ce3ac2451858e2ca8bd57c692f
supplyChainEvidence: SHA256SUMS covers manifest, SBOM, provenance and compose; sha256sum -c passed; cosign verify-blob returned Verified OK; unsigned placeholder absent
releaseSupplyChainEvidenceHash: sha256:8ec0059da73c76821447f837232d4c4d8c975f732c2e561742e5549cd528efc6
composeHash: a9dfcf2011b0b7826f8d4c288b5dfd46d4a7c2087ac680f0cc8913fd628df1cc
nginxConfigHash: 34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46
previousImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9
previousAppVersion: 0.1.5
databaseBackupPath: not-applicable-release-assets-only-no-production-apply
databaseBackupSha256: 613ac16a8f367fca0ae989b3afa60c53b7c4bd4fc8e2ad90e52f7988dd92be62
uploadsBackupPath: not-applicable-release-assets-only-no-production-apply
uploadsBackupSha256: 613ac16a8f367fca0ae989b3afa60c53b7c4bd4fc8e2ad90e52f7988dd92be62
envBackupPath: not-applicable-release-assets-only-no-production-apply
envBackupSha256: eb2f9eb53b24476268b38ce1b13e60c0087f63704da68c228c071690bb01d5db
composeConfigBackupPath: not-applicable-release-assets-only-no-production-apply
nginxConfigBackupPath: not-applicable-release-assets-only-no-production-apply
migrationVersion: not-applicable-release-assets-only-no-production-apply
migrationApplied: no
migrationRunner: not-applicable
signatureVerification: SHA256SUMS passed and cosign verify-blob --key docs/deployment/keys/areaforge-cosign.pub --bundle SHA256SUMS.sig SHA256SUMS returned Verified OK
updateAgentStatus: not-collected-for-v0.1.7; no updater apply requested; production remains 0.1.5 from v0.1.5 signed release
rollbackTargetVersion: 0.1.5
rollbackTargetImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9
releaseEvidenceBundleHash: sha256:9fee892a3d5ae838d439f14f46b9bec7307ff3fe1fadc37cbf33eb9374ca4aa4
operationalEvidenceBundleHash: sha256:fa1f5872ce1d0f705a0887f517dab8f727c4e05f09da9922c22e0d4690aab9fe
alertPreviewStatus: warning
preflight:
  pnpmCheck: PASS
  composeConfig: PASS
  prodComposeConfig: PASS
restoreDrill:
  databaseImported: no
  uploadsRestored: no
  attachmentHashMatched: not-applicable
postReleaseSmoke:
  health: FAIL
  login: FAIL
  dashboard: FAIL
  taskTimerReview: FAIL
  syllabusNotesAnalyticsReports: FAIL
  attachmentSmoke: FAIL
  aiFallbackOrProvider: FAIL
rollbackDecision: not-applicable
rollbackPlan: No production update was applied. If a future v0.1.7 updater apply is confirmed and fails, rollback to the recorded v0.1.5 image through the server-side updater runbook.
rollbackDrillResult: not-applicable-no-production-apply
rollbackDurationMinutes: 0
databaseRestoreRequired: no
uploadsRestoreRequired: no
rollbackFailureReason: none-no-rollback-attempted
residualRisk: GitHub Release assets and signed supply-chain evidence are ready for human review; production update, production backup, production migration, production smoke, rollback and residual ledger closure were not executed in this scope.
residualRiskIds: AF-RISK-SC-001,AF-RISK-SC-002,AF-RISK-OPS-001,AF-RISK-OPS-004,AF-RISK-REL-001
followUpTasks: docs/development/residual-risk-ledger.md,tasks/indexes/residuals.md
expectedFailureOrStopConditions:
  migrationFailed: stop future production updater apply and keep production on prior version
  smokeFailed: stop future production updater apply or rollback to recorded prior image
  logLeakDetected: stop release promotion and rotate affected secret if any value is exposed
  attachmentHashMismatch: stop future production updater apply and keep attachment reconciliation report_only
  backupMissing: stop future production updater apply before migration or switch
