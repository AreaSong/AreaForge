# OPS-005 Expected-Before V2 生产证据记录模板

```text
recordId: ops-005-expected-before-v2-YYYYMMDDTHHMMSSZ
recordedAt: 2026-07-13T00:00:00.000Z
environment: production
releaseTag: v0.1.8
packageVersion: 0.1.8
gitCommit: 0000000000000000000000000000000000000000
webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.8@sha256:0000000000000000000000000000000000000000000000000000000000000000
updateAgentScriptSha256: sha256:0000000000000000000000000000000000000000000000000000000000000000
updaterScriptSha256: sha256:0000000000000000000000000000000000000000000000000000000000000000
localImplementationStatus: pass
localValidationCommands: pnpm ops:ops-005:local:selftest,pnpm ops:ops-005:preflight:selftest,pnpm ops:ops-005:evidence:selftest,pnpm shellcheck:updater,pnpm github-release-updater:preflight,pnpm check
signedReleaseStatus: pass
productionDeploymentStatus: pass
timerPausedBeforeDeployment: yes
legacyMutationQueueDisposition: empty
webAgentVersionMatch: yes
v2CheckStatus: pass
v2CheckRequestHash: sha256:0000000000000000000000000000000000000000000000000000000000000000
expectedBeforeRejectionStatus: pass
expectedBeforeRejectionExecutionAttempted: no
expectedBeforeRejectionRequestHash: sha256:0000000000000000000000000000000000000000000000000000000000000000
expectedBeforeRejectionEvidenceFile: expected-before-rejection.json
expectedBeforeRejectionEvidenceHash: sha256:0000000000000000000000000000000000000000000000000000000000000000
operationalEvidenceFile: operational-evidence.json
operationalEvidenceHash: sha256:0000000000000000000000000000000000000000000000000000000000000000
sharedProductionStateLockStatus: pass
processingReconciliationStatus: pass
autoApply: none
redactedDecisionHistoryFile: decision-history.json
redactedDecisionHistoryHash: sha256:0000000000000000000000000000000000000000000000000000000000000000
evidenceFreshnessMaxAgeHours: 24
residualRiskIds: AF-RISK-OPS-005
doesNotProve: AF-RISK-OPS-005 residual closure,production business write safety beyond scoped V2 check,OPS-001 closure,secrets absence beyond validator scan
safetyFacts:
  secretValuePrinted: no
  productionBusinessDataWritten: no
  residualLedgerUpdated: no
  webRuntimeServerCommandAttempted: no
  productionMutationRequestExecuted: no
  autoApplyPolicyChanged: no
  databaseRestoreAttempted: no
  uploadsRestoreAttempted: no
```

该记录只保存 redacted identity、hash、阶段结果和安全事实，不保存 request 原文、生产 env、smoke
credential、token、私钥、备份本体、数据库 URL、附件内容或原始日志。

它必须通过：

```bash
pnpm ops:ops-005:evidence:validate <record> <release-record> <release-assets-dir>
```

validator 会先对 Release assets、checksum 和 cosign 签名执行 strict 校验，再把生产 `webImageDigest`
绑定到签名 Release 记录，并通过 `git show <releaseCommit>:<path>`
把生产 agent/updater 脚本 hash 绑定到该 Release commit 的 Git 对象；脏工作树不参与期望 hash。
rejection、decision history 与 operational evidence 必须是记录文件同目录内的 redacted JSON 普通文件；validator 会拒绝绝对路径、
`..`、symlink 和目录逃逸，重新计算文件 hash、扫描敏感内容，并确认同一 Release identity 下存在
`EXPECTED_BEFORE_MISMATCH`、`REJECTED`、`executionAttempted=false` 的同 requestHash 决策、成功的零执行 V2 check，
以及 deployment、shared lock 和 processing reconciliation 的结构化交叉绑定。
`localValidationCommands` 必须包含完整的 `pnpm ops:ops-005:local:selftest` 聚合门禁，不能只用单个
Web request selftest 代替 agent、reconciliation 和真实共享锁竞争验证。
通过后只允许 `ops:ops-005:preflight` 进入
`ready_for_ops005_human_review`，不自动关闭
`AF-RISK-OPS-005`，不证明 OPS-001、备份恢复、业务写入 smoke 或其他 residual 已关闭。
