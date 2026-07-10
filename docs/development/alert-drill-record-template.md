# Alert Drill Record Template

本模板用于记录 AreaForge 告警/恢复演练。它不发送通知，不调用外部告警接收人，不执行服务器命令，
不修改生产数据，也不单独关闭 `AF-RISK-OPS-004`。只有当记录同时具备接收人或人工值班窗口、预览输出、
检测/恢复结果和残余风险处理说明时，才能作为关闭证据的一部分。

记录完成后运行：

```bash
pnpm alert:drill:validate docs/development/alert-drill-vX.Y.Z-or-date.md
```

如果已有 `pnpm ops:alert:preview` 的 redacted 输出，可先生成演练记录草稿：

```bash
AREAFORGE_ALERT_DRILL_OPERATOR=<operator> \
AREAFORGE_ALERT_RECEIVER_TYPE=manual-window \
AREAFORGE_ALERT_RECEIVER_CONFIGURED=yes \
AREAFORGE_ALERT_RECEIVER_ACK=yes \
AREAFORGE_ALERT_DRILL_DETECTION_RESULT=PASS \
AREAFORGE_ALERT_DRILL_RECOVERY_RESULT=PASS \
AREAFORGE_ALERT_DRILL_RECOVERY_ACTION="<what was checked or restored>" \
pnpm alert:drill:record /path/to/ops-alert-preview.json > /path/to/alert-drill-record.txt
pnpm alert:drill:validate /path/to/alert-drill-record.txt
```

记录生成器只读取 alert preview 输出和上述显式演练字段；它不发送通知、不调用外部接收人、不执行服务器命令、不写生产。缺少接收人配置、确认 ACK、检测 PASS、恢复 PASS 或恢复动作说明时，生成器会失败，而不是生成可误用的关闭记录。

## 模板

```text
drillId: <alert-drill-id>
drilledAt: <ISO-8601 timestamp>
operator: <operator>
environment: production/staging/local/ci
scope: daily/release/update/migration/rollback
scenario: health_failure/smoke_missing/backup_stale/cert_expiring/update_agent_blocker/release_identity_missing/manual
alertPreviewCommand: pnpm ops:alert:preview
alertPreviewStatus: ok/watch/warning/critical
alertPreviewWouldNotify: yes/no
alertPreviewEvidenceHash: <64-hex>
alertReceiverType: external/manual-window
receiverConfigured: yes/no
receiverAck: yes/no/not-applicable
detectionResult: PASS/FAIL
recoveryResult: PASS/FAIL
recoveryAction: <what was checked or restored>
residualRiskIds: AF-RISK-OPS-004
followUpTasks: <task/docs/workflow links or none>
safetyFacts:
  notificationSent: yes/no
  externalAlertReceiverCalled: yes/no
  serverCommandAttempted: no
  productionWriteAttempted: no
  secretValuePrinted: no
```

## 关闭条件

- `alertReceiverType` 必须是 `external` 或 `manual-window`，且 `receiverConfigured: yes`。
- `receiverAck` 必须是 `yes`，除非演练明确是本地预演且不用于关闭 `AF-RISK-OPS-004`。
- `alertPreviewStatus`、`alertPreviewWouldNotify` 和 `alertPreviewEvidenceHash` 必须来自同一次 redacted `pnpm ops:alert:preview` 输出。
- `detectionResult` 和 `recoveryResult` 必须为 `PASS`。
- `residualRiskIds` 必须保留 `AF-RISK-OPS-004`，直到外部接收人或人工值班窗口和恢复演练都被证据证明。
- 记录不得包含密码、session cookie、数据库 URL、API key、生产 `.env`、完整 prompt/raw response、附件内容或真实学习内容。
