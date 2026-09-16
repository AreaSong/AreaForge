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

### QUOTA-CAPACITY（本地专项已验证）

- 2026-09-16 维护者已在精确包展示后回复“可以，允许，继续”，批准成员席位及跨用户/工作区/实例活跃任务总量的本地实现、新合成库/槽 3 验收和通过后提交推送。默认关闭、显式限额、无新增 DDL；精确范围见[高风险确认包](../../docs/development/high-risk-confirmation-packets.md)的 QUOTA-CAPACITY 节，契约见[容量准入](../../docs/modules/capacity-quotas.md)。
- 静态核对后不复用普通可见性统计：停用/冻结/归档不代表成员席位或文件已释放；Owner 预留、原始占用和准入事务需要专项证明。既有配额的 8 项纯规则/mock 基线通过，不代表新包实现或运行态完成。
- Core/DB 准入、成员接受及三域错误反馈已实现；独立 CAPACITY fixture、33 组运行态和 18 组浏览器/API 专项通过。本地最终门禁与 Git/CI 须按本批检查点独立核对，不把专项记录升级为全平台交付。存储预留/可证释放、跨分区滚动导出次数的删除后计量、MFA/观测、最终跨域验收以及 Release/生产继续承接，未因拆包降出原目标；整体任务和 residual 状态不变。

#### CAPACITY 本地验收证据（2026-09-16）

- 成员按 canonical Owner 预留一席与原始 ACTIVE membership 计量；停用/冻结/归档不提前释放。邀请接受沿既有身份、有效期和 revision 校验，失败回滚账户、个人空间、成员、邀请状态和审计，已消费凭证仍按原规则拒绝。
- 三域活跃任务按用户（含 ACCOUNT）、工作区及实例总量共同准入，保留旧分区配额；授权与同键复用优先，计数与任务/审计/搜索代次同事务提交。学习、退出及已有任务控制不因新限额或坏配置被新增阻断。
- 专用 fixture scope 为 `7e5926480b33f0fa64545d7fbf6607fcac0c69dfdfcdd5d79fa8998d5b994bf7`。仅部署/重复部署既有 54 条 migration，逐条核对 ledger/checksum；固定批准 tree 对应 55 个文件的内容摘要 `c0bef75c08d04669d96db7b204dba5a649a8fa1f3c5e84ea0036260083a66413`，拒绝同数量 SQL 变更、额外文件、软链接与 schema 漂移，无新增 DDL。
- `pnpm capacity:runtime:selftest <private-fixture-root>`：33/33 组，包含 Owner/退出/重入、停用/冻结/归档/转移、账户失败回滚、三维总量/新旧开关、同键/三域竞争、旧快照 40001、多进程、搜索与注册四处 SIGKILL。真实 57014/55P03 也验证 EXPORT 新准入错误映射；总量关闭及控制/下载保留旧冲突语义。
- `pnpm capacity:browser:selftest <private-fixture-root>`：18/18 组、21 张成功截图。实际邀请预览失败恢复、锁竞争/双击、满额/退出后重试、注册无半账户、三个任务入口超限/取消恢复、丢失回执同键重试、越权/伪造字段、满额下学习与安全直查，以及桌面/390px/320px 焦点、主触控尺寸和无横向溢出通过；两处模拟传输失败单独标记。
- 记录为 `output/capacity/runtime-evidence.json` 和 `output/playwright/capacity/evidence.json`，最终本域源码指纹 `sha256:1ee9b7e2508ed8b53d4919ff69eadcc60994f2603479b77451617a93a77290a0`。后续源码变化必须重采；失败诊断图片不计入成功证据。
- 本批更新槽 3，端口 `43173`，URL `http://127.0.0.1:43173`；产品源码指纹 `sha256:e2ca16fa785a1b50005b337158ef90f7225b709787735feca0bf08185fc545ad`，fixtureId `195dc564d672e88f35be7c626d7cb00c94de47d1369a56dd98c88c473b083aa4`。精确核对旧 QUOTA Web 后替换，原镜像、槽 1/2、旧库/卷/目录与证据保留，不放宽跨 fixture 覆盖拒绝。
- 独立只读复核提出的并发 fail-fast 提前结算、屏障无界等待和 migration preimage 绑定问题已修复，新增 3 项回归进入默认测试链；两项窄复核未发现新增阻断。浏览器发现的锁查询 void 解码及相关主操作触控尺寸也已修复。复核不替代上述实测。
- 最终本地门禁：冻结安装、`pnpm check`、固定迁移 repeat deploy（无待执行项）、33/18 组重新采集、测试池 selftest/typecheck/doctor/dry-run、原隔离模式与 worker 自测、审阅记录校验、docs/tasks/residual/risk/governance/secrets 及全量/生产依赖审计通过。两项依赖审计为 0 漏洞；ops readiness/handoff/bundle/alert 仅证明只读结构和缺口投影，不证明生产健康。Git/CI 交付回执按本批分支检查点独立核对。
- 最高 R1，仅本批合成准入与控制；无 EXPORT/SEARCH/RANKING 消费者、物理删除、导出回收、备份恢复或外呼，uploads/exports 为空。核验槽 1/2、既有数据库容器/卷名称及原 QUOTA 镜像仍保留。默认开关保持关闭，不连接共享/生产、不发布 Release、不改自动策略或关闭 residual。

