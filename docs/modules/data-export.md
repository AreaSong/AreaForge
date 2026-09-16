# 本人数据导出

## 范围与入口

`/settings/data` 的数据任务中心提供范围预览、异步导出、状态观察、暂停/恢复、取消/重试、下载和授权撤销。
功能默认关闭；实现与环境验收状态见 [功能追踪矩阵](../development/feature-traceability.md) 和
[数据生命周期任务](../../tasks/backlog/0041-data-lifecycle.md)。本模块不提供物理删除、用户迁移、备份恢复或服务器命令。

| 范围 | 可复制的记录 | 不因该范围获得的权限 |
|---|---|---|
| `ACCOUNT` | 请求者本人记录，以及解释它们所需的最小 Workspace/关系上下文 | 历史 Membership、角色或分享 grant 不授予他人正文导出权 |
| `WORKSPACE` | 当前 ACTIVE Owner 在目标 Workspace 内的本人记录 | Owner 不能打包其他成员的私有记录；不含账户全局动机、全局通知偏好或无法归属本 Workspace 的审计 |

请求时冻结账户 `authRevision`、Workspace owner/status/revision、Membership id/status/role/revision。
worker 在读取快照、发布和下载前重新校验；暂停后恢复、移除后重入或所有权变化不能恢复旧任务的权限。
预览只返回对象身份、计数与 hash，不返回正文，也不创建归档。

## 数据清单与脱敏

预览和执行共用数据库层的数据清单。任务、计时、笔记、资料、复习、知识证据及本人协作记录均按 owner/actor 限定，
关系表反向绑定已拥有的对象。非本人 Workspace、科目、考纲和协作上下文只保留必要 ID/`metadataOnly`。
审计在 Workspace 范围同时校验实体类型与已导出 ID，不能仅按同名 ID 串入其他模型。

密码、认证 token、Provider secret/密文、网络标识 hash、内部 URI、storedName、objectKey、租约和原始 Provider trace 永久排除。
学习证据的 `sessionId` 仅在明确的学习实体中映射为 `studySessionId`；认证会话字段仍脱敏。
`StudyResource.attachmentId`、任务/计时的复习、复测和模拟考试引用属于业务关系，保留以便解释记录。
模型分类由 `data-export-inventory-policy.test.ts` 与 Prisma schema/实际查询 delegate 双向核验，新增模型不能静默漏分类。
`WorkspaceSearchPartition` 与 `WorkspaceSearchDocument` 属于可重建派生副本，均排除；查看权限不会把他人的共享标题变成导出者自有数据。搜索任务仅包含脱敏生命周期字段，不导出索引 payload 或内部指纹。

## 快照与文件协议

新任务使用 `queueVersion=1` 与 `data-export-job-v1`；旧预览协议不自动升级，旧包不能用于真实下载。
`DataExportArtifact` 在文件写入前登记 `(jobId, leaseVersion)` 与唯一随机 key，独占创建 staging 文件。
数据库正文在 Repeatable Read（可重复读）事务中逐条读取；附件只复制本范围内本人拥有且 `READY` 的文件。
附件使用 `O_NOFOLLOW` 同句柄读取并核对类型、长度、SHA-256 和读取前后 metadata；缺失、篡改、软链接或不一致直接失败，不静默省略。

归档采用流式 STORE ZIP：正文逐条写入 `entries/<kind>/<id>.json`，附件使用安全相对路径，manifest 和 central directory 暂存于私有 spool。
`manifest.json` 使用协议 `areaforge-data-export-archive` / `schemaVersion=2`，包含实际快照时间、scope、策略、排除项、记录/附件计数及逐条 hash。
它不是文件系统瞬时快照：数据库快照与经验证的文件句柄是两类证据，文件与数据库不一致时不发放包。

文件 fsync 后以同文件系统、不覆盖的 link 发布，并 fsync 目录；只有最新 locked job 的提交事务可创建 Package、绑定 artifact 并提交成功状态。
文件已就位但事务未提交时，仍是不可下载的 STAGING 副本。进程被杀后先回收租约，再以新代次重试；旧代次永远不能提交。
数据库的 Package manifest 只保留摘要，不复制完整学习正文。

技术保护固定为单 worker 串行消费、64 KiB 文件块、单 JSON 记录 8 MiB、单包 512 MiB / 100000 条目（含 manifest 与附件）。
条目数达到 ZIP16 边界时写 ZIP64 终结记录；资源超限失败。此处是导出资源保护，不是平台计费或业务配额。

## 下载与撤销

签发凭证要求本人任务和近期重新验证；凭证最长 15 分钟且不超过包/任务到期时间。
token 只保留在请求内存，通过受控 POST body 兑换，不进入 URL、DOM、剪贴板、浏览器持久存储或日志。
兑换需当前有效会话，先短时 reservation（预留）、同句柄校验完整文件，再在事务中重新授权并原子消费。
并发只有一次获准开始；打开、校验或开始前中止会释放预留，不能伪称已交付。

响应为 ZIP 二进制，带安全文件名、`Content-Disposition: attachment`、`private, no-store` 和 `nosniff`。
响应流按字节背压，首次读取前取消、传输中取消或 abort 均关闭文件句柄。
“已消费”只表示获准开始传输；断线或浏览器保存取消后，可重新验证并申请新凭证，不能复活原一次性凭证。
撤销阻止之后开始的下载，无法收回已经交付的客户端副本。

## 副本保留与恢复

任务最长 1 小时，包最迟随任务到期不可下载。独立 worker 默认每 60 秒检查一批已登记 artifact，
先切到 RECLAIMING 并撤销未消费 grant，再删除该 key 的精确 staging/spool/ZIP 路径。
失败记录有界错误码与尝试时间，批次按持久尝试时间轮转，坏文件不能长期阻挡其他副本回收。
已回收记录也有界轮转复查，以处理旧 writer 晚到的同 key 文件；不按目录前缀扫描或删除未登记文件。

关闭 `DATA_EXPORT_ENABLED` 或 `DATA_LIFECYCLE_ENABLED` 会阻止新请求、导出消费和下载。
维护者可在已确认环境使用 `pnpm worker:exports:reclaim`，同时显式设置 `DATA_JOB_WORKER_ENABLED=true`、数据库和两个私有目录；
该命令不注册处理器、不领取任务，关闭导出后仍可回收已登记副本，有失败则非零退出。
源附件、业务正文、未登记文件、历史上传 orphan、数据库和 volume 不在回收范围；保留任务、审计和 additive 字段，不 DROP。

`EXPORT_DIR` 必须是独立于 `UPLOAD_DIR` 的 canonical 私有目录，不在静态 public 下；导出副本不是备份，不改变既有备份/恢复策略。
恢复历史数据库不会使过期/撤销/缺失或不匹配的包重新可下载。

## 验证

核心规则、存储与 Web 单测之外，必须执行独立导出运行态：双用户/双 Workspace、历史 Membership、权限版本变化、
同名附件关系、独立解 ZIP/manifest/hash、故障附件、资源上限、四个进程强杀点、旧代次、控制操作、并发兑换/撤销/过期及回收轮转。
浏览器必须复用测试池返回的本批合成槽位，覆盖真实 API、网络响应丢失重试、进度、下载和桌面/窄视口恢复路径。
具体命令见 [验证矩阵](../development/validation-matrix.md)；合成验收不证明共享或生产 migration、Release、生产启用或删除域完成。
