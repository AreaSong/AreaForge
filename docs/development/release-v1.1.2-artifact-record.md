schemaVersion: 2
scope: v1.1.2 GitHub Release 工件与供应链证据
summary: 稳定 v1.1.2 Release、workflow、不可变镜像 digest、checksum 与签名资产已严格验证；生产与回滚目标仍为 v1.1.1
evidenceClass: release
claimScope: release-artifact
evidenceUri: https://github.com/AreaSong/AreaForge/releases/tag/v1.1.2,https://github.com/AreaSong/AreaForge/actions/runs/31459420245,docs/development/release-supply-chain-v1.1.2.md,docs/development/v11-release-admission-record.md
sourceBaseline:
  sourceDocs: workflow/versions/v1.1-learning-action-center.md,tasks/active/0035-v11-batch11-minor-release.md,docs/development/v11-release-admission-record.md
  sourceHashOrCommit: 5df38417b701f3511d06db235c5b94755ca03aba
freshValidation:
  profile: custom
  commands: pnpm release:supply-chain:validate docs/development/release-supply-chain-v1.1.2.md <release-assets-dir> --strict; AREAFORGE_SC002_RELEASE_RECORD=docs/development/release-supply-chain-v1.1.2.md AREAFORGE_SC002_RELEASE_ASSETS_DIR=<release-assets-dir> pnpm sc:sc-002:preflight; pnpm docs:readiness; pnpm docs:completion; pnpm risk:preflight; pnpm completion:evidence:validate docs/development/release-v1.1.2-artifact-record.md; git diff --check
  browserOrRuntimeEvidence: GitHub Release v1.1.2 and Actions run 31459420245 completed/success; strict Release asset validation passed with evidence hash sha256:6f17abc390ad721ca93be88fa1717819b1783ed50ffefb455edcd4a86165b1ac
  checkedAt: 2026-08-11T13:00:00+08:00
validationFingerprint:
  algorithm: sha256
  gitHead: 5df38417b701f3511d06db235c5b94755ca03aba
  worktreeState: dirty
  worktreeHash: sha256:48c3a2f4da9a2701d5d9e7a1f0ef49cf3706324161ae2f8d7c40daa659226a01
  changedPaths: AGENTS.md,CHANGELOG.md,README.md,apps/web/AGENTS.md,apps/web/README.md,docs/README.md,docs/development/README.md,docs/development/operational-readiness.md,docs/development/release-supply-chain-v1.1.2.md,tasks/README.md,tasks/active/0035-v11-batch11-minor-release.md,workflow/README.md,workflow/versions/v1.1-learning-action-center.md
  digest: sha256:0efd6c1919dbe4ef810552f1ddcfda84d4302485e805e0453cac27170422d18a
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
