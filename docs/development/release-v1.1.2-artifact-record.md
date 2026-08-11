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
  commands: pnpm release:supply-chain:validate docs/development/release-supply-chain-v1.1.2.md <release-assets-dir> --strict; pnpm docs:readiness; pnpm docs:completion; pnpm risk:preflight; pnpm completion:evidence:validate docs/development/release-v1.1.2-artifact-record.md; git diff --check
  browserOrRuntimeEvidence: GitHub Release v1.1.2 and Actions run 31459420245 completed/success; strict Release asset validation passed with evidence hash sha256:6f17abc390ad721ca93be88fa1717819b1783ed50ffefb455edcd4a86165b1ac
  checkedAt: 2026-08-11T13:00:00+08:00
validationFingerprint:
  algorithm: sha256
  gitHead: ec4ea1bd3f03463319bfca54b9f10e25638b8c4d
  worktreeState: clean
  worktreeHash: sha256:5e5a71dc06df0be8f737d81120b0b79d452afa110fe658a5ef1052a2aba307b6
  changedPaths: none
  digest: sha256:16513ce2bd507ab9f597a06b73307bee9fb396407fc1b4824a9a929dfceb8095
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