#### CAPACITY 只读交接审阅

本节记录继承改动及修正的只读复核；safetyFacts 只描述审阅动作，不替代上文 R1 合成验证。

```text
recordId: protected-path-review-capacity-20260916
reviewedAt: 2026-09-16T11:36:45.583Z
reviewer: Codex 主代理与两项独立只读复核
reviewScope: 7620816 之后的 CAPACITY 准入、错误反馈、隔离脚本及受影响治理入口
sourceCommit: 762081688d71f3e437a5800ee61f4069bc88f48c
worktreeState: dirty-reviewed
worktreeStatusHash: sha256:173886285048d1e1c798a7746c76ecc0e5ec602638758fc7161cb24bde6774a7
protectedPathScope: read_only_side_effect_guard_inputs
protectedPathFingerprint: sha256:6dd6f20c6248235619f1be64b0fb5954979c8655314acd220acc4115b4b30e2c
protectedPaths: README.md, package.json, docs/development/high-risk-confirmation-packets.md, docs/development/validation-matrix.md
reviewCommand: git status --short; pnpm ops:status; pnpm governance:preflight
reviewDecision: pass
findings: 原有 CAPACITY 改动与新增修正已分范围复核；并发排空、屏障退出及固定迁移内容护栏已补回归，限域导出错误映射保留旧语义；旧失败图片不进入本批成功证据
followUpRefs: tasks/backlog/0045-platform-hardening.md, tasks/backlog/0046-v2-platform-gate.md
doesNotProve: production health; all repository paths were reviewed; git worktree cleanliness after review; updater apply; backup/restore; migration; rollback; residual ledger closure
result: reviewed
safetyFacts:
  productionWriteAttempted: no
  serverCommandAttempted: no
  backupRestoreAttempted: no
  migrationAttempted: no
  updaterApplyAttempted: no
  rollbackAttempted: no
  secretValuePrinted: no
  residualLedgerUpdated: no
```

### QUOTA 后台任务准入本地包（本地专项已验证）

- 维护者已批准默认关闭、显式配置的 EXPORT/SEARCH/RANKING 新请求配额、新本地合成库验收及通过后提交推送。边界见高风险确认包的 QUOTA 节，协议见 `docs/modules/data-job-quotas.md`。
- 复用 `e9e0389` 的 54 条 migration，不新增 DDL；按本人任务分区计活跃名额与滚动 24 小时导出，幂等/控制不重复计量，不限制学习主链。
- 本地实现与 24/12 组运行态/浏览器专项通过；最终门禁和 Git/CI 回执独立核对。整体仍为 `backlog/planning`，成员/存储及跨工作区总量配额、MFA、完整跨域与交付仍缺，不改变 Release、生产或 residual 状态。

#### QUOTA 本地验收证据（2026-09-16）

