# OPS-007 附件 Staging 与写入意图设计

当前状态：`in-progress / local-verified`（维护者已于 2026-07-21 按确认句原文确认，G1）。

本文档同时是实施后的协议源事实：本地实施已完成并通过隔离 PostgreSQL/临时上传目录 runtime selftest；
生产 migration/deploy、backup/restore 策略变更和历史文件处理仍未获授权。

## Preflight 契约（V2）

- source contract：`OPS-007-PREFLIGHT-CONTRACT-V2`。
- 本地实施证据等级：`evidenceClass: local_attachment_protocol_verified`；确认前的候选等级
  `protocol_preimage_candidate` 保留为历史语义。
- preflight 分别计算 task、design、high-risk packet、current schema、canonical additive migration 和
  checked-in fixture 的 SHA-256，并以 `sourceBindingHash` 绑定完整输入集合；任一源事实漂移都必须使检查失效或
  绑定 hash 变化。current schema 必须包含 OPS-007 实施标记（`AttachmentStatus`、`stagingName`、
  reconciliation lease 字段、`storedName/uri` 唯一约束）。
- 提供 `AREAFORGE_OPS007_RUNTIME_RECORD`（由 `pnpm ops:ops-007:runtime:selftest` 在隔离 PostgreSQL +
  临时上传目录生成、经 `pnpm ops:ops-007:runtime:validate` 语义校验、实现 hash 绑定当前 checkout 且未过期）
  时，preflight 达到 `local_verified`；否则停留在 `local_validation`，此时 strict 必须非零退出。
- fixture 必须先通过既有 crash-window validator，preflight 不读取上传目录、不连接开发/生产数据库、不读取 secrets。
- 该证据只证明当前 checkout 的本地协议实现；不证明签名 Release、生产 migration、生产 filesystem、
  backup/restore 或 residual 已关闭。

确认与证据生命周期固定为：`awaiting_high_risk_confirmation -> implementation_authorized -> local_validation ->
local_verified -> release_ready -> production_confirmation_required`。当前状态为 `local_verified`；
`candidate/pass/complete` 不能代替用户确认，本地 pass 也不能代替生产确认。确认过期、撤销、scope/source hash
漂移或扩大到生产、历史清理、真实 backup/restore 时必须 fail closed。

## 目标不变量

1. 数据库先保存可追踪的 `PENDING` 写入意图，再产生 staging/final 文件。
2. 只有文件 hash/size 与 intent 一致、atomic rename 和目录 fsync 完成后，metadata 才能 CAS 为 `READY`。
3. 下载只读取 `READY`，并通过 `O_NOFOLLOW` 文件句柄完成检查和读取，避免 lstat/readFile TOCTOU。
4. `storedName` 和 `uri` 在数据库唯一；冲突必须发生在任何文件写入前。
5. 补偿失败必须保留 `PENDING/FAILED` 记录和稳定 failure code，不能吞掉错误后丢失追踪入口。
6. 旧附件通过 migration 默认标记为 `READY`，不解析、不移动、不重命名、不回填父级归属。
7. reconciliation 只处理新协议记录；历史 file-only/db-only 项继续 report-only，不自动删除或修复。

## 当前风险

- 当前服务直接写最终文件，之后才创建 metadata；进程崩溃会留下永久 file-only orphan。
- metadata 失败后的 `rm` 是 best-effort，删除失败没有持久化状态或重试入口。
- `Attachment` 没有状态、`storedName/uri` 唯一约束或更新时间。
- 下载先检查路径再普通 `readFile`，与文件安全文档声明的 `O_NOFOLLOW` 不一致。
- DB dump 与 uploads 归档不是同一原子快照，未定义 staging/PENDING 的恢复语义。

## Additive migration

候选模型：

- `enum AttachmentStatus { PENDING READY FAILED }`
- `Attachment.status AttachmentStatus @default(PENDING)`
- `Attachment.protocolVersion Int @default(1)`
- `Attachment.stagingName String? @unique`
- `Attachment.finalizedAt DateTime?`
- `Attachment.failureCode String?`
- `Attachment.failurePhase String?`
- `Attachment.reconciliationClaimId String?`
- `Attachment.reconciliationClaimedAt DateTime?`
- `Attachment.reconciliationLeaseExpiresAt DateTime?`
- `Attachment.reconciliationAttempt Int @default(0)`
- `Attachment.updatedAt DateTime @updatedAt`
- `Attachment.storedName @unique`
- `Attachment.uri @unique`

约束：

- 最终 Prisma schema 的协议默认必须是 `PENDING`。migration 可先以 `NOT NULL DEFAULT READY` 添加 status，
  使既有 row 在不执行数据 UPDATE 的情况下获得兼容值，再立即把列默认改为 `PENDING`；`protocolVersion`
  同理先给既有 row `0`，再把新记录默认改为 `1`。
