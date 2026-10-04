releaseId: release-v0.1.7
releasedAt: 2026-07-12T11:23:25Z
operator: Codex user-confirmed production updater apply
gitCommit: c1a25e4f897330fea493ad4c6dd889b62ef8f63a
sourceBaseline:
  sourceDocs: AGENTS.md, README.md, docs/development/release-train.md, docs/development/high-risk-confirmation-packets.md, docs/development/residual-risk-ledger.md
  sourceHashOrCommit: c1a25e4f897330fea493ad4c6dd889b62ef8f63a
claimBoundary:
  doesNotProve: database restore, uploads restore, auto-apply policy change, Web runtime server commands, production write smoke, residual risk closure, secret disclosure, full product UX verification
  evidenceStatus: production apply and public health recorded; release evidence validation remains blocked by root-only backup hashes and missing post-update OPS evidence
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
serverUpdateRecordPath: /opt/areaforge/backups/github-release-updates/github-0.1.7-20260712112325/update-record.txt
databaseBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo
databaseBackupSha256: not-copied-root-only-update-record
uploadsBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo
uploadsBackupSha256: not-copied-root-only-update-record
envBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo
envBackupSha256: not-copied-root-only-update-record
composeConfigBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo
nginxConfigBackupPath: recorded-in-server-update-record-root-only-not-copied-to-repo
migrationVersion: prisma migrate deploy via v0.1.7 migration image; no pending migrations
migrationApplied: yes
migrationRunner: one_off_migration_job
signatureVerification: SHA256SUMS passed and cosign verify-blob --key docs/deployment/keys/areaforge-cosign.pub --bundle SHA256SUMS.sig SHA256SUMS returned Verified OK
updateAgentStatus: server verification summary reported APP_VERSION=0.1.7, releaseTag=v0.1.7, smokeHealth=PASS, extraSmoke=PASS, rollbackAttempted=no, databaseRestoreAttempted=no, uploadsRestoreAttempted=no, failureReason=none; root-only status/update-record not copied into repo
publicHealthEvidence: GET https://forge.areasong.top/api/health returned {"ok":true,"service":"AreaForge","version":"0.1.7"}
readinessSummaryEvidence: AREAFORGE_READINESS_EXPECTED_VERSION=0.1.7 pnpm ops:readiness:summary returned health=pass, releaseIdentity=pass, infrastructure=pass, updateAgent=unknown, authenticatedSmoke=warn, overall=warn
operationalEvidenceBundlePath: docs/development/operational-evidence-bundle-v0.1.7-20260712.json
rollbackTargetVersion: 0.1.5
rollbackTargetImage: ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9
releaseEvidenceBundleHash: pending-redacted-root-only-backup-hash-copy
operationalEvidenceBundleHash: sha256:58dc87bcfe7505a2ef3837aa85c24681ed8d4b52c2cf7881d5e89a39904b69c9
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
  scope: server-side updater health plus read-only extra smoke; write-path task/timer, attachment upload, and AI provider production smoke were intentionally not executed in this scope, so their FAIL values prevent full production-health claims
  health: PASS
  login: PASS
  dashboard: PASS
  taskTimerReview: FAIL
  syllabusNotesAnalyticsReports: PASS
  attachmentSmoke: FAIL
  aiFallbackOrProvider: FAIL
extraSmokeChecks: health, login, auth/me, dashboard, notes, syllabus, analytics, reports, long-term-risks, update-status
rollbackDecision: no rollback needed for scoped updater apply; health and extra read-only smoke passed, while full production write smoke and backup-hash evidence remain residual
rollbackPlan: If a future regression is confirmed, use the server-side updater rollback path to return the app image and APP_VERSION to 0.1.5; database/uploads restore requires separate high-risk confirmation and is not automatic.
rollbackDrillResult: not-applicable-no-rollback-attempted
rollbackDurationMinutes: 0
databaseRestoreRequired: no
uploadsRestoreRequired: no
rollbackFailureReason: none-no-rollback-attempted
residualRisk: v0.1.7 is applied in production and public health passes. Auto-apply remains none. Backup hashes and full update-record fields are retained on the production host and were not copied into the repo because the current closure scope excludes secret/backups copying; post-update OPS-001 redacted status/smoke/evidence bundle still needs fresh collection before any long-term-operability or OPS-001 residual-ledger closure claim. Current-version OPS-004 drill is saved at docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt and preflight reaches ready_for_human_close, but OPS-004 remains open until maintainer review. A local v0.1.7 desktop/mobile product experience review exists at docs/development/product-experience-review-v0.1.7-20260712-local.md, but it does not prove production write smoke or real user data experience.
residualRiskIds: AF-RISK-OPS-001,AF-RISK-OPS-002,AF-RISK-REL-001,AF-RISK-SC-001,AF-RISK-OPS-004,AF-RISK-UX-001
followUpTasks: docs/development/residual-risk-ledger.md,tasks/indexes/residuals.md
expectedFailureOrStopConditions:
  migrationFailed: stop future production updater apply and keep production on prior version
  smokeFailed: stop future production updater apply or rollback to recorded prior image
  logLeakDetected: stop release promotion and rotate affected secret if any value is exposed
  attachmentHashMismatch: stop future production updater apply and keep attachment reconciliation report_only
  backupMissing: stop future production updater apply before migration or switch
