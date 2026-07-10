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
- `resolved` 状态必须有 `postIncidentReview: yes`。
- 未完全解决的事故必须保留 `AF-RISK-*` residual ID 或转入任务/incident follow-up。
- 记录不得包含密码、session cookie、数据库 URL、API key、生产 `.env`、cosign 私钥、完整 prompt/raw response、附件内容、上传绝对路径或真实学习内容。