- 三个生产入口在配额开启时统一 Serializable；共同准入在授权及同键复用后，按本人 × scope × Workspace 计数，并与任务插入同事务提交。默认关闭，两个限额必须显式配置；坏配置不影响登录、学习、查询及已有任务控制。不新增表、使用历史或删除后账本。
- 新专属合成库完成现有 54 条 migration deploy、repeat deploy 及逐条 ledger/checksum 验证，schema 仍为 `6001f7ef0e030295a589f4e845eba3f75ba3b214885863f9251e637aa4ae4583`。fixture scope 为 `2ee2122414790a426047236561d094ee307c8c59fc66176d74cfde5ca8dcc893`；没有修改 SQL 或连接旧域/共享/生产数据库。
- `pnpm quota:runtime:selftest <private-fixture-root>`：24/24 组通过。覆盖三域真实入队、ACCOUNT/Workspace/用户分区、零限额/坏配置/关闭模式、同键与不同键并发、六独立进程、滚动窗口及回拨、所有可恢复状态保留名额、非 Serializable 拒绝、事务回滚、两处 SIGKILL，以及先建立旧快照后竞争提交的 SQLSTATE 40001 中止。Prisma 原生 SQL 错误包装与 ORM 错误分开识别，不把抢锁失败当作旧快照证据。
- `pnpm quota:browser:selftest <private-fixture-root>`：12/12 组通过。真实登录/重新验证、三入口 429 及恢复提示、取消释放名额、导出不退款、满额下同请求回执重试、越权/未知字段拒绝，以及满额时实际学习任务创建和搜索直查均通过。桌面/390px/320px 的焦点、状态播报及无横向溢出通过，12 张成功截图随结构化记录保存。
- 记录为 `output/quota/runtime-evidence.json`、`output/playwright/quota/evidence.json`；共同源码指纹 `sha256:a1f0b4e9f99d53cc7b13f201573d5ac6305014b2efeb242bc4ad117b885152ce`。配额错误映射放在 API 层，contracts 仍只含类型声明。失败诊断截图不作为成功证据。
- 本批更新槽 3，端口 `43173`，URL `http://127.0.0.1:43173`，产品源码指纹 `sha256:908b8c81804249aeb82d2f213a91dae3124640b58664513c963e3e0f61d3be07`，fixtureId `de4e7fe0e51df0848b4555720a67e3ce7a7530f6450b6b4913dd010cbd4f728a`。先核对旧 SEARCH 身份后只替换该 Web；保留旧镜像、槽 1/2、旧库/卷及证据，不放宽跨 fixture 覆盖检查。
- 最高 R1，仅本地合成准入与状态控制；没有运行 EXPORT/SEARCH/RANKING 业务消费者，uploads/exports 为空，无归档、搜索文档或排名发布副作用。共享/生产、成员/存储及全站配额、MFA、Release、备份恢复、外呼、自动策略与 residual 关闭均不在本包；旧域记录不自动成为当前源码证据。
- 截图复核后把导出错误反馈移到提交按钮旁，避免被长预览遮蔽；验收要求提示与恢复按钮同时位于视口内且命中测试不被固定栏覆盖，并采用实际视口截图。最终 24/12 组证据已在该修正后重新采集。

检查点审阅（仅本批，不替代完整仓库或生产评审）：

- `reviewedAt`：`2026-09-16T07:17:34Z`；基线 `e9e0389c37990e31e0ebc0b94f2a4d2ec8c430db`，已审阅 QUOTA 的 84 个代码/文档/成功证据路径，排除两张失败诊断截图。
- `worktreeStatusHash`：`sha256:1bc8d2f2664b617e0b337954e0beef64406b755ef26d491cf5e79e2a00fcca55`；对应暂存后的路径状态，不作为内容指纹。
- `protectedPathFingerprint`：`sha256:4fa404d227034dedb4b3552ab8120dc7764e6b0de1f666496184837e25b34e2f`，scope 为 `read_only_side_effect_guard_inputs`；本域代码内容另由上方运行态/浏览器源码指纹绑定。
- 发现与处置：未发现本批阻断项；原生 SQL 冲突包装已按受控 SQLSTATE 核验，运行时反馈归 API 层，导出反馈遮挡已修正并复验。未改 schema/SQL、原始学习数据规则、残余台账、生产或发布策略。
- 未证明项：全仓审阅、后续工作树持续干净、完整成员/存储/全站配额、v2.0、Release、生产健康/apply、备份恢复、历史其他域源码新鲜度及 residual 关闭；Git/CI 以实际回执为准。

### 持久搜索本地包（本地专项已验证）

