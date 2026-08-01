schemaVersion: 2
scope: v1.1.1 GitHub Release 工件与供应链证据
summary: 稳定 v1.1.1 Release、工作流、不可变镜像 digest、checksum 与签名资产已验证；生产仍为 v1.1.0
evidenceClass: release
claimScope: release-artifact
evidenceUri: https://github.com/AreaSong/AreaForge/releases/tag/v1.1.1,https://github.com/AreaSong/AreaForge/actions/runs/30643386103,docs/development/release-supply-chain-v1.1.1.md,docs/development/v11-release-admission-record.md
sourceBaseline:
  sourceDocs: workflow/versions/v1.1-learning-action-center.md,tasks/active/0035-v11-batch11-minor-release.md,docs/development/v11-release-admission-record.md
  sourceHashOrCommit: f995310e30c41270ee1e0a1c1ceeae9b6a8017eb
freshValidation:
  profile: custom
  commands: pnpm release:supply-chain:validate docs/development/release-supply-chain-v1.1.1.md <release-assets-dir> --strict,pnpm sc:sc-002:preflight,pnpm completion:evidence:validate docs/development/release-v1.1.1-artifact-record.md
  browserOrRuntimeEvidence: GitHub Release v1.1.1 and Actions run 30643386103 completed/success
  checkedAt: 2026-08-01T00:00:00+08:00
validationFingerprint:
  algorithm: sha256
  gitHead: f995310e30c41270ee1e0a1c1ceeae9b6a8017eb
  worktreeState: dirty
  worktreeHash: sha256:9f0284a23b3bf0a70eaf992bc63436e86ed411e2ee739922a488aa0dae1079f9
  changedPaths: AGENTS.md,CHANGELOG.md,README.md,apps/web/AGENTS.md,apps/web/README.md,docs/README.md,docs/deployment/github-release-updater.md,docs/development/README.md,docs/development/feature-map.md,docs/development/feature-traceability.md,docs/development/long-term-operability-control-plane.md,docs/development/operational-readiness.md,docs/development/production-release-runbook.md,docs/development/release-supply-chain-v1.1.1.md,docs/development/v11-phase-packages.md,docs/product/feature-scope.md,tasks/active/0035-v11-batch11-minor-release.md,workflow/README.md,workflow/versions/v1.1-learning-action-center.md
  digest: sha256:9c91876331441d44053d2006cf4971306cc7e5e76ece1b941af49e9892e11b69
unverified:
  skippedChecks: none
  reason: none
blockers:
  product: none
  securityPrivacy: none
  dependencySupplyChain: none
  ciRelease: none
  gitCheckpoint: none
residualRiskIds: AF-RISK-SC-001,AF-RISK-SC-002,AF-RISK-DATA-001
releaseRequired: no
highestRuntimeWriteBoundary: R4
highRiskConfirmation: yes
doesNotProve: production apply,production health,production backup,production migration,production smoke,rollback,residual closure
result: PASS
safetyFacts:
  productionTouched: no
  productionWriteAttempted: no
  serverCommandAttempted: no
  backupRestoreAttempted: no
  migrationAttempted: no
  updaterApplyAttempted: no
  releaseCreated: yes
  secretValuePrinted: no
