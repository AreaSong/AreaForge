# 附件 Staging 与写入意图

```yaml
status: blocked
phase: awaiting-high-risk-confirmation
blockers:
  - explicit OPS-007 protocol and additive migration confirmation
risk: high
ownerSkill: areaforge-file-storage-safety
validation:
  - pnpm attachment:crash-window:selftest
  - pnpm attachment:crash-window:validate scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json
  - pnpm attachment:reconciliation:summary:selftest
  - pnpm risk:preflight
residualRiskIds:
  - AF-RISK-OPS-007
releaseRequired: true
```

确认前 preflight source contract：

- `OPS-007-PREFLIGHT-CONTRACT-V1`
- `evidenceClass: protocol_preimage_candidate`
- `pnpm ops:ops-007:preflight` 只投影并哈希绑定 task/design/high-risk packet/current schema/fixture。
- `pnpm ops:ops-007:preflight:strict` 在 `awaiting-high-risk-confirmation` 时必须非零退出。
- 该证据不证明 migration、runtime、filesystem、backup/restore 或 production 行为。

目标：用 staging file、fsync、PENDING -> READY 写入意图和条件补偿缩小“文件已落盘但 metadata 未提交”的
崩溃窗口。实施前需另行确认 additive migration、旧附件兼容、备份/恢复和回滚边界；不自动清理孤儿文件。

确认前设计已经固定：最终 schema default 为 PENDING，legacy row 使用 migration 初始默认 READY/protocolVersion=0；
上传必须有界流式读取，reconciliation 必须使用 claim/lease 和完整 DB/staging/final 决策表，浏览器 DTO 不暴露
原始 hash。任何实现仍需下方更新后的明确确认句。

详细状态机、唯一约束、O_NOFOLLOW、reconciliation 和备份/恢复边界见 `docs/development/ops-007-attachment-crash-window-design.md`。

## 确认句

> 确认执行 OPS-007 附件 staging/write-intent 本地实施：范围仅限新增 AttachmentStatus PENDING/READY/FAILED、protocolVersion、staging/finalized/failure、reconciliation lease 字段和 stagingName/storedName/uri 唯一约束的 additive migration，note 附件上传改为有界流式读取、显式 PENDING intent、exclusive staging write/fsync、atomic rename/fsync、READY CAS，下载仅允许 READY 并使用 O_NOFOLLOW 同句柄校验，补偿失败保留可审计状态，新协议记录的有界 claim/lease reconciliation，以及本地临时 PostgreSQL/上传目录 crash fixture；不删除或自动修复历史 orphan，不删除 READY 附件，不执行生产 migration/deploy、backup/restore、上传目录迁移、服务器命令、secrets 操作、多用户迁移、Release/tag 或 residual 台账关闭。
