releaseId: release-v1.2.0
releasedAt: 2026-09-01T15:01:59Z
operator: Codex user-confirmed v1.2.0 second-stage Release workflow execution
gitCommit: 018cdfaa7a58cea2b32a33acaa0b968f29b9e09a
sourceBaseline:
  sourceDocs: AGENTS.md,README.md,CHANGELOG.md,workflow/versions/v1.2-high-density-workbench.md,docs/development/release-supply-chain-v1.2.0.md
  sourceHashOrCommit: 018cdfaa7a58cea2b32a33acaa0b968f29b9e09a
claimBoundary:
  doesNotProve: production updater apply,backup/restore execution,production migration,production health,production smoke,rollback execution,automatic apply policy change,residual risk closure
  evidenceStatus: signed stable GitHub Release and immutable image assets verified; production-evidence-pending; production remains v1.1.1 and no production write was attempted
releaseTag: v1.2.0
releaseUrl: https://github.com/AreaSong/AreaForge/releases/tag/v1.2.0
AREAFORGE_IMAGE: ghcr.io/areasong/areaforge-web:v1.2.0
imageDigest: ghcr.io/areasong/areaforge-web:v1.2.0@sha256:db01d7275e6a22870dddf8c51b56e7b65eb23db479963cdd189eebda22c648bd
webImageDigest: ghcr.io/areasong/areaforge-web:v1.2.0@sha256:db01d7275e6a22870dddf8c51b56e7b65eb23db479963cdd189eebda22c648bd
migrationImageDigest: ghcr.io/areasong/areaforge-migration:v1.2.0@sha256:3e8d4530fe2cf6375a11fc2a22058528c1d7c44774d8a6c6558f1fd9c27da58d
sbomAsset: areaforge-sbom.spdx.json
sbomSha256: 15a9fb0ab1d0bfe2490917e32a0d6e635d686bab99fda199e8f416b5466cbbee
provenanceAsset: areaforge-provenance.json
provenanceSha256: 533da73675765f73237c001036cfd61078c7ef237ba0ddec2debfa26d526339e
supplyChainEvidence: SHA256SUMS covers manifest, SBOM, provenance and compose; sha256sum -c passed; cosign verify-blob returned Verified OK; unsigned placeholder absent
releaseSupplyChainEvidenceHash: sha256:92c67cb7e144df7c8bcd5b9bc8b0640a29e9e72442b1cb3d74ba15e4bb07ded8
composeHash: a9dfcf2011b0b7826f8d4c288b5dfd46d4a7c2087ac680f0cc8913fd628df1cc
nginxConfigHash: 4096963253b7ca0e9b5a5d6712d24034ebb2332d1fb955de84bc8d9d596e108d
previousImage: ghcr.io/areasong/areaforge-web:v1.1.1@sha256:46f32025693d3d7a16585984d77c9c6c4b6a2603456bad92c223dd1147a9daeb
previousAppVersion: 1.1.1
databaseBackupPath: not-applicable-release-only-no-production-apply
databaseBackupSha256: d349423433c64aacb2216919f511915056b40bfbdcb1f302fad24b0157fa52c8
uploadsBackupPath: not-applicable-release-only-no-production-apply
uploadsBackupSha256: d349423433c64aacb2216919f511915056b40bfbdcb1f302fad24b0157fa52c8
envBackupPath: not-applicable-release-only-no-production-apply
envBackupSha256: d349423433c64aacb2216919f511915056b40bfbdcb1f302fad24b0157fa52c8
composeConfigBackupPath: not-applicable-release-only-no-production-apply
nginxConfigBackupPath: not-applicable-release-only-no-production-apply
migrationVersion: additive migration present in v1.2.0 release; production migration intentionally not executed
migrationApplied: no
migrationRunner: not-applicable
signatureVerification: SHA256SUMS passed and cosign verify-blob --key docs/deployment/keys/areaforge-cosign.pub --bundle SHA256SUMS.sig SHA256SUMS returned Verified OK
updateAgentStatus: not-applicable-production-apply-not-requested; production remains v1.1.1; AREAFORGE_AUTO_APPLY=none unchanged
rollbackTargetVersion: 1.1.1
rollbackTargetImage: ghcr.io/areasong/areaforge-web:v1.1.1@sha256:46f32025693d3d7a16585984d77c9c6c4b6a2603456bad92c223dd1147a9daeb
releaseEvidenceBundleHash: sha256:0b739446efbadcb7e54fd71cc57f522f2bbd43f38c4abfd4c3064f9873f12869
preflight:
  pnpmCheck: PASS
  composeConfig: PASS
  prodComposeConfig: PASS
restoreDrill:
  databaseImported: no
  uploadsRestored: no
  attachmentHashMatched: not-applicable
postReleaseSmoke:
  scope: Release-only asset and supply-chain validation; production health, authenticated smoke, write smoke, migration and updater apply were not executed
  health: FAIL
  login: FAIL
  dashboard: FAIL
  taskTimerReview: FAIL
  syllabusNotesAnalyticsReports: FAIL
  attachmentSmoke: FAIL
  aiFallbackOrProvider: FAIL
rollbackDecision: not-applicable-no-production-apply
rollbackPlan: Keep production on v1.1.1; any future production update requires a new explicit confirmation, current backup evidence, migration gate, smoke gate and rollback target
rollbackDrillResult: not-applicable-no-rollback-attempted
rollbackDurationMinutes: 0
databaseRestoreRequired: no
uploadsRestoreRequired: no
rollbackFailureReason: none-no-production-action-attempted
residualRisk: v1.2.0 stable Release assets are published and strictly verified. Production remains v1.1.1; no production migration, update-agent apply, backup/restore, rollback, write smoke or automatic apply policy change was executed. Backup/config hash fields use deterministic not-applicable marker hashes and are not production backup evidence. Supply-chain evidence awaits maintainer review before any residual ledger decision.
residualRiskIds: AF-RISK-SC-001,AF-RISK-SC-002,AF-RISK-REL-001,AF-RISK-DATA-001
followUpTasks: docs/development/residual-risk-ledger.md,tasks/indexes/residuals.md
attachmentReconciliationCsvPath: release-v1.2.0-attachment-reconciliation.csv
attachmentReconciliationCsvSha256: sha256:7c4e4e87f3d9de6b550788eae003f9766ef9cc7f9402b701ba8862b028ba2f54
attachmentReconciliationSummaryPath: release-v1.2.0-attachment-reconciliation-summary.json
attachmentReconciliationSummaryHash: sha256:931900cb3aaaa9594834f2fa4e0284b4ecb5b556a0be67038d075ffc90cfef82
attachmentReconciliationStatus: pass
expectedFailureOrStopConditions:
  migrationFailed: stop production promotion and keep production on v1.1.1
  smokeFailed: stop production promotion and keep production on v1.1.1
  logLeakDetected: stop release promotion and rotate affected secret if any value is exposed
  attachmentHashMismatch: stop any future production update and keep attachment reconciliation report_only
  backupMissing: stop any future production update before migration or switch
