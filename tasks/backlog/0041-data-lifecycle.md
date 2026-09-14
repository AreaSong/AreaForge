# 0041 v1.6 完整数据生命周期

```yaml
status: backlog
phase: planning
blockers:
  - 0044 ownership and authorization model must complete
  - Signed release and independent shared/production delivery evidence remain required
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

历史 v1.6 基础提供旧协议数据任务、脱敏预览与下载 descriptor；该阶段不生成文件。独立确认后的 EXPORT 已改用 `queueVersion=1`，由专属 worker 生成本人数据/READY 附件私有 ZIP 并提供一次性 POST 下载；用户控制支持暂停/恢复/取消/重试。旧手工 worker 仍拒绝新协议，旧包不可下载，DELETE 固定为 `PAUSED` preview-only。所有开关默认关闭，共享/生产 migration 未执行；完整行为以 `docs/modules/data-export.md` 为准。

账户级导出保留解释本人记录所需的 Workspace/关系上下文，非本人 Workspace、科目、考纲仅最小 ID/metadata；历史 Membership 不授予他人正文。Workspace 级只导出 ACTIVE Owner 的本人记录，不包含全局动机/通知偏好及无法归属目标 Workspace 的审计。预览与 worker 共用清单，权限版本在请求、执行、发布和下载阶段重新校验。

DATA-0 模型台账覆盖 96 个 Prisma model：83 个接入 owner/actor-scoped 清单，12 个内部安全/执行状态排除，`RankingProjection` 可重建派生排除，`PLANNED_MINIMIZED` 为零。新增六个删除协议模型不作为普通导出数据；关系表按已拥有对象反向约束，认证/邀请/Provider 只保留最小生命周期字段。清单与 schema/查询 delegate 双向静态核验，实际内容另由独立 ZIP/hash 回归验证。

## 独立确认包

持久后台任务的独立执行内核由 `0045` 首批承接，已提供新协议队列、租约代次、持久重试/死信、控制与子进程恢复。
EXPORT 在独立确认下接入新协议；预览和 DELETE 仍不能借用该授权执行物理删除。
DATA-EXPORT 与 DATA-DELETE 的业务处理器、存储、权限及恢复证据分别验收，不能互相替代。

- DATA-EXPORT：导出范围、脱敏、临时包、一次性下载和撤销。
- DATA-DELETE：不可逆范围、冷静期、冻结、附件、失败补偿、备份恢复后删除账本重放。

### DATA-EXPORT 确认说明

精确范围已集中在 `docs/development/high-risk-confirmation-packets.md` 的「DATA-EXPORT 完整本地闭环确认包（本地已确认）」：维护者于 2026-09-13 明确批准本人 Account/Workspace 数据与 READY 附件、独立导出 worker、私有临时包、一次性真实下载和导出副本回收，仅使用本批合成库与合成文件；不含源数据删除或生产。本地实现已具备，独立验收结果见下节；本任务因 DELETE 与整体交付证据未齐继续保留 backlog/planning。

按已确认包，仅在本批合成环境实现和验证真实归档与下载；对象/附件范围、owner/授权、secret/internal path 排除、保留与回收、撤销、审计、失败补偿和回滚仍是验收条件。共享/生产数据库、真实用户附件与生产写入不在本地授权内；代码或纯 Core 测试不能代替文件/下载的实际证据。

### DATA-DELETE 确认说明

确认前的基础仅提供删除影响预览和纯状态机，旧协议仍固定不可执行。独立 DATA-DELETE 包现已批准本地实现和限定合成验证，当前代码与证据见下节；不复用 EXPORT 授权，也不因此开放共享库、真实用户或生产。

> 共享/生产 migration、真实用户数据删除、production apply 与 residual 关闭仍未授权；本地 DELETE 批准不能使整个任务或 v2.0 门禁完成。

### DATA-DELETE 本地验收（2026-09-14；整体交付仍 partial）

- 维护者在核对 `5f5b5a6`、51 条 migration 与 schema preimage 后，于 2026-09-13 明确回复“同意，允许”。开工时保留原工作区 56 个暂存文件，在独立 worktree 实施；2026-09-14 维护者已将原有修改提交推送为 `3c30b76`。恢复执行时临时工作树和合成目录已丢失，从本任务的 58 份成功补丁记录恢复到持久主工作区；恢复时 schema 与产品指纹均匹配中断前源码，新 HEAD 与治理修改保留。后续只修正本批缺口，不重放历史命令。
- 已形成独立意图/精确对象清单/回收站/冻结、本人范围验证、24 小时冷静期与 30 天恢复期、带租约代次/重试的删除进程、文件意图/unlink/fsync、源记录与最小账本原子提交，以及验证可信 head 后向新恢复目标重放的本地候选。默认开关关闭，Web 不执行删除器。
- 最终合成资源为新建 loopback `areaforge_v20_delete_bb178f5e63dc` 与本批私有目录；53 条 migration deploy/repeat deploy 成功，完整名称、实际顺序、SQL checksum、完成状态和步骤数匹配。schema SHA-256 为 `ab77429b40205a644f13cdf03864f9b73aa45b03003cd4161763bccf33a5a7e0`。旧 `cc637a6d38da` 仅为中断前实验，未启动或清理；未使用 EXPORT/共享库或真实 uploads。
- 最终 17 组运行态通过：单连接池/嵌套可见性、五个真实 SIGKILL 点、账户/工作区根删除、期限与取消、权限重新确认、五类对象回收/恢复/物理清除、并发恢复 CAS 与 claim 单赢家、真实成员移除/所有权转移/账户暂停、未解散挑战/跨 owner 引用/文件身份唯一性、持久退避/死信/人工重试、备份竞争与可信账本重放、文件/记录/账本闭环。失败前不误报删除成功，旧会话和旧租约不能提交。
- 独立核验发现并真实复现两处缺口后修复：恢复重放改用 dump 内账本序号/head 水位，拒绝用预提交时间筛选；知识画布原生 SQL 在节点、边、计数、分页与搜索之前排除冻结对象，并在查询前后重验可见性代次。实际隔离回归证明恢复不复活、画布 focus/search 不再泄漏回收站标题。
- 测试池只释放归属已核实的本批失效槽 3，然后用新 fixture 重建；槽 1/2 的容器身份保留，数据库、卷和历史资源未删除。最新槽 3 / `http://127.0.0.1:43173` 的产品指纹为 `sha256:6ae12cc9091f0f1ac8fe3bab7e1863cb9ad630c9c29b62b308817cd94c4e593b`，build ID 为 `sha256:6a32adaadc3f3c4728a482d0cd2161994da4acba697ff6328a088ca06bb161e8`。中途旧实例和截图不作为最终证据。
- 最终真实 API 与 1440×1000、390×844、320×844 浏览器矩阵通过：真实登录/Secure Cookie、重新验证、scope 切换清空、确认词、丢响应同任务/同凭据幂等、普通页面/附件/画布隐藏与恢复、跨用户拒绝、刷新失败保留、冷静期取消、账户物理删除后会话失效与只读回执、真实键盘导航/Enter 刷新。没有横向溢出或页面异常，按钮触控高度至少 44px；范围和控制区分别截图，见 `output/playwright/data-delete/evidence.json` 与同目录 PNG。
- 风险预检对业务回收站 restore 采用精确路由/服务判定和拒绝服务器执行的负测，不放开 Web 运维命令。常规总检查、Core/DB/Storage/Web、删除专项、测试池、冻结安装、文档/任务/风险/治理/secret 门禁按最终改动范围复验；Git/CI 对应本批检查点，不以旧 `5f5b5a6` 的 CI 证明新增源码。
- 本节仅完成 DATA-DELETE 本地范围。签名 Release、共享/生产 migration/apply、生产备份恢复、其他独立域和 v2.0 综合门禁仍未完成；`AF-RISK-DATA-001` 未关闭。

