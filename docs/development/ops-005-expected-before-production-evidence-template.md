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
localValidationCommands: pnpm update-center:request-v2:selftest,pnpm shellcheck:updater,pnpm github-release-updater:preflight,pnpm check
signedReleaseStatus: pass
productionDeploymentStatus: pass
timerPausedBeforeDeployment: yes
legacyMutationQueueDisposition: empty
webAgentVersionMatch: yes
v2CheckStatus: pass
v2CheckRequestHash: sha256:0000000000000000000000000000000000000000000000000000000000000000
expectedBeforeRejectionStatus: pass
expectedBeforeRejectionExecutionAttempted: no
expectedBeforeRejectionEvidenceHash: sha256:0000000000000000000000000000000000000000000000000000000000000000
sharedProductionStateLockStatus: pass
processingReconciliationStatus: pass
autoApply: none
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
pnpm ops:ops-005:evidence:validate <record>
```

validator 通过只允许 `ops:ops-005:preflight` 进入 `ready_for_ops005_human_review`，不自动关闭
`AF-RISK-OPS-005`，不证明 OPS-001、备份恢复、业务写入 smoke 或其他 residual 已关闭。

