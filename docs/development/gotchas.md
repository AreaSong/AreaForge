# 坑点库（Gotchas）

泛化、可复用的高价值坑点：记录「什么场景会踩、为什么、怎么避开」，供后续任务开工前扫读，让坑点在任务路径上被激活。

## 与相邻文档的分工

- `residual-risk-ledger.md`：管风险条目的生命周期（owner、关闭条件、schema V2 校验）。本文只记坑的机理，用 residual ID 回链，不复制状态。
- `docs/guide/faq.md`：面向使用者/操作者的「症状 → 操作」问答。本文面向开发者的「触发 → 根因 → 规避」，重叠主题交叉链接，不重复答案。
- `error-recovery-matrix.md`：失败路径的恢复动作登记（带 validator）。本文只记「为什么会走到这条失败路径」，不登记恢复步骤。
- `ops-006/007/008` 设计文档与 `high-risk-confirmation-packets.md`：确认包上下文的源事实。本文摘录机理并指向原文，不抽离执行边界。

## 录入门槛

满足以下三项中至少两项才录入：可复现、代价高、代码里看不出来。一次性变通、看代码就懂、纯风格偏好、官方文档已覆盖的不录入。设计期识别但尚未实际触发的条目，标注「设计期识别」。

## 条目格式

```markdown
### <一句话坑点>
- 触发：什么场景会踩到
- 根因：为什么
- 规避：怎么做
- 关联：相关路径 / residual ID / 记录
```

## 并发与事务

### Prisma pg adapter 在同一 transaction client 上并发发查询会触发 deprecation 并有排队风险

- 触发：事务回调里用 `Promise.all` 或未 await 的查询共享同一个 transaction client；本地 UX smoke 曾真实复现 `pg` 的 query queue deprecation 告警。
- 根因：`pg` 的同一连接不支持并发查询，Prisma adapter 把并发请求排队，行为依赖 `pg` 版本的容忍度。
- 规避：`packages/db` 已对 transaction 内查询串行化；升级 `pg` / `@prisma/adapter-pg` 前先运行 `pnpm pg:trace-deprecation` 复核。
- 关联：`packages/db`、residual `AF-RISK-SC-003`（closed-evidence）。

### Prisma schema 无法表达「仅活跃行唯一」，伪造 `@@unique([status])` 会约束全部历史状态

- 触发：想约束「每用户最多一条 RUNNING/PAUSED session」时直接在 schema 加唯一索引。
- 根因：Prisma 不支持 partial unique index；`@@unique` 会把 ENDED 等历史状态也纳入唯一性，历史数据立即违约。
- 规避：用 raw SQL migration 建 partial unique index（`WHERE status IN (...)`），schema 里不声明；设计见 `ops-006-business-state-concurrency-design.md`。
- 关联：`docs/development/ops-006-business-state-concurrency-design.md`、residual `AF-RISK-OPS-006`。

### check-then-act 写路径在并发下双开活跃计时、复活已结束 session、重复累加结束副作用

- 触发：事务外检查「无活跃 session」再在事务内创建；读到 `PAUSED` 后按 id 无条件 update；结束计时接口被重复请求。
- 根因：检查与写入之间存在竞态窗口；无条件 update 不校验当前状态；结束副作用未绑定单次赢家。
- 规避：写路径统一带状态条件的 CAS（compare-and-swap）更新，结束副作用只在 CAS 赢家分支执行一次，配合 partial unique index 与 CheckIn 锁串行化。设计期识别，已完成隔离 PostgreSQL 本地验证。
- 关联：`docs/development/ops-006-business-state-concurrency-design.md`、`apps/web/lib/study/concurrency.ts`、residual `AF-RISK-OPS-006`。

## 安全与 HTTP 边界

### 直接取 X-Forwarded-For 第一跳做限速键，登录限速可被伪造头绕过

- 触发：`getClientIp` 信任请求自带的 XFF 头。
- 根因：XFF 前面的跳数由客户端任意填写，只有反代覆写的头可信。
- 规避：只信任 Nginx 覆写的 `X-Real-IP`，XFF 只取最后一跳；新增依赖客户端 IP 的逻辑时先确认取值链路。
- 关联：优化轮修复记录 `workflow/versions/optimization-20260720-long-term-operations.md`。

### 上传接口在业务校验前就把整个请求体读进内存，Content-Length 也不能替代实际字节数

