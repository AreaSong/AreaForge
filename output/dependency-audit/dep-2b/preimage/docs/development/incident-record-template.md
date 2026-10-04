# Incident Record Template

本模板用于记录 AreaForge 事故或生产异常的 redacted evidence。它不执行服务器命令，不读取密钥，不修改生产数据，不执行 backup/restore、migration、updater apply 或 rollback，也不替代高风险确认。

记录完成后运行：

```bash
pnpm incident:record:validate docs/development/incident-<date-or-id>.md
```

如已有 redacted `pnpm ops:evidence:bundle` 或 `pnpm ops:alert:preview` 输出，可先生成草稿：

```bash
AREAFORGE_INCIDENT_OPERATOR=<operator> \
AREAFORGE_INCIDENT_ENVIRONMENT=production \
AREAFORGE_INCIDENT_SEVERITY=p2 \
AREAFORGE_INCIDENT_STATUS=mitigated \
AREAFORGE_INCIDENT_TYPE=update \
AREAFORGE_INCIDENT_SOURCE="ops evidence bundle and operator observation" \
AREAFORGE_INCIDENT_EVIDENCE_CLASS=production \
AREAFORGE_INCIDENT_USER_IMPACT="<redacted user impact>" \
AREAFORGE_INCIDENT_CONTAINMENT_ACTION="<containment>" \
AREAFORGE_INCIDENT_RECOVERY_ACTION="<recovery>" \
AREAFORGE_INCIDENT_ROLLBACK_DECISION=not-needed \
AREAFORGE_INCIDENT_HIGH_RISK_CONFIRMATION=not-applicable \
AREAFORGE_INCIDENT_RESIDUAL_RISK_IDS=AF-RISK-OPS-004 \
AREAFORGE_INCIDENT_POST_REVIEW=no \
pnpm incident:record /path/to/ops-evidence-bundle.json > /path/to/incident-record.txt
pnpm incident:record:validate /path/to/incident-record.txt
```

记录生成器只读取本地 redacted 证据文件和显式环境变量；它不连接生产、不执行命令、不写生产。

将通过校验的 redacted 事故记录放入 `docs/development/incident-<date-or-id>/incident-record.txt`，随后完整重建并校验：

```bash
pnpm incident:index > docs/development/incident-index.json
pnpm incident:index:validate docs/development/incident-index.json
```

`incident-index.json` 是本地只读投影，同时表达两组源记录：

- `active`：`open`、`mitigated`、`follow-up`，必须继续绑定 residual ID，不表示事故已关闭。
- `resolved`：仅 `resolved + postIncidentReview: yes`，表示历史记录满足索引准入条件，不表示 residual 已关闭。

顶层 `sourceSetSha256` 绑定全部源记录，两组各自的 `sourceSetSha256` 绑定组内源记录，每条记录的 `recordSha256` 绑定原始 `incident-record.txt`。校验器会从固定路径重新读取并确定性重建这些 hash。索引不是 active incident 状态机，不连接生产、不执行事故处置，也不能证明当前生产健康、恢复动作已执行或 residual 已关闭。

若事故处理中实际执行了 rollback，除事故记录外还应按 `docs/development/rollback-proof-record-template.md` 保存回滚后证明，并运行 `pnpm rollback:proof:validate <record>`。该 proof 只验证 post-rollback 证据达到人工复核门槛，不自动重新开放更新通道。

## 模板

```text
incidentId: <incident-id>
detectedAt: <ISO-8601 timestamp>
recordedAt: <ISO-8601 timestamp>
operator: <operator>
environment: production/staging/local/ci
severity: p0/p1/p2/p3
status: open/mitigated/resolved/follow-up
incidentType: health/update/backup/release/security/ai/upload/data/smoke/other
source: <redacted evidence source>
evidenceClass: production/runtime/release/local/docs-only
publicHealthStatus: pass/warn/fail/unknown/not-checked
userImpact: <redacted impact, no real study content>
containmentAction: <what was stopped, held, isolated, or watched>
recoveryAction: <what restored or mitigated service>
rollbackDecision: not-needed/rollback/roll-forward/hold/defer
readinessSummaryHash: <sha256-or-not-applicable>
evidenceBundleHash: <sha256-or-not-applicable>
alertPreviewHash: <sha256-or-not-applicable>
highRiskConfirmation: yes/no/not-applicable
residualRiskIds: <AF-RISK-* IDs or none>
followUpTasks: <task/docs/workflow links or none>
postIncidentReview: yes/no/not-applicable
safetyFacts:
  productionWriteAttempted: yes/no
  serverCommandAttempted: yes/no
  backupRestoreAttempted: yes/no
  migrationAttempted: yes/no
  updaterApplyAttempted: yes/no
  rollbackAttempted: yes/no
  secretValuePrinted: no
  realStudyContentIncluded: no
```

## 关闭条件

- 若任何高风险生产动作是 `yes`，`highRiskConfirmation` 必须是 `yes`，并在私有运维记录中保留确认包。
- `detectedAt` 和 `recordedAt` 必须包含 `Z` 或显式 UTC offset，避免跨时区重建时排序漂移。
- `residualRiskIds` 只能是 `none` 或完整 `AF-RISK-*` ID 的逗号列表；不得混入自由文本或无法识别的 ID。
- `followUpTasks` 只能是 `docs/`、`tasks/` 或 `workflow/` 下的仓库相对引用，确保历史索引保持 metadata-only。
- `resolved` 状态必须有 `postIncidentReview: yes`。
- `open`、`mitigated`、`follow-up` 会保留在索引的 `active` 组；投影、验证或 source hash 更新都不得自动关闭事故或 residual。
- 实际 rollback 后必须另有通过 `pnpm rollback:proof:validate` 的回滚证明，或明确保持事故为 `follow-up` 并记录缺失证据。
- 未完全解决的事故必须保留 `AF-RISK-*` residual ID 或转入任务/incident follow-up。
- 记录不得包含密码、session cookie、数据库 URL、API key、生产 `.env`、cosign 私钥、完整 prompt/raw response、附件内容、上传绝对路径或真实学习内容。
