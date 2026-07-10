# AF-RISK-OPS-001 Closure Packet Template

## 用途

本模板用于把生产只读 smoke、redacted update-agent status 和 operational evidence bundle 组合成一份可校验的 `AF-RISK-OPS-001` 收口证据包。

它不执行生产命令，不运行 updater check/apply，不修改自动更新策略，不关闭 residual 台账；它只证明已有 redacted 证据形态满足“可提交给维护者复核关闭”的最低机器门禁。

## 生成和校验

```bash
pnpm smoke:prod-readonly:validate /path/to/prod-readonly-smoke-record.txt
pnpm update-agent:status:validate /path/to/redacted-update-status.json
pnpm ops:evidence:bundle:validate /path/to/operational-evidence-bundle.json
AREAFORGE_OPS001_SMOKE_RECORD=/path/to/prod-readonly-smoke-record.txt \
  AREAFORGE_OPS001_UPDATE_STATUS_RECORD=/path/to/redacted-update-status.json \
  AREAFORGE_OPS001_EVIDENCE_BUNDLE=/path/to/operational-evidence-bundle.json \
  pnpm ops:ops-001:preflight
pnpm ops:ops-001:closure /path/to/prod-readonly-smoke-record.txt /path/to/redacted-update-status.json /path/to/operational-evidence-bundle.json > /path/to/ops-001-closure-packet.txt
AREAFORGE_OPS001_SMOKE_RECORD=/path/to/prod-readonly-smoke-record.txt \
  AREAFORGE_OPS001_UPDATE_STATUS_RECORD=/path/to/redacted-update-status.json \
  AREAFORGE_OPS001_EVIDENCE_BUNDLE=/path/to/operational-evidence-bundle.json \
  AREAFORGE_OPS001_CLOSURE_PACKET=/path/to/ops-001-closure-packet.txt \
  pnpm ops:ops-001:preflight
pnpm ops:ops-001:closure:validate /path/to/ops-001-closure-packet.txt
```

`pnpm ops:ops-001:preflight` 只读取本地 redacted 证据路径，基础三份证据通过时返回 `ready_to_generate_packet`，收口包也通过时返回 `ready_for_human_close`。`pnpm ops:ops-001:closure` 会先调用三个子校验器；任一子证据失败时不会生成收口包。

## 文本模板

```text
packetId: ops-001-closure-<yyyymmddhhmmss>
generatedAt: <ISO-8601>
residualRiskId: AF-RISK-OPS-001
environment: production
baseUrl: https://forge.areasong.top
expectedVersion: 0.1.5
releaseTag: v0.1.5
smokeRecordHash: sha256:<64 hex>
smokeValidation: pass
smokeCheckedAt: <ISO-8601>
smokeStatus: pass
smokePasswordReadFromFile: yes
smokeUpdateStatusIncluded: yes
updateAgentStatusRecordHash: sha256:<64 hex>
updateAgentValidation: pass
updateAgentCurrentVersion: 0.1.5
updateAgentAutoApply: none
updateAgentSignatureRequired: true
updateAgentBlocker: null
updateAgentRollbackAvailable: true
operationalEvidenceBundleHash: sha256:<64 hex>
operationalEvidenceBundleValidation: pass
operationalEvidenceBundleStatus: ready|needs_attention
authenticatedSmokeSignalStatus: ready
updateAgentSignalStatus: ready
updaterEnvSummary: AREAFORGE_EXTRA_SMOKE_COMMAND configured, password file path redacted
updateRecordSummary: update-record hash sha256:<64 hex>
closeConditionEvidence: server extra smoke command configured, smoke password file used, production read-only smoke passed, update-agent status validated, evidence bundle indexed
residualLedgerAction: ready-for-human-close-after-review
followUpTasks: docs/development/residual-risk-ledger.md and tasks/indexes/residuals.md
safetyFacts:
  serverCommandAttempted: no
  backupRestoreAttempted: no
  migrationAttempted: no
  productionWriteAttempted: no
  secretValuePrinted: no
  updaterApplyAttempted: no
  residualLedgerUpdated: no
```

## 关闭边界

- `environment` 必须是 `production`。
- `smokeValidation`、`updateAgentValidation` 和 `operationalEvidenceBundleValidation` 必须为 `pass`。
- `authenticatedSmokeSignalStatus` 和 `updateAgentSignalStatus` 必须为 `ready`。
- `operationalEvidenceBundleStatus` 可以是 `needs_attention`，因为备份、告警或供应链残余可能仍未关闭；这不阻止 `AF-RISK-OPS-001` 的 smoke/update-agent 证据进入人工关闭复核。
- `residualLedgerUpdated: no` 是刻意设计：生成收口包不会自动改台账。维护者确认后，才可更新 `docs/development/residual-risk-ledger.md` 和 `docs/development/residual-risk-ledger.json`。