- 触发：`request.formData()` / `file.arrayBuffer()` 在 size 校验之前调用；或用 Content-Length 判断大小后不再数实际字节。
- 根因：formData 解析即全量缓冲；Content-Length 可以谎报。
- 规避：先做 Content-Length 预检拒绝明显超限请求，落盘时按实际字节计数硬限制；崩溃窗口边界见 `ops-007-attachment-crash-window-design.md`。
- 关联：`docs/development/ops-007-attachment-crash-window-design.md`、residual `AF-RISK-OPS-007`。

### 未鉴权端点暴露的运行时身份字段可能已被内部链路消费，最小化不是删字段那么简单

- 触发：`/api/health` 返回 `gitCommit`/`sourceHash`，想直接删掉。
- 根因：该字段被 `experience:runtime:probe` 与 update-center 健康链路消费；单方面删除会破坏体验证据绑定和更新中心。
- 规避：收紧公开面前先盘点消费方，连动观测契约一起改；此项登记不修复，留待独立提案。
- 关联：`apps/web/lib/system/runtime-identity.ts`、优化轮「登记不修复」清单。

## 性能与数据层

### 同一请求内多个区块各自调用同一聚合查询，SSR 一次渲染产生重复查询编排

- 触发：首页多个 Server Component 区块独立调用 `getTodayDashboard` 等聚合服务。
- 根因：服务端组件树里每次调用都独立执行，Prisma 不会自动去重。
- 规避：聚合服务用 React `cache()` 包一层请求级共享副本；注意共享副本内部不要既取当前时间又允许外部传时间点（表面积不一致会导致同请求两份结果）。
- 关联：`apps/web/lib/study/service.ts`、优化轮修复记录。

### 选择器场景复用全量证据树查询，页面数据获取过度

- 触发：考纲节点选择器直接复用作战地图的全证据树查询。
- 根因：选择器只需要 id/标题/层级，全树查询带出掌握证据、复测记录等重负载关联。
- 规避：为选择器建轻量查询（`listSyllabusOptions`）；报表类查询按消费字段 `select`，计数场景用 `count` 不取行。
- 关联：`apps/web/lib/study/syllabus-service.ts`。

### 每个请求都写会话 lastSeenAt，产生无价值高频写

- 触发：会话校验中间层每次请求都 update 会话表。
- 根因：lastSeenAt 精度需求远低于请求频率。
- 规避：节流写（当前 5 分钟一次）；新增「顺手更新」类写路径时先问精度需求。
- 关联：`apps/web/lib/auth/session.ts`。

## 单一事实源

### 规则、文案映射、常量的双副本必然漂移

- 触发：反假学习规则曾在 core 与 web 各一份；版本中心 UI 文案两处副本导致弹窗缺失 `AUTO_APPLY_POLICY_UNSUPPORTED` 映射；考试日期常量散落多处。
- 根因：双副本没有强制同步机制，改一处忘另一处。
- 规避：规则进 `packages/core` 单实现（`evaluateAntiFakeStudy`）；序列化与状态映射提取共享模块（`task-serializer.ts`）；UI 文案工具单文件（`update-center-ui.ts`）；日期常量单一事实源（`exam-dates.ts`）。新增跨层规则时先找归属层，不复制。
- 关联：`packages/core/src/anti-fake-study.ts`、优化轮修复记录。

## 发布与 CI

### 发布链路的脚本引用、资产生成、签名一致性问题只在真实 Release 时暴露

- 触发：CI 里 pnpm 未初始化就执行依赖它的步骤；私有仓库 Release 资产下载未带鉴权；checksum 签名脚本生成的 `SHA256SUMS.sig` 与实际资产不一致。
- 根因：发布 workflow 的执行环境与本地差异大，且只有打真 tag 才完整跑通。
- 规避：改发布 workflow 后运行 `pnpm release:workflow:policy` 与 `pnpm github-release-updater:preflight`；资产/签名变更对照 `release-supply-chain-record-template.md` 的校验清单。教训细节以对应版本 release record 为准。
- 关联：`CHANGELOG.md` 的 Fixed 系列、`docs/development/release-v0.1.7-record.md`。

### Gitleaks 误报只能按单条 fingerprint 放行

- 触发：扫描误报后想按文件或规则整体忽略。
- 根因：按文件/目录/规则放行会把未来真实泄漏一并放过。
- 规避：`.gitleaksignore` 只加已人工核验的单条 fingerprint；策略见 `dependency-policy.md`。
- 关联：`docs/development/dependency-policy.md`、`pnpm secrets:scan`。

