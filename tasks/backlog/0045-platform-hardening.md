# 0045 v1.9 平台化加固

```yaml
status: backlog
phase: planning
blockers:
  - 0041 durable jobs and data lifecycle must complete
  - 0042 controlled operations must complete
  - 0043 private challenges and ranking must complete
risk: high
ownerSkill: areaforge-operating-loop
validation:
  - pnpm check
  - pnpm risk:preflight
  - pnpm governance:preflight
  - pnpm dev:test:latest -- --json
residualRiskIds:
  - AF-RISK-DATA-001
  - AF-RISK-DATA-002
  - AF-RISK-DATA-003
  - AF-RISK-OPS-009
releaseRequired: true
```

## 目标

把后台任务、通知、搜索、限流、滥用保护、举报申诉、审计检索、多租户观测、容量治理和灾备体验加固到可长期运行状态。

## 范围

- 将 v1.6 最小后台任务扩展到排名重建、通知和搜索索引，补积压、死信、暂停和人工重放。
- 统一 Workspace/成员/通知/搜索/账户安全/数据任务/挑战入口和跨设备恢复。
- 增加限流、配额、MFA/Passkey 候选、会话风险提醒、举报申诉和审计检索。
- 建立多租户指标/告警、容量阈值、支持包脱敏和灾备演练。

## 当前候选基础

- `packages/core/src/platform-hardening.ts` 已提供无副作用规则：后台任务指数退避、最大尝试与死信判定；Workspace 活动任务/每日导出/成员/存储配额；固定窗口限流；存储/队列容量健康、预警和阻断状态。
- 审计查询只接受规范化 Workspace/actor/action/time/limit；本地候选已提供 Operator-only `GET /api/system/audit-events`，在查询前使用统一规范化器，按 Workspace metadata、actor、action 前缀和时间窗过滤，并只返回严格 allowlist 的脱敏标量摘要。全局搜索候选在投影前按 selected Workspace、ACTIVE membership、owner/share/workspace visibility 过滤，跨租户和未授权私有结果不进入输出。
- 本地候选已提供鉴权只读 `GET /api/search`：仅在显式 ACTIVE Workspace 中搜索活动科目，以及当前 actor 自有的任务/知识点/笔记/错题/资料和获有效 grant 的笔记/错题。服务端先做 Membership/owner/grant 过滤，再返回标题和 canonical href；不搜索正文、附件名、动机/情绪/AI 内容，响应明确 `indexed=false`，当前仍是直接数据库候选而非持久搜索索引。
- 本地候选已提供只读 `GET /api/system/capacity`：Platform Operator 或目标 Workspace Owner 可读取 active member/job、最近 24 小时导出/失败任务、附件数量/字节和最老活动任务时间；其他成员统一 404。当前没有获确认的配额政策，因此响应固定 `limitsConfigured=false`、`enforcementEnabled=false`、`capacityState=OBSERVED_ONLY`，不写死阈值、不拒绝业务写入。
- 原有平台候选包含纯规则、只读审计检索和 `UserNotification` 基础；持久内核、通知与独立 EXPORT 在 51-migration 专用合成库通过 15/11/14 组运行态，EXPORT 桌面/窄视口验收通过。DELETE 与 OPS 另有独立本地验收；排名重建、持久搜索、配额写入、MFA/Passkey、监控外呼及共享/生产启用仍缺，不改变整体 `status: backlog` 和前置 blocker。
- `UserNotification` 已作为默认关闭的持久通知基础进入本地候选：排名事件可走直接事务或受控 `DataJob` worker，鉴权列表/状态 API、独立通知路由、顶部栏直达入口和未读/全部/已隐藏 UI 支持跨设备状态；本人导出包含脱敏通知记录。通知自身不授予 EXPORT、DELETE、排名重建、外部投递或其他域的执行权限，EXPORT 由独立确认与处理器承接。

## 验收

### 首批持久 worker（2026-09-08 历史范围，本地候选）

本节与下节保留首批内核的历史授权/验收边界；通知域的当前确认与证据见后续接力验收记录。

