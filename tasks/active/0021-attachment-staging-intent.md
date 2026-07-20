# 附件 Staging 与写入意图

```yaml
status: in-progress
phase: local-verified
blockers: []
risk: high
ownerSkill: areaforge-file-storage-safety
validation:
  - pnpm attachment:crash-window:selftest
  - pnpm attachment:crash-window:validate scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json
  - pnpm attachment:reconciliation:summary:selftest
  - AREAFORGE_OPS007_ISOLATED_DB=1 DATABASE_URL=<isolated ops007 postgres> pnpm ops:ops-007:runtime:selftest --output output/ops007/attachment-runtime-<date>.json
  - pnpm ops:ops-007:runtime:validate output/ops007/attachment-runtime-<date>.json
  - AREAFORGE_OPS007_RUNTIME_RECORD=output/ops007/attachment-runtime-<date>.json pnpm ops:ops-007:preflight:strict
  - pnpm risk:preflight
  - pnpm db:validate
residualRiskIds:
  - AF-RISK-OPS-007
releaseRequired: true
evidenceClass: local_attachment_protocol_verified
preflightContract: OPS-007-PREFLIGHT-CONTRACT-V2
```

维护者已按确认包原文给出明确确认（2026-07-21，G1），本地实施完成并达到 `local-verified`；
生产阶段固定为 `production_confirmation_required`，不得从本地 pass 直接执行生产 migration/deploy。

当前 preflight source contract：

- `OPS-007-PREFLIGHT-CONTRACT-V2`
- `evidenceClass: local_attachment_protocol_verified`
- `pnpm ops:ops-007:preflight` 绑定 task/design/high-risk packet/schema/canonical migration/crash fixture 的 SHA-256；
  提供 `AREAFORGE_OPS007_RUNTIME_RECORD`（fresh 隔离 runtime record）时 strict 可达 `local_verified`。
- 该证据只证明当前 checkout 的本地实现与隔离 PostgreSQL/临时上传目录验证，不证明签名 Release、生产 migration、
  backup/restore 或 residual 关闭。

已完成范围（确认句边界内）：

- additive migration `20260721010000_attachment_staging_write_intent`：`AttachmentStatus PENDING/READY/FAILED`、
  `protocolVersion`、staging/finalized/failure/reconciliation lease 字段、`stagingName/storedName/uri` 唯一约束；
  legacy row 经初始默认获得 `READY/protocolVersion=0`，未执行任何数据 UPDATE。
- 上传改为有界流式读取（`packages/storage/src/bounded-multipart.ts`）+ 显式 PENDING intent + exclusive staging
  write/fsync + atomic rename/目录 fsync + 重开校验 + READY CAS（`apps/web/lib/study/attachments-service.ts`）。
- 下载仅允许 READY 且 `O_NOFOLLOW` 同句柄 fstat/hash/size 校验；浏览器 DTO 不再返回 hash。
- 新协议记录的有界 claim/lease reconciliation 由显式维护命令 `pnpm attachment:reconcile:new-protocol` 触发；
  历史 orphan 保持 report-only，reconciliation summary 把 `.staging` 识别为保留目录。
- 隔离 PostgreSQL + 临时上传目录 runtime selftest 覆盖 kill point、补偿失败、重启 reconciliation、唯一冲突、
  O_NOFOLLOW；record 见 `output/ops007/`。

后续（另行确认）：匹配签名 Release、独立生产 migration/deploy 确认（含重复 storage identity doctor 预检）、
生产 fresh 证据与 residual 人工复核。

详细状态机、唯一约束、O_NOFOLLOW、reconciliation 和备份/恢复边界见 `docs/development/ops-007-attachment-crash-window-design.md`。

## 确认句

> 确认执行 OPS-007 附件 staging/write-intent 本地实施：范围仅限新增 AttachmentStatus PENDING/READY/FAILED、protocolVersion、staging/finalized/failure、reconciliation lease 字段和 stagingName/storedName/uri 唯一约束的 additive migration，note 附件上传改为有界流式读取、显式 PENDING intent、exclusive staging write/fsync、atomic rename/fsync、READY CAS，下载仅允许 READY 并使用 O_NOFOLLOW 同句柄校验，补偿失败保留可审计状态，新协议记录的有界 claim/lease reconciliation，以及本地临时 PostgreSQL/上传目录 crash fixture；不删除或自动修复历史 orphan，不删除 READY 附件，不执行生产 migration/deploy、backup/restore、上传目录迁移、服务器命令、secrets 操作、多用户迁移、Release/tag 或 residual 台账关闭。