- 维护者已明确批准用户 × Workspace 的标题白名单索引、新增派生表/任务枚举、专属合成库 migration 与撤权/删除/强杀/浏览器验证，以及通过后提交推送。精确边界见 `docs/development/high-risk-confirmation-packets.md` 的 SEARCH 确认包。
- 基线 `434c510`、53 条迁移；新增索引为派生数据，不改变学习源事实、角色/grant、导出权或生产状态。已形成独立本地实现与专项证据；成员/存储及跨工作区总量配额、MFA/观测及综合交付仍缺，整体任务保持 `backlog/planning`。
- 验证必须包含过期权限标题、跨查看者源删除副本和冻结旧代次，不执行既有删除完整运行器中的 backup/restore；不复用旧域 fixture 或把历史 53 条记录改为新候选证据。

#### SEARCH 独立本地证据（2026-09-16）

- 已实现 `WorkspaceSearchPartition` / `WorkspaceSearchDocument`、严格 `SEARCH_INDEX_REBUILD` 协议、独立固定 worker、原子整代发布、代次/租约与五开关拒绝；不写学习源事实，不保存正文或搜索历史。源事实见 `docs/modules/workspace-search.md`。
- 专属 loopback 合成库完成 canonical 54 条 migration deploy、repeat deploy 与逐条 ledger/checksum 校验；既有 53 条 SQL 未改。fixture scope 为 `c5015d7817c24e2567c8f8fc9b06ae8f50dce7d7bfde78be3f0a77eefba3fb0e`，不记录私有目录、连接串或合成凭据。
- `pnpm worker:search:runtime:selftest <private-fixture-root>`：32/33 组通过。覆盖六类源、双用户/工作区、真实成员/角色/所有权/账户撤销、grant 目标/权限/到期、ABA 源变化、幂等/并发/控制/死信、两处 SIGKILL、提交后租约过期、五开关、导出排除、跨查看者冻结/恢复/删除、五类对象与 Workspace 删除、同 ID 不同类型及 FK/冻结 guard。
- 容量包含 10,000/10,001 文档、8,192/8,193 UTF-8 字节和 16 MiB 总标题；10,001 grant 及超过 20,000 条真实冻结 fence 后仍安全直查，可取消已有任务。分区占锁会结束原事务后重新授权直查，删除屏障仍拒绝。源跨 Workspace 后的旧搜索副本可清除，旧 grant 等非搜索引用继续阻断，未放宽通用删除权。
- `pnpm worker:search:browser:selftest <private-fixture-root>`：16/16 组通过。真实登录/API、202 同请求重试、乱序刷新/查询、暂停确认/恢复/取消、跨身份拒绝、Workspace 迟到回执隔离、动态搜索、源变化/冻结恢复及失败恢复均通过；320/390/768/820/1024/1280/1440 七档视口和键盘验证通过。原生 Chrome 125% 缩放实测 `innerWidth 1440 → 1152`、`devicePixelRatio 2 → 2.5`；CSS zoom 仅为附加检查，临时 Chrome profile 已清理。
- 修复了极窄屏顶部搜索继承 32px 图标锚点宽度的问题：折叠为可操作搜索图标，展开占视口可用宽度，保留原学习状态和命令入口。
- 收尾修复了排名契约仍引用旧屏障函数名导致的总检查失败；断言改为明确验证 `RANKING_REBUILD` 在可见性读取前进入共享派生屏障，并增加排名/搜索、冻结拒绝和混合队列 mock 回归。另补提交末端源修改与 grant 到期两种竞态；成功回执不替代当前读取重验，旧标题或过期共享副本不会进入查询结果。
- 最终记录：`output/search-index/runtime-evidence.json`、`output/playwright/search-index/evidence.json`；同一本域源码指纹为 `sha256:d6dfe51404a401f642e83f9e6750df86e0b044e82e5268a4c92305d49f8baff8`。截图位于同一 browser 目录；失败诊断截图不作为成功证据。
- 本批更新测试池槽 3，端口 `43173`，URL `http://127.0.0.1:43173`，产品源码指纹 `sha256:34f17d58810dbf47da1f0f2ec28047e10ce47a1ea5672af9b72fb13d845fbe33`，fixtureId `8bb440f489b193d82e70b1f63a485d66751f1692411e0ea72f06a9f3f4b5d58e`。仅替换原槽 3 Web；槽 1/2、旧 RANKING/OPS 数据库、卷、目录与证据保留。
- 最终代码/文档门禁按验证矩阵执行 `pnpm check`、SEARCH/worker/测试池专项、docs/tasks/residual/risk/governance/secrets/audit 与只读运维交接检查；Git/CI 回执与本地专项分开核对。该记录只证明本地合成环境，不使旧域证据自动变为当前源码证据。
- 最高实际运行写边界为 R1；未操作共享/生产、真实用户数据/附件、备份恢复、Provider/SMTP、服务器/root 配置、Release/tag/GHCR、自动策略或 residual 关闭。`AF-RISK-DATA-001/002/003`、`AF-RISK-OPS-009` 的分类、复核日期和关闭条件未改；完整 v1.9/v2.0 仍 partial。
- 接力审阅边界见 `docs/development/search-index-checkpoint-review-record.md`；旧排名 guard 断言修复后完整检查已通过，新增竞态与本域运行态/浏览器证据已重新采集。提交与 CI 回执仍须独立核对，不以本地截图或运维结构预检替代。

