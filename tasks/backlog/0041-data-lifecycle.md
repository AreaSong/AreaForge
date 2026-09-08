# 0041 v1.6 完整数据生命周期

```yaml
status: backlog
phase: planning
blockers:
  - 0044 ownership and authorization model must complete
  - EXPORT and DELETE confirmation packets required before implementation
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm db:validate
  - pnpm risk:preflight
  - pnpm check
residualRiskIds:
  - AF-RISK-DATA-001
releaseRequired: true
```

## 目标

实现数据清单、最小持久后台任务、Workspace/账户导出、数据任务中心、回收站、删除预览、冷静期、物理删除、附件对账和备份删除账本。

## 当前低风险基础边界（未改变 backlog 状态）

`packages/core` 仅提供可审计的纯规则：数据清单策略的规范化、导出值的递归脱敏、版本化 manifest 排序、每条记录 hash 和 manifest hash，以及后台 Job 的租约/进度/暂停/取消/重试状态转换。规则只处理调用方传入的内存值，不访问 Prisma、文件系统、上传目录、备份或下载凭证，也不执行删除、保留期、授权、持久幂等或持久后台 job；状态规则不等价于 DATA-1 worker。

基础规则会省略密码/密码 hash、session/access/refresh token、Provider/API secret、数据库连接串、`Attachment.uri`/`storedName` 以及绝对或内部路径；`stableKey`、`workspaceKey` 等业务引用不因名称含 `Key` 被误删。manifest 记录省略字段计数，记录 hash 和 manifest hash 均使用稳定排序与 `sha256:` canonical hash。纯 Core 候选还可在内存中构造确定性、无压缩 ZIP，使用真实 archive bytes 的 SHA-256 绑定 `manifest.json` 和排序后的 `entries/**.json`；写出只能经显式注入 sink，不读取 `UPLOAD_DIR`、数据库或网络。它仍不等价于完整账户导出、临时包保留/清理或可下载归档服务。

当前工作树已增加 v1.6 本地候选 Web 层：数据任务列表/创建、范围预览、幂等、取消/重试、下载 grant 撤销/兑换 descriptor，以及仅限平台 Operator 的 worker claim/heartbeat/complete/expire、行锁和 `updatedAt` CAS；导出不落盘，删除任务固定为 `PAUSED` preview-only，默认 flag 关闭。候选 schema/migration 仅在一次性隔离 PostgreSQL fixture 中验证过，未 apply 到共享测试库或生产，不提供物理删除或真实归档文件。隔离库结构回放入口为 `pnpm ops:ab:candidate-schema:selftest`，必须显式设置 `AREAFORGE_AB_CANDIDATE_ISOLATED_DB=1`。

账户级 preview 已把用户拥有和曾建立 Membership 的 Workspace 合并为上下文集合，因此成员自有记录不会失去 workspace/membership/subject 解释信息；Workspace 级 preview 的 DataJob 严格同时绑定 requester 与当前 workspace，不再串入同一用户其他 Workspace 的任务。该范围由 `pnpm ops:ab:v16-v18:runtime:selftest` 在隔离库验证，仍只证明 manifest descriptor 范围，不证明真实归档或附件本体导出。

DATA-0 模型台账已覆盖当前 89 个 Prisma model：83 个已接入 owner/actor-scoped preview，5 个安全状态永久排除，`RankingProjection` 作为可重建派生排除，`PLANNED_MINIMIZED` 已归零。关系表通过任务、笔记、资料、复习排期、知识点、学习 session 或当前用户参与记录反向约束；Auth session、邀请、AI Provider 凭据、学习树 grant 与受控运维请求只选择最小生命周期字段，不选择 token/IP/User-Agent hash、加密 API Key、nonce、幂等指纹、objectKey、worker 或 lease 能力材料。清单和实现由 `data-export-inventory-policy.test.ts` 双向校验，新增模型未分类、已包含模型缺 delegate、重新出现待接入模型或误选上述敏感字段时失败；隔离 PostgreSQL runtime 已验证成员 session/挑战/参与/申诉与 Operator 自有受控请求进入 preview，且真实归档仍为 `NOT_CREATED`。

## 独立确认包

持久后台任务的独立执行内核由 `0045` 首批承接，已提供新协议队列、租约代次、持久重试/死信、控制与子进程恢复。
本文件上方预览 API 仍使用旧协议，不因内核存在而生成归档、发放下载文件或执行删除。
DATA-EXPORT/DATA-DELETE 的业务处理器、存储、权限及恢复证据仍必须单独完成。

- DATA-EXPORT：导出范围、脱敏、临时包、一次性下载和撤销。
- DATA-DELETE：不可逆范围、冷静期、冻结、附件、失败补偿、备份恢复后删除账本重放。

### DATA-EXPORT 确认说明

当前仅允许在本地候选范围演进 redaction、manifest/hash、feature-gated preview 和 descriptor 契约，并补充单元测试；不得在未完成 DATA-EXPORT 确认前生成真实归档、写入共享/生产数据库、发放可下载文件或执行生产写入。正式确认必须补齐导出对象与附件范围、owner/授权判定、secret/internal path 排除清单、临时包保留与清理、下载撤销、审计、失败补偿和回滚证据。

### DATA-DELETE 确认说明

本基础任务只允许本地候选的删除影响预览和纯状态机：默认不可执行，只有显式隔离 fixture 可演练重新验证、冷静期、冻结、范围 fingerprint、kill-point、失败补偿和重试。纯 Core 回收站协议覆盖影响预览、revision/fingerprint、恢复期、恢复和到期转 `PURGE_ELIGIBLE`，但固定 `purgeExecutionAllowed=false`；deletion ledger 提供连续序号、不可变哈希链、篡改拒绝和历史备份恢复后的只读 replay plan，计划固定 `executionAllowed=false`。不执行数据库回收站写入、物理删除、附件清理、账本持久化或恢复后真实重放。任何涉及数据库/附件/备份的真实删除或保留策略，必须单独确认不可逆范围、重新验证、冻结与取消、kill-point/重试/恢复语义、失败补偿、备份复活防护、审计回执和回滚/恢复方案。

> 当前工作树中 `DataJob` / `DataExportPackage` / `DataExportDownloadGrant` schema 或 migration 仍属于候选变更；允许在一次性隔离数据库中做可回收的验证，但在 DATA-EXPORT 与 DATA-DELETE 确认前不得 apply 到共享/生产数据库、归档落盘、发放真实下载包、删除或生产 apply，也不能据此更新本任务为完成。

## 验收与关闭

- 对象、附件、manifest 和 hash 一致；敏感 secret/internal path 不导出。
- 后台 job 候选具备租约、worker owner、CAS、幂等、重试、取消、进度、结果和过期恢复；数据任务中心可完成申请、观察、下载/撤销、取消和重试。真实导出归档 worker 仍未实现。
- 删除预览与实际范围一致，kill-point/重试/恢复/备份复活防护通过。
- 完成证据只能让 `AF-RISK-DATA-001` 进入人工关闭复核，不自动关闭。

## 回滚

- 导出可撤销 grant 并清理临时包；删除开始前保存范围 hash 和受控备份，处理中断进入可恢复状态。