## 环境与工具链

### pnpm 提示 ignored builds 时 Prisma/Sharp 未执行构建脚本，后续命令连锁失败

- 触发：新机器或 pnpm 升级后 `pnpm check` 报错。
- 根因：pnpm 默认拦截依赖 build script，白名单机制随版本变化。
- 规避：按 `setup.md` 执行 `pnpm approve-builds --all` 后重跑；FAQ 侧排障见 `docs/guide/faq.md`。
- 关联：`docs/development/setup.md`、`docs/development/validation-matrix.md` 已知验证阻塞节。

### 临时烟测库默认连接池会被并发页面渲染打满（P2037）

- 触发：本地临时 PostgreSQL 上跑全量 UX smoke，重页面并发渲染时报 `P2037` too many connections；已发生两次。
- 根因：临时库默认 max_connections 低，SSR 并发查询叠加连接池不复用。
- 规避：烟测时控制并发或调高临时库连接数；对失败页面重试一次再判定；不要把 P2037 误判为业务回归。
- 关联：`docs/development/docs-100-completion-record.md`。

### 生产主机没有 node/pnpm/corepack，证据导出脚本不能假设主机有仓库工具链

- 触发：SSH 到生产机想直接跑仓库里的 evidence export 脚本。
- 根因：生产主机是最小化环境，只有 Docker 与 systemd。
- 规避：生产侧证据采集只依赖 shell/系统命令或容器内执行；脚本设计时显式声明宿主依赖。
- 关联：`docs/development/ops-001-production-readonly-attempt-20260711.md`、residual `AF-RISK-OPS-001`。

## 流程与证据方法论

### current-bound 证据采集期间并行会话推进 HEAD，两轮证据作废

- 触发：Playwright/UX 证据采集时另一会话 commit 推进了 HEAD，或工作区出现指纹范围内的中间态文件。
- 根因：`ux-source-v2` 指纹绑定源提交与工作区内容，任何漂移都使记录 stale。
- 规避：采集 current-bound 证据前冻结工作区（不并行推进 HEAD），证据绑定收口前的最终源提交；采集完立刻 validate。
- 关联：`workflow/versions/optimization-20260720-long-term-operations.md` 过程噪音节、`pnpm experience:review:validate`。

### 复审发现必须先对照基线行为再定性，否则把等价改写误判为回归

- 触发：Bugbot 复审判「欠账重排合并查询截断到 12 条」为回归。
- 根因：基线 `978af8e` 的原查询本就 `take: 12`，合并后行为完全等价；复审只看了改动后的代码。
- 规避：对「行为变化」类发现，先取基线提交核对原行为再定性；误报案例留档避免重复争论。
- 关联：优化轮 Bugbot 复审记录。

### doctor 的 warn/partial 语义被误读为失败

- 触发：数据完整性 doctor 缺附件 reconciliation summary 时输出 warn/partial，被当成 OPS-006 检查失败。
- 根因：warn 表示证据缺口，不是断言失败；语义区分只写在文档里。
- 规避：消费 doctor 输出时按 `data-integrity-doctor.md` 的状态语义解释；缺证据走补采，不走回归处理。
- 关联：`docs/development/data-integrity-doctor.md`。

## 业务口径

### 任务计划日期变化必须同时刷新新旧两个学习日的快照

- 触发：`updateStudyTask` 修改 `plannedDate` 时只刷新新日期的 CheckIn 快照。
- 根因：旧学习日的任务口径也变了，只刷新单侧会留下矛盾快照；反过来仅改标题等字段时不应触碰任何日期快照。
- 规避：日期变更双侧刷新，非日期字段变更零刷新；设计期识别。
- 关联：`tasks/backlog/0015-structured-state-migration.md`。

### 连续打卡的天数口径存在两套实现，接入前必须先统一

- 触发：想接入 core 的 `summarizeCheckInHistory` 展示连续天数。
- 根因：它与 `getEffectiveStudyStreak` 的连续性口径分叉，同时启用会出现两个不同的「连续天数」。
- 规避：接入或删除前先做产品口径决策；此分叉已登记在优化轮「登记不修复」清单。
- 关联：`packages/core`、优化轮记录。

## 维护

1. 新任务开工前扫读本文相关分组。
2. 收尾时自问：本次是否踩到新坑、是否有缺规则或过时规则？命中录入门槛（2/3）就追加一条。
3. 条目机理过时（根因已被架构消除）时删除条目，不保留僵尸经验。