- 所有新上传仍必须显式写 `status=PENDING, protocolVersion=1`，不能把 schema default 当作协议步骤。
- legacy `READY/protocolVersion=0` 只表示历史兼容，不证明文件 durable、hash/size 正确或可下载；下载仍需
  same-handle 校验，缺失或 mismatch 必须拒绝并进入 report-only `needs_attention`，不得自动改 row。
- migration 前 doctor 必须确认 `storedName` 和 `uri` 无重复；发现重复时中止，不自动修复。
- migration 不包含删除、孤儿清理、noteId 回填或历史 hash 重算。
- Prisma schema、migration、临时库 apply/verify、签名 Release 和生产 deploy 是不同证据。

## 有界上传读取

当前 `request.formData()` 与 `file.arrayBuffer()` 会在业务 size 校验前完整缓冲，不构成长期安全边界。确认后的
实现必须同时约束：

1. HTTP request body 上限：单文件业务上限加固定 multipart overhead；Nginx 与应用入口保持一致。
2. multipart/parser 上限：只接受一个 `file` part，未知或误导性 `Content-Length` 不能绕过实际字节计数。
3. 单文件业务上限：按实际读取字节数在 `limit + 1` 时立即中止。

文件内容使用固定不超过 64 KiB 的 buffer 流式读取，增量完成 size、SHA-256 与 magic bytes 检查；不得在
`arrayBuffer()` 后再声称已限制内存。截断 multipart、chunked body、错误 Content-Length 和 parser abort 必须
返回稳定错误且不创建 intent/文件。该原则参考 AreaMatrix 的 bounded-buffer 增量 hash，不复制其 runtime。

## 上传协议

1. 校验登录、note 存在、Content-Type、UPLOAD_DIR 与 storage identity，并通过有界流式 parser 校验实际
   MIME、size、magic bytes 和增量 hash。
2. 在事务内创建 `PENDING` Attachment 和审计摘要；此时没有文件。
3. 在私有 `.staging/` 使用 exclusive create 写入 staging 文件。
4. 对文件句柄执行 `fsync`，关闭后对 staging 目录执行 `fsync`。
5. 用同一 filesystem 内 atomic rename 移到 final path，再 `fsync` final 目录。
6. 重新打开 final 文件并校验 hash/size。
7. 使用 `id + status=PENDING + protocolVersion=1 + updatedAt + reconciliationClaimId` CAS 更新为 `READY`，
   写 `finalizedAt` 并清空 staging、failure 和 reconciliation lease 字段。
8. CAS 失败不覆盖其他状态，记录 reconciliation required；不得删除可能已被其他事务确认的 final 文件。

所有文件 IO 位于数据库事务外，数据库事务不得跨文件写、fsync 或 rename 长时间持有。

## 失败与 Reconciliation

- intent 创建失败：不写文件。
- staging 写失败：将本次 intent 标记 `FAILED`；仅删除本次新建 staging 文件，删除失败写稳定 failure code。
- rename 后 READY CAS 失败：保留 `PENDING`，不得静默删除 final 文件。
- 第一版 reconciliation 只能由显式本地维护命令触发，不在 Web 启动或公开 API 中自动运行。
- claim 使用 `id + status + updatedAt + lease 为空/已过期` CAS，写入随机 `claimId`、claimedAt、
  leaseExpiresAt 和递增 attempt。批次按 `createdAt,id` 稳定排序并设硬上限；文件 IO 后的任何状态更新都必须
  再带同一 claimId。过期 claim 可由新的明确维护运行 CAS reclaim，不能被旧 worker 提交。

新协议 reconciliation 决策表：

| DB 状态 | staging | final | 校验结果 | 允许结论 | 自动删除 |
| --- | --- | --- | --- | --- | --- |
| PENDING | 无 | 无 | 不适用 | 超过年龄阈值后 `FAILED/MISSING_FILE_AFTER_INTENT` | 否 |
| PENDING | 单一 | 无 | hash/size 匹配 | `eligible_finalize`：持 claim 执行 rename/fsync/verify/READY CAS | 仅失败写入产生的本次 staging；删除失败保留 failure code |
| PENDING | 无 | 单一 | hash/size 匹配 | `eligible_ready`：持 claim verify 后 READY CAS | 否 |
| PENDING | 单一 | 单一 | 任意 | `blocked/AMBIGUOUS_DUAL_FILE`，人工复核 | 否 |
| PENDING | 任意 | 任意 | mismatch 或多个候选 | `FAILED/INTEGRITY_MISMATCH` 或 blocked，保留证据 | 否 |
| FAILED | 任意 | 任意 | 任意 | 默认 report-only；只有明确列为 recoverable 的 failure phase 才可重新 claim | 否 |
| READY | 无 | 单一 | hash/size 匹配 | pass | 否 |
| READY | 任意 | 缺失/mismatch | 任意 | `needs_attention`，下载拒绝，不改历史 row | 否 |
| 无 DB row | 任意 | 任意 | 任意 | historical/file-only report | 否 |