### 已有基础

- `packages/core/src/platform-hardening.ts` 已提供无副作用规则：后台任务指数退避、最大尝试与死信判定；Workspace 活动任务/每日导出/成员/存储配额；固定窗口限流；存储/队列容量健康、预警和阻断状态。
- 审计查询只接受规范化 Workspace/actor/action/time/limit；本地候选已提供 Operator-only `GET /api/system/audit-events`，在查询前使用统一规范化器，按 Workspace metadata、actor、action 前缀和时间窗过滤，并只返回严格 allowlist 的脱敏标量摘要。全局搜索候选在投影前按 selected Workspace、ACTIVE membership、owner/share/workspace visibility 过滤，跨租户和未授权私有结果不进入输出。
- 本地候选已提供鉴权只读 `GET /api/search`：仅在显式 ACTIVE Workspace 中搜索活动科目，以及当前 actor 自有的任务/知识点/笔记/错题/资料和获有效 grant 的笔记/错题。服务端先做 Membership/owner/grant 过滤，再返回标题和 canonical href；不搜索正文、附件名、动机/情绪/AI 内容，本次响应按当前授权/来源/冻结校验返回 `indexed/indexState/indexedAt`；索引关闭、缺失、失效、超限或占锁时安全直查，不返回旧索引标题、计数或时间。
- 本地候选已提供只读 `GET /api/system/capacity`：Platform Operator 或目标 Workspace Owner 可读取工作区观察量，其他成员统一 404。该观察面不投射准入策略配置，响应继续为 `limitsConfigured=false`、`enforcementEnabled=false`、`capacityState=OBSERVED_ONLY`；独立 QUOTA 与 CAPACITY 准入分别受各自开关控制，不能用观察值替代原始占用。
- 原有平台候选包含纯规则、只读审计检索和 `UserNotification` 基础；持久内核、通知与独立 EXPORT 在 51-migration 专用合成库通过 15/11/14 组运行态，EXPORT 桌面/窄视口验收通过。DELETE、OPS 与 RANKING 另有独立本地验收；排名重建的 26/12 组运行态/浏览器证据见 `0043`。SEARCH、QUOTA 与 CAPACITY 已有各自独立本地专项；存储及跨分区滚动导出计量、MFA/Passkey、监控外呼、全域综合门禁及共享/生产启用仍缺，不改变整体 `status: backlog` 和交付 blocker。
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

### RANKING 独立本地接力（2026-09-15）

- `0043` 已在独立批准下完成持久重建协议/worker、权限与来源历史绑定、代次拒绝、原子整榜和当前可见性重验；26 组隔离运行态与 12 组真实浏览器/API 验收通过，包含桌面/390px/320px、键盘历史折叠和两处进程强杀。
- 新 RANKING 合成库仅部署既有 53 条 migration，未新增 DDL；测试池只替换经核验的槽 3，保留旧库/卷/证据。六个开关均须精确开启，默认关闭，Web 不启动进程或同步重算；CI 默认检查新增排名类型检查与隔离 guard 自测，但不冒充需合成库的运行态/浏览器测试。
- 历史章节中的“排名重建未完成”仅代表当时范围，不覆盖本次本地证据；完整版本 UI/跨域矩阵、持久搜索、配额、MFA/观测、受保护合并、Release 和生产仍是后续门禁，不关闭 residual。

## 回滚

- 各派生消费者可单独关闭；保留个人学习源事实、任务状态和必要审计，禁止用投影回写源事实。