- 用户在收到持久 worker、兼容 migration、新建隔离 PostgreSQL、验证后提交推送及禁止范围后明确同意继续。授权仅覆盖本批本地实现与合成 fixture，不延伸为 EXPORT/DELETE/OPS/RANKING 域执行、共享库或生产写入、Release/tag 或 residual 关闭。
- 已增加 `DataJob.queueVersion/nextAttemptAt/maxAttempts/leaseVersion/pauseRequested/deadLetteredAt` 和第 50 条 additive migration；零协议旧任务不自动入队。DB 包只新增对仓库已有 Core 的 workspace 依赖，无新增第三方包。
- 已实现 `SKIP LOCKED`、持久退避/死信、单调租约代次、scope 重验、暂停/取消/重放、进度心跳、过期恢复、队列统计和独立进程组合入口。事务副作用与成功状态一起提交；旧手工 worker API 拒绝新协议任务。
- 源事实：`docs/modules/background-jobs.md`。执行器无业务处理器时拒绝启动；尚未接入真实导出归档、物理删除、排名重建或搜索域处理器，不能把内核完成写成 DATA-1 全域消费或 v2.0 完成。排名通知候选已暂停域级扩展，等待独立确认。
- 隔离 PostgreSQL 已通过 50 条完整 ledger/SQL checksum 核验及 15 组内核 runtime：竞争领取、跨工作区 SKIP LOCKED、幂等/旧代次拒绝、退避/死信/重放、暂停/取消、事务回滚、权限撤销/过期、心跳/退出、旧协议隔离、账户 scope、workspace archive，以及 prepare/事务副作用之后两个真实子进程 SIGKILL 恢复点。
- 排名通知候选只保留历史合成样例，不计入当前内核证据；默认 queue flag 关闭，既有直接事务路径不变。它的独立确认需补 payload scope/撤销竞争、开关关闭、业务事务原子入队与重放矩阵。
- 验证入口：`pnpm worker:data-jobs:typecheck`、`pnpm worker:data-jobs:selftest`、带精确隔离库 guard 的 `pnpm worker:data-jobs:runtime:selftest`、Core/DB/Web 检查及 `pnpm check`。最终 Git 检查点须在文档同步后重跑相关门禁；runtime 不进入无数据库的默认 check，不能声称普通 CI 已覆盖隔离进程实验。
- 回退：停止 worker 与新协议生产者；保留兼容字段、任务和审计。已有新协议任务时须保留 Web 的协议隔离，不允许旧手工接口接管；不 DROP、不删除业务源数据。
- 当前整体任务仍保持 backlog/planning：前置域处理器、后续平台能力、独立发布与生产证据未齐，本批不关闭任何 residual。

### 内核复核与授权缺口（2026-09-08 历史记录）

- `69678d2` 的 CI run `34207073402` 成功；`ad3f719` 增加通知候选，但其实现及合成通知写入超出首批内核确认。已停止域级扩展和启用；默认开关保持关闭，未触碰共享库或生产。通知候选应按下一个独立确认包收敛，不以测试通过追认授权。
- 新增内核回归复现准备失败与控制请求竞争：数据库已为 `PAUSED`，runner 却返回 `FAILED`。修复为采用失败结算事务返回的真实状态，并补 `CANCELLED` 对照；处理器伪造同名错误仍进入持久失败。
- 准备心跳在提交前排空并续租，提交期间不争抢本任务行锁；8.2 秒合成长事务可在 9 秒租约内提交。进程被杀后的回收测试改为等待数据库释放行锁后的实际状态，不把单次 SKIP LOCKED 空返回当作回收失败。
- 最新 15 组内核隔离回归通过（50 条 migration ledger/hash），通知域测试本轮未执行；历史 13 组结果包含一组通知测试，不能混算为当前 15 组内核证据。
- 下一批通知域确认需覆盖：payload 与任务 Workspace/收件人/源实体严格绑定、提交时 Membership 撤销竞争、总开关运行中关闭、事件键完整冲突校验、业务事务原子入队、跨租户/重放/失败恢复矩阵。确认入口见 `docs/development/high-risk-confirmation-packets.md`。

### 排名通知域接力验收（2026-09-13，本地候选）