### EXPORT 本地验收（2026-09-13）

- 第 51 条 additive migration 新增 artifact 意图、Package 代次关联及短期下载预留；只在本批 `areaforge_v20_export_*` loopback 合成库 deploy/repeat deploy，完整 ledger/SQL checksum 匹配。旧 worker 库、共享测试库与生产不变。
- 独立导出 runtime 为 14 组，覆盖本人/Workspace/历史成员、关系保留、幂等、权限 epoch、所有权转移、开关/回执、故障文件/资源限制、控制/过期、四个真实 SIGKILL 点、标准 CLI、下载失败与并发撤销/预留代次、失败回收公平性；同一 51-migration 库的 15 组内核和 11 组通知回归通过。
- 文件校验、首次读取前取消/中途取消/abort 句柄释放、Web 字节背压与 65536 条 ZIP64 边界纳入 Storage 单测；文件已就位但尚未发布的副本必须保持不可下载。
- 浏览器验收复用测试池专用槽 2 / `127.0.0.1:43172`，绑定本批合成库、只读 uploads/exports 和合成密钥；1440×1000、390×844、320×844 的真实 API、响应丢失幂等、暂停/恢复、25%/100% 进度、ZIP/hash、跨用户/并发/撤销/过期、文件与刷新失败、旧包禁用、触控/键盘检查通过，登录及今日/专注/通知只读页面回归通过。产品源指纹为 `sha256:4e0f823794a2220680912f900ca3a153fc9c082cd552a757391dd014793a49c8`，截图保留在本地 `output/playwright/data-export/`；不借用旧槽证据。
- 回退：关闭新导出/消费/下载，撤销未使用 grant，显式 `worker:exports:reclaim` 仅回收登记副本；保留源数据、任务与审计，不 DROP、不复活旧协议。没有 Release、共享/生产 apply、备份恢复或 residual 关闭。

## 验收与关闭

- 对象、附件、manifest 和 hash 一致；敏感 secret/internal path 不导出。
- 后台 job 具备租约、worker owner、CAS、幂等、重试、取消、进度、结果和过期恢复；数据任务中心和真实导出 worker 必须完成当前源指纹的申请、观察、下载/撤销、控制及失败恢复验收，不能由历史 descriptor 测试代替。
- 删除预览与实际范围一致，kill-point/重试/恢复/备份复活防护通过。
- 完成证据只能让 `AF-RISK-DATA-001` 进入人工关闭复核，不自动关闭。

## 回滚

- 导出可撤销 grant 并清理临时包；删除开始前保存范围 hash 和受控备份，处理中断进入可恢复状态。
