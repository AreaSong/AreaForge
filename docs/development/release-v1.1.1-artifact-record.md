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
  gitHead: bb851765bad7a5830c7187858f9ccfc5d7cc19b6
  worktreeState: clean
  worktreeHash: sha256:5e5a71dc06df0be8f737d81120b0b79d452afa110fe658a5ef1052a2aba307b6
  changedPaths: none
  digest: sha256:7c1817e5a4677158f74cc66c53beb3b4e8971ff9f0ad86675de52eb80659a9f0
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
