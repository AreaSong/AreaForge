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

### fallback 输出转本地收口包

生产主机缺 Node.js/pnpm 时，服务器侧 fallback helper 只输出 redacted 输入目录，不直接生成收口包。把 `/tmp/areaforge-ops001-fallback-*` 目录复制回本地后，优先使用本地 finalizer：

```bash
AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=/path/to/areaforge-release-manifest.json \
pnpm ops:ops-001:fallback:finalize /path/to/areaforge-ops001-fallback-<timestamp> /tmp/areaforge-ops001-local-$(date -u +%Y%m%d%H%M%S)
```

该脚本只读取本地 redacted fallback 目录和 release manifest/digest 环境变量，生成并校验 `prod-readonly-smoke-record.txt`、`operational-evidence-bundle.json`、`ops-001-closure-packet.txt` 和 final preflight 输出。默认不联网；若需要在 evidence bundle 中补充当前 HTTPS health/TLS 只读信号，可显式设置 `AREAFORGE_OPS001_FINALIZE_INCLUDE_NETWORK=yes`。脚本不会执行 SSH、updater、backup、restore、migration、rollback、数据库写入、上传目录写入或 residual 台账修改。

需要透明展开或人工复核时，按以下顺序生成本地记录；示例中的 smoke password file 路径只用于让记录标注“来自密码文件”，不得复制或打印真实密码值。

```bash
DIR=/path/to/areaforge-ops001-fallback-<timestamp>
OUT=/tmp/areaforge-ops001-local-$(date -u +%Y%m%d%H%M%S)
mkdir -p "$OUT"

pnpm update-agent:status:validate "$DIR/redacted-update-status.json"

AREAFORGE_READINESS_ENVIRONMENT=production \
AREAFORGE_READINESS_EXPECTED_VERSION="$(jq -r '.expectedVersion' "$DIR/remote-prerequisites.json")" \
AREAFORGE_READINESS_RELEASE_TAG=v0.1.5 \
AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=/path/to/areaforge-release-manifest.json \
AREAFORGE_SMOKE_PASSWORD_FILE=/redacted/smoke-password-file \
AREAFORGE_PROD_READONLY_SMOKE_COMMAND=ops/update-agent/areaforge-ops001-readonly-fallback.sh \
AREAFORGE_UPDATER_ENV_SUMMARY="AREAFORGE_EXTRA_SMOKE_COMMAND configured, password file path redacted" \
AREAFORGE_UPDATE_RECORD_SUMMARY="redacted update-agent status hash sha256:$(sha256sum "$DIR/redacted-update-status.json" | awk '{print $1}')" \
pnpm smoke:prod-readonly:record "$DIR/prod-readonly-smoke-output.log" > "$OUT/prod-readonly-smoke-record.txt"

pnpm smoke:prod-readonly:validate "$OUT/prod-readonly-smoke-record.txt"

AREAFORGE_READINESS_ENVIRONMENT=production \
AREAFORGE_READINESS_SCOPE=daily \
AREAFORGE_READINESS_BASE_URL="$(jq -r '.baseUrl' "$DIR/remote-prerequisites.json")" \
AREAFORGE_READINESS_EXPECTED_VERSION="$(jq -r '.expectedVersion' "$DIR/remote-prerequisites.json")" \
AREAFORGE_READINESS_RELEASE_TAG=v0.1.5 \
AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=/path/to/areaforge-release-manifest.json \
AREAFORGE_READINESS_UPDATE_STATUS_FILE="$DIR/redacted-update-status.json" \
AREAFORGE_READINESS_SMOKE_RESULT_FILE="$DIR/prod-readonly-smoke-output.log" \
AREAFORGE_READINESS_EXPECTED_AUTO_APPLY=none \
AREAFORGE_SMOKE_PASSWORD_FILE=/redacted/smoke-password-file \
pnpm ops:evidence:bundle > "$OUT/operational-evidence-bundle.json"

pnpm ops:evidence:bundle:validate "$OUT/operational-evidence-bundle.json"
pnpm ops:ops-001:closure "$OUT/prod-readonly-smoke-record.txt" "$DIR/redacted-update-status.json" "$OUT/operational-evidence-bundle.json" > "$OUT/ops-001-closure-packet.txt"
pnpm ops:ops-001:closure:validate "$OUT/ops-001-closure-packet.txt"

AREAFORGE_OPS001_SMOKE_RECORD="$OUT/prod-readonly-smoke-record.txt" \
AREAFORGE_OPS001_UPDATE_STATUS_RECORD="$DIR/redacted-update-status.json" \
AREAFORGE_OPS001_EVIDENCE_BUNDLE="$OUT/operational-evidence-bundle.json" \
AREAFORGE_OPS001_CLOSURE_PACKET="$OUT/ops-001-closure-packet.txt" \
pnpm ops:ops-001:preflight
```

最后一步必须返回 `ready_for_human_close`，才表示 `AF-RISK-OPS-001` 证据进入人工复核关闭状态。fallback helper exit `10`、`remote-prerequisites.blockers` 非空、缺 `prod-readonly-smoke-output.log`、smoke `ok=false`、`remote-summary.txt` 不是 `redactedHandoffStatus: granted` 或 preflight 返回 `blocked_on_prerequisite` 时，只能形成阻塞证据，不能关闭 residual。

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
updateRecordSummary: update-record or redacted update-agent status hash sha256:<64 hex>
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