reconciliation 必须记录 redacted 审计摘要和每类计数；不得输出文件名、绝对路径、hash 明细或内容。

## 下载与授权

- route 继续要求登录，service 接收 actor context；当前单管理员模型只能访问 `READY` 且 noteId 非空的附件。
- 任何多用户/多租户扩展前必须先新增 owner/tenant predicate；不能复用当前“只登录”作为多用户授权。
- 使用 `open` + `O_NOFOLLOW` 获取文件句柄，基于同一句柄 `fstat`、读取和 hash/size 校验。
- 浏览器 DTO 只返回 id、noteId、originalName、mimeType、sizeBytes、createdAt 和下载 URL；不返回 hash、uri、
  storedName、stagingName、protocolVersion、failure/lease 字段或绝对路径。下载响应也不暴露原始 SHA-256。

## 备份与恢复

- uploads 归档包含 final 与 `.staging`，不能在备份期间清理 staging；reconciliation summary 必须把
  `.staging` 识别为保留目录，而不是 unsafe/unexpected entry。
- 备份记录分别绑定数据库 dump、uploads archive 和 reconciliation summary hash。
- restore 后先运行 report-only reconciliation；PENDING/FAILED 不提供下载。
- backup/restore 不自动把 PENDING 标记 READY，也不删除 file-only 项。
- 生产备份窗口若要求一致快照，需要独立 hold/drain 或上传停写确认；本包不执行生产备份。

恢复状态固定为 `backup_snapshot -> restored -> integrity_checked -> reconciliation_required ->
ready|needs_attention|blocked`。数据库 dump、uploads archive、metadata inventory hash、文件 hash/size 证据任一
缺失或不匹配时不得进入 `ready`。restore 不继承旧 reconciliation lease，不自动把 PENDING 改成 READY，也
不删除 file-only/staging 项；旧 lease 只作为失效证据进入新的明确 reconciliation。

## 确认前 Fixture

`scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json` 严格覆盖：

- intent 先于文件；
- staging 写后崩溃；
- final 文件先于 READY；
- 补偿成功与失败；
- 重启 reconciliation；
- 旧 READY 兼容；
- 重复 storage identity；
- 备份截面包含 PENDING/staged。

它同时区分 `expectedFileStateAfterCompensation`（协议期望的运行时结果）与 `fileDeleted=false`
（fixture 未执行任何删除副作用）；因此 `compensation-success` 不代表本地已经删除文件。
fixture 不执行数据库、文件、备份或修复。

## 确认后验证

- additive migration 静态校验、临时 PostgreSQL apply/verify 和重复 apply。
- bounded upload fixture 覆盖 exact-limit、limit+1、chunked、误导 Content-Length、截断 multipart、最大
  buffer 和 parser abort，断言超限前无 intent/文件。
- 临时上传目录行为测试：每个 kill point、补偿失败、重启 reconciliation、唯一冲突和 O_NOFOLLOW。
- 下载 READY 成功，PENDING/FAILED/legacy mismatch 返回稳定拒绝，DTO 不泄露 hash 或内部字段。
- reconciliation fixture 覆盖 dual-file、多个 staging 候选、stale lease、旧 worker 提交、重复运行和
  `.staging` summary 分类。
- backup/restore fixture 保留 staging/PENDING 并要求 restore 后 reconciliation。
- `pnpm attachment:reconciliation:summary:selftest`、`pnpm risk:preflight`、`pnpm db:validate`、`pnpm check`。

## 回滚与不证明

- 开发失败时回滚代码并销毁临时库/目录。
- 已部署 additive 字段和唯一约束优先保留；DROP、历史状态重写和文件移动另行确认。
- 本地 fixture 不证明生产上传安全、历史 orphan 清理、生产备份恢复或 residual 关闭。

## 明确确认句

> 确认执行 OPS-007 附件 staging/write-intent 本地实施：范围仅限新增 AttachmentStatus PENDING/READY/FAILED、protocolVersion、staging/finalized/failure、reconciliation lease 字段和 stagingName/storedName/uri 唯一约束的 additive migration，note 附件上传改为有界流式读取、显式 PENDING intent、exclusive staging write/fsync、atomic rename/fsync、READY CAS，下载仅允许 READY 并使用 O_NOFOLLOW 同句柄校验，补偿失败保留可审计状态，新协议记录的有界 claim/lease reconciliation，以及本地临时 PostgreSQL/上传目录 crash fixture；不删除或自动修复历史 orphan，不删除 READY 附件，不执行生产 migration/deploy、backup/restore、上传目录迁移、服务器命令、secrets 操作、多用户迁移、Release/tag 或 residual 台账关闭。