- 复用 2026-09-09 已确认的通知域本地范围，在既有 loopback 合成库核验全部 50 条 migration 名称、状态和 SQL checksum；本轮未新增或执行 migration，未连接共享库或生产。
- 通知协议严格绑定 actor、recipient、Workspace、受控 kind/source/version、事件键与完整指纹；保存账户 authRevision、Membership ID/revision 和 Workspace revision，撤销后恢复不能使旧任务复活。直接写入与队列共用来源规则，入队与源事务原子提交。
- 修复并发空 update ORM upsert 的唯一键竞争：任务和通知以数据库 `ON CONFLICT DO NOTHING` 原子去重；同键异 scope/source 拒绝，重复消费不重置已读、隐藏或 revision。
- 修复失效收件人阻断业务：直接写入/队列两模式下，离开、移除、暂停账户与挑战结束、解散、移除参与者、处理申诉共 24 个场景可提交源业务，失效收件人不获通知，有效收件人继续投递。请求者、Workspace 或来源不合法仍拒绝，已排队任务权限失效进入死信。
- 所有权转移目标在业务事务中独立检查 ACTIVE 账户与 Membership，不依赖通知开启；关闭通知/直接写入/队列三模式下共 9 个失效目标负向场景保持 owner、revision、审计和队列不变，恢复目标有效性后可正常转移。
- 新增 `worker:data-jobs:run` 独立入口与默认关闭的 `DATA_JOB_WORKER_ENABLED`；只接受 `--once` 和 `--workspace=<id>`，Web 不启动该进程，运行中的通知处理器也检查开关。
- `pnpm worker:notifications:runtime:selftest` 的 11 组通过：独立配置进程、事务回滚/并发幂等、八类事件、source/scope 伪造、撤销后重入、运行中开关、锁竞争、冲突死信重放、失效收件人业务链、所有权目标有效性、真实进程强杀恢复。强杀发生在 prepare 与通知副作用写入后但事务提交前；恢复仅投递一次，旧租约无法提交。
- `pnpm worker:data-jobs:runtime:selftest` 的 15 组独立内核回归重新通过；通知 fixture 已从内核入口移除，不能用普通 CI 或内核回归替代通知域运行证据。
- 本批未改变 UI 路由、未做浏览器验收，不证明真实用户投递、外部通知渠道、排名重建/导出/删除、共享/生产启用、Release 或 v2.0 完成；原有治理修改与截图不得混入本批 Git 检查点。`0041` 完整导出是下一项独立确认范围。
- 最终代码、构建、文档结构、风险、治理与 secret 检查通过；`residuals:validate` 和 `tasks:doctor` 在当前日期失败，根因是未改动的 `AF-RISK-REL-001.acceptedException` 仍为 `approved`、却已于 2026-09-10 到期。任务引用缺失报错是 reader 拒绝整个无效台账后的连带结果，不代表这些 ID 被删除。本批不续期、不改台账、不关闭 residual；Git 仅保存明确标注 partial/WIP 的检查点，不能称为全门禁或 v2.0 完成。
- 检查点 `24e344c` 已推送；[CI run 34731611015](https://github.com/AreaSong/AreaForge/actions/runs/34731611015) 在 Full dependency audit 失败，尚未进入完整 CI 验收。本地重新执行 `audit:all` 同样命中 2 critical + 2 high，`audit:prod` 命中 2 critical + 1 high：当前 Next `16.3.0`、Sharp `0.35.3`、开发链 js-yaml `4.3.1` 分别需独立确认修补到 `16.3.3`、`0.35.4`、`4.3.2`。公告、配置适用面和升级边界见高风险确认包；没有确认当前部署可利用，不因 Windows 特定条件或本地构建通过而豁免审计。后续顺序为依赖补丁、到期状态对齐、完整导出本地包。

### 三项独立确认后的推进（2026-09-13）

- 维护者已明确批准依赖安全补丁、到期例外对齐和完整导出本地闭环；此前 WIP/CI 失败保留为历史证据，不再把这三个本地范围写成待批准。DATA-DELETE、其他域、Release/生产和 residual 关闭仍不在授权内。
- Next/eslint-config-next `16.3.3`、Sharp `0.35.4`、js-yaml `4.3.2` 已按精确版本安装；lock 变化限于这些包及其 Next SWC/helper、Sharp 平台/libvips/WASM runtime 依赖。build allowlist 和其他 override 未变；冻结安装通过，全量/生产依赖审计均为 0 漏洞。
- `AF-RISK-REL-001` 仅从 `approved` 对齐为 `expired`，原日期、接受事实、basisHash 与安全默认均不变；18 项台账和任务 doctor 重新通过。例外不再有效，未续期、未关闭风险或开启自动更新。完整构建/专项/CI 与导出实现继续逐项记录，不由上述结果代替。
- 新依赖下 `pnpm check`、PNG/JPEG/WebP/AVIF 编解码、冻结安装和全量/生产审计已通过。只读自测改为冻结真实检查时点，关闭复核夹具读取当前权威类型；长期证据 CLI 保留失败退出码并排空 JSON，修复大输出被截断。只读副作用、快照、台账、任务、状态/交接和运维类型检查已通过；只读投影仍明确缺生产/长期证据，不因 schema 修复成为 production-ready。
- 上述依赖与到期对齐检查点为 `09a81af3178d8ec05c304e86a37fc893eae0279e`，已推送且 [CI run 34735167371](https://github.com/AreaSong/AreaForge/actions/runs/34735167371) 成功。该 CI 不覆盖其后的 EXPORT 改动。
- EXPORT 后续独立实现与验收见 `0041-data-lifecycle.md`：持久意图/租约代次、流式私有归档、本人权限快照、一次性下载、关闭后的显式副本回收已有代码；51-migration 合成库中 14 组专项含四个真实 SIGKILL 点，15 内核与 11 通知回归复验通过，任务中心和真实 API 的桌面/窄视口验证通过。
- 只读核验发现的学习关系遗漏、首次 pull 前取消句柄泄漏及回收失败对象阻塞批次已修复并补回归；跨用户签发凭证统一隐藏为 404，预览选择器补显式可访问名称。测试池只更新专属槽 2，保留原槽 1 与既有治理/截图改动，不连接共享库或生产。
- 最终完整检查已通过；补齐标准检查发现的 Storage 测试类型与 CLI 参数契约。运维专项另修正读取当前台账的两处旧固定时钟、OPS-001 合成 bundle 的时效/显式版本，以及长期 gate 自测缺失的 journey 绑定；合成 journey factory 与体验 validator 自测共用，绝不替代真实浏览器或降低 validator。OPS 投影仍保留历史生产记录与新鲜证据缺口，不由结构校验升级为 production-ready。
- 实际交接 JSON 另复现采集与输出跨秒导致的 `ageSeconds` 失配；状态生成器改为同一次冻结时点，推进时钟回归与真实 status/handoff/bundle 默认绑定校验通过。投影继续返回 blocked/needs_attention，不能据此宣称线上健康、Release 或长期运营完成。
- DATA-DELETE 已获独立本地确认；53-migration 专用库的 17 组运行态及最终 API/桌面/390px/320px 验收通过，含五类对象、真实权限变化、并发/死信、五个强杀点、画布原生查询过滤和备份水位防复活，详见 `0041`。没有删除真实用户数据，不扩大 EXPORT、其他域或生产授权；本任务仍因排名重建、搜索、配额、MFA、观测/灾备与交付缺口保留 backlog。

### OPS 独立本地接力（2026-09-14）

- `0042` 已在独立批准下实现冻结身份绑定、root 桥接/登记、跨进程锁、不可覆盖日志、停止屏障和回执恢复。38 组合成运行态与真实 API/桌面/390px/320px 浏览器验收通过，原始事实与 Web 脱敏投影分离。
- 新入口默认关闭，副作用适配器仅操作本批合成资源；生产适配器未运行，未触碰共享/生产数据、发布或 residual 状态。本任务仍因排名重建、持久搜索、配额、MFA、观测/灾备和综合交付保留 backlog。

- 大数据量、并发、队列故障、恢复和灾备的全域验收仍属于后续综合门禁；故障不得阻断个人学习主链。
- 桌面、移动和无障碍旅程通过，所有页面和后台任务明确显示 Workspace scope。

## 回滚

- 各派生消费者可单独关闭；保留个人学习源事实、任务状态和必要审计，禁止用投影回写源事实。
