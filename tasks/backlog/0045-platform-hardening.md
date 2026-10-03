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
- Git/CI：CAPACITY 提交 `ddf690de7e030b103b36be3d9359ffc32ecaf6bd` 已推送当前分支，[CI run 35093378182](https://github.com/AreaSong/AreaForge/actions/runs/35093378182) 的 verify 成功。此回执只覆盖该提交；下方 STORAGE 确认准备不计入该 CI 或 CAPACITY 的实施授权。

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

### QUOTA-STORAGE（本地已确认，实施与验收中）

- 下一包建议限定为每工作区 note 附件/FILE 资料字节准入：持久归属、写前原子预留、真实文件清理后的单次结算，以及冻结/删除/恢复接点。独立开关默认关闭，未知归属不记零；不新增长期使用历史或改变备份保留策略。
- 源码核对发现暂存工作区仅在审计中，skip/reuse 清理发生于决策事务之后，独立删除则在全部文件 REMOVED 后才删源行。因此不能用可见性统计、FAILED 或关系解除直接返还额度。
- 维护者收到[QUOTA-STORAGE 精确确认包](../../docs/development/high-risk-confirmation-packets.md)后明确回复“继续下一步”，已独立批准兼容 DDL、新合成库/文件/恢复快照、槽 3、并发/强杀/API/窄屏、独立复核和通过后提交推送。本包开始实施，运行态、浏览器及最终交付仍须逐项验证。
- 跨分区滚动导出计量、MFA/观测、综合门禁、受保护合并、Release/生产与运营证据继续保留；导出副本容量及用户/实例存储总额如需扩展，另行定界。不关闭 residual，不从 CAPACITY 批准外推本包授权。

#### STORAGE 阶段 1A（2026-10-02）

- **1A 已完成；STORAGE 整体 partial**。范围仅为当前源码、原子准入与并发正确性；分支 `codex/v19-platform-hardening`、HEAD `ddf690de7e030b103b36be3d9359ffc32ecaf6bd`，成果保留工作区，未提交/推送。既有文档、失败截图及旧域资源保留。整包交付仍受下述依赖审计失败和 1B/1C 缺口阻断。
- 复用现有 Serializable 准入：note 幂等 claim、字节占用与 PENDING intent 同事务提交，文件落盘在后；Owner-only 上传、不可变 Workspace 桶、原始状态计量与失败关闭边界保持。修复 Core 证明编码依赖 `TextEncoder` 导致的平台无关类型检查失败，纯 UTF-8 编码经 ASCII/中文/emoji/孤立代理对照确认旧摘要字节兼容；不更改计量粒度、释放协议或 migration/hash 常量。
- `pnpm storage:quota:runtime:selftest /private/tmp/areaforge-v20-storage-yzFcRtKE` **16/16**：重跑原 7 组，新增最后 1 byte 独立连接竞争、旧快照 SSI 中止、写前已提交占位、事务回滚、首次同键请求实际锁等待竞争、8 类坏 metadata、旧 Note 三状态/FILE 归属及双引用拒绝、满额/坏配置下文本/下载/任务控制、资料批次回执。证据 [runtime-evidence.json](../../output/storage-quota/runtime-evidence.json)；源码指纹 `sha256:429402248478d077e9560815257b85e820339375a821359b5ea140a4c6d155cc`，包含 Core 修复、验收脚本及学习服务调用面。历史 7 组指纹不充当当前验收。
- 新专属合成根 `/private/tmp/areaforge-v20-storage-yzFcRtKE`，库 `areaforge_v20_storage_7eede8329fde`、容器 `areaforge-v20-storage-7eede8329fde`、卷 `areaforge-v20-storage-7eede8329fde-data`、loopback 端口 `32768`。fixture ID `741ca6503a353c0d725c77340e28de55bc14de9cac1e7b30f5f8e802f130755a`；经 UID/仓库 marker、0700 根和目录、0600 凭据、no-follow/硬链接拒绝、容器/卷标签、镜像/端口及迁移前像验证。55 条 deploy/repeat deploy 和逐条 ledger/checksum 通过。旧临时根不可找到，未写旧 fixture；AI/SMTP/worker 关闭，未切测试池。
- 验证通过：`pnpm check`（含 Core/DB/Storage/Web 测试、类型、lint、schema、build；lint 有既有 warning），`pnpm storage:quota:typecheck`、`pnpm storage:quota:isolation:selftest`、18 个定向 Core/DB/Storage/Web 用例、`pnpm attachment:crash-window:selftest`、`pnpm attachment:reconciliation:summary:selftest`、docs/readiness/links/evergreen、tasks/residuals/risk/governance/secrets 与差异检查。定向测试使用 `TSX_TSCONFIG_PATH=apps/web/tsconfig.json pnpm exec tsx --test` 加四个 `workspace-storage-quota` 测试文件。独立只读复核未发现 1A 阻断；其指出的首次同键和旧 FILE/双引用测试缺口已补齐。完整检查日志见 [stage-1a-check.log](../../output/storage-quota/stage-1a-check.log)。
- **整包门禁失败**：`pnpm audit:prod` 返回 1 critical / 4 high / 4 moderate，涉及既有 Next.js、fast-uri（Prisma 依赖链）、Nodemailer；本阶段无依赖修改，未擅自升级或接受例外。日志见 [stage-1a-audit.log](../../output/storage-quota/stage-1a-audit.log)。整包提交/推送前须完成依赖处置并重跑该门禁，不能由 1A 专项通过替代。
- 全量检查中曾出现一次既有 `m4-challenger1-deep-adversarial.test.ts:64` 的时间阈值失败（105.5ms > 100ms）；该文件单独重跑 9/9 通过，查询约 0.7ms。未改无关实现或放宽阈值，最终全量回执以以上检查日志为准。
- **1B 接续点**：先重新核验上述 fixture（归属不能证明则只新建本包资源），读取本确认包、`docs/modules/workspace-storage-quotas.md`、`scripts/quality/storage-quota-{fixture,source,runtime.selftest,admission-runtime,upload-runtime}.ts`、`apps/web/lib/study/attachment-storage-service.ts` 与 `attachments-service.ts`。在同一批准范围内推进预留/落盘/清理/结算的真实进程强杀，以及冻结/删除/可信账本恢复联动；完整浏览器/API 矩阵留 1C。合成基础回归中的 cleanup/replay 不证明这些后续门禁。未执行真实附件、共享/生产、备份恢复、测试池切换、Release、主分支合并、整包提交推送或 residual 关闭；本阶段到此停止。

#### STORAGE 阶段 1B-1（2026-10-02）

- **1B-1 complete；STORAGE 整体 partial**。范围仅为上传/文件清理的真实进程强杀及重启恢复。分支与 HEAD 保持 `codex/v19-platform-hardening` / `ddf690de7e030b103b36be3d9359ffc32ecaf6bd`，保留原工作区改动，索引为空，未提交/推送。未推进冻结/删除、备份恢复、依赖升级、浏览器或测试池。
- 复用并重新核验 1A 的 STORAGE 根、数据库、容器/卷、端口与 fixture ID（定位见上节）：UID 501、仓库 marker、0700/0600、no-follow/硬链接拒绝、容器/卷标签、镜像、loopback 32768 及完整 55 条 ledger/checksum 通过；无 migration apply。环境采用白名单，AI/SMTP/监控外呼及各 worker 关闭。
- 真实边界：`beforeStagingWrite` 在 PENDING/预留事务提交后；`afterStagingWrite` 在 staging 文件与目录 fsync 后；`afterAtomicRename` 在 rename 和两目录 fsync 后、READY 提交前；`beforeReleaseCommit` 在精确 unlink、目录 fsync 与缺失重验后、释放 CAS 前；新增参数钩子 `afterReleaseCommit` 位于真实事务提交后、调用方返回前。无生产环境变量触发入口。显式 reconciliation 增加可选 `attachmentIds` 收窄，空数组不处理任何记录；原 15 条 PENDING 与所有运行前已有附件行保持不变。
- `pnpm storage:quota:runtime:selftest <上述根> --stage=1B-1` **11/11**，包括 8 次独立子进程 SIGKILL：上传三窗口；staging/final 清理各两窗口；强杀后双文件拒绝。父进程验证 IPC nonce、PID/PPID、UID、fixture、源码指纹，以独立数据库连接检查屏障持久状态及 `exitSignal=SIGKILL`，再由新进程恢复。缺文件意图释放后同键创建新身份；完整文件恢复 READY 并复用原身份；清理提交前继续占用，重试缺失后结算；提交后回执丢失保持原释放时间/证明。释放后 final/staging 再现均拒绝删除和新准入；双文件、inode 换位及部分文件保留占用，不手工改库制造恢复。
- 同源码 1A **16/16** 回归通过；定向 Core/DB/Storage/Web **18/18**、`storage:quota:typecheck`、`storage:quota:isolation:selftest`、`attachment:crash-window:selftest`、`attachment:reconciliation:summary:selftest` 通过。聚合证据 [runtime-evidence.json](../../output/storage-quota/runtime-evidence.json) 的 `currentStages` 仅接受同源码阶段结果，`history` 保留原 1A 与各次运行原始边界，不把历史 1A 改写为 1B。当前指纹 `sha256:4e33919a0a5ff3df9fad05f951f25faae02cacb024babc73a756f25c1c8b44f0`，原范围未缩小，包含新增子进程/验收/证据脚本和相关业务源码。日志为 `output/storage-quota/stage-1b-1-{runtime,admission,targeted}.log`；最终 `pnpm check` 通过（含 Core/DB/Storage/Web、schema、build，0 error / 197 条既有 lint warning），日志 `output/storage-quota/stage-1b-1-check.log`；docs/readiness/links/evergreen、tasks/residuals/risk/governance/secrets 及差异检查通过，日志 `stage-1b-1-gates.log`。独立只读复核未发现本轮阻断，另重算 456 文件指纹与记录一致；指出未单独覆盖 CAS 已执行但 COMMIT 未返回及新增并发释放冲突，不将五个已验证窗口泛化为全部崩溃组合。
- 整包依赖审计仍失败：沿用 `stage-1a-audit.log` 的 1 critical / 4 high / 4 moderate，不升级依赖、不接受例外、不关闭门禁。已报告高危路径为 next/og、Prisma 开发服务依赖的 fast-uri 及 Nodemailer 地址解析；本阶段为固定合成 PDF 的服务层直调与 loopback PostgreSQL，不启动 HTTP/Prisma 开发服务、不执行邮件或外部 URI 解析，不把此局部适用性判断写成依赖安全通过。
- **1B-2 精确接续点**：重新核验同一 fixture 后，从 `packages/db/src/workspace-storage-quota.ts` 的原始占用/`lockAttachmentFileOperation` 与删除共享栅栏，进入既有冻结 rowHash、取消冻结、DATA-DELETE 文件 REMOVED → 源行删除事务的计量联动；以独立限定用例证明冻结不释放、未 REMOVED 不返还、最终删除仅结算一次。保留本节五窗口与 1A 回归；可信账本恢复和完整浏览器/API 验收分别继续留后续授权阶段，依赖处置为整包交付前置，不由本阶段执行。

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

#### STORAGE 阶段 1B-2（2026-10-02）

- **1B-2 complete；STORAGE 整体 partial**。范围只含冻结、取消冻结/回收站逻辑恢复、物理删除与原始 Attachment 计量一致性。分支 `codex/v19-platform-hardening`、HEAD `ddf690de7e030b103b36be3d9359ffc32ecaf6bd`；前序工作区成果保留，索引为空，未提交/推送。
- 最小实现：定向 `claimDatabaseDeletion(intentId)` 的过期回收加相同 intent 谓词，失败复现见 `output/storage-quota/stage-1b-2-repro.log`；删除 `afterSql` 验收钩子接收原事务连接，用于证明真实 DELETE 后的事务内外差异，默认授权/冻结计划校验不变。同源码 1A 回归复现必选 to-one 被注入非法 `where` 的冻结可见性缺陷：按 Prisma 关系基数提升过滤到父查询；内部主键投影只用于响应交付前冻结重验，移除未请求字段且不重放 mutation。新增独立 1B-2 矩阵与全表既有行摘要、既有文件 inode/hash 保留检查；源码指纹新增 `scripts/workers/data-delete-*`，未缩小原范围。
- 冻结 Note/FILE 与恢复保持占用/文件身份，工作区取消冻结不释放；PENDING、FAILED 阻断原删除协议，真实清理已释放的 FAILED 也不获得删除资格。冻结期间确认、清理和限定 reconciliation 不改源行。单个 FILE 资料删除闭包不反向纳入 Attachment，因此文件与占用保留；FILE 文件物理删除使用原 WORKSPACE 闭包，不沿计量桶扩大删除范围。
- 未到期 claim 拒绝后，仅本次登记 intent 用原 fixture 方法调整 `frozenAt/availableAt`；不改全局时钟/策略、源 rowHash、授权 hash、文件阶段或租约。文件未 REMOVED、hash 不符、unlink 后失败保留占用；真实重试恢复。Note/FILE 各自覆盖 DELETE 已执行但未提交、回滚与最终提交：事务内源行已消失，独立 backend 仍见源行/原始用量，无账本；成功提交后源行退出计量，账本唯一，重复执行拒绝。自然等待租约到期，旧租约拒绝、精确回收不修改另一个过期 intent。文件共享锁/冻结排他锁竞争、删除文件意图与普通清理竞争、同桶他人/同人其他对象/其他工作区均验证。
- 复用根 `/private/tmp/areaforge-v20-storage-yzFcRtKE`，数据库/容器/卷 `areaforge_v20_storage_7eede8329fde` / `areaforge-v20-storage-7eede8329fde` / `areaforge-v20-storage-7eede8329fde-data`、loopback `127.0.0.1:32768`、UID 501、fixture `741ca6503a353c0d725c77340e28de55bc14de9cac1e7b30f5f8e802f130755a`。marker/仓库/0700/0600/no-follow/标签/镜像及 55 条 ledger/checksum 重新验证，无 migration apply。最终专项起点的 3996 条既有行和 137 个既有文件保留；协议单例 `DataDeletionVisibility` 从 85 推进至 114，单独记录而不冒充业务对象变化。诊断轮次生成的对象保留，不做历史清理；仅新建合成对象执行冻结/精确删除。
- 证据：`output/storage-quota/runtime-evidence.json`、`stage-1b-2-runtime.log`，当前源码 `sha256:86d93b74bd6835d37ac06179879c0675695dd1e3957e1e13028627f58221be37`。同源码 1A **16/16**、1B-1 **11/11**（8 次真实 SIGKILL）通过，聚合 `currentStages` 三阶段均绑定当前指纹，`history` 保留旧证据。定向 **28/28**、`storage:quota:typecheck`、STORAGE/DELETE isolation、附件 crash-window/reconciliation-summary、`pnpm check`（含删除 worker typecheck；0 error / 197 条既有 lint warning）、docs/readiness/links/evergreen、tasks/residual/risk/governance/secrets 与 diff 门禁通过。日志均为 `output/storage-quota/stage-1b-2-{runtime,admission,crash,targeted,typecheck,isolation,check,gates}.log`；最终独立只读复核无本阶段阻断；独立定向 10/10、重算源码指纹及三阶段/既有对象保留证据一致。
- 保留整包阻塞：`stage-1a-audit.log` 的 **1 critical / 4 high / 4 moderate** 未处置，不升级、不接受例外、不宣称 audit 通过。Next HTTP、SMTP 与 Prisma 开发服务未启动，限定合成输入不进入其已知外部攻击入口。新增响应保护的 `omit` 分支仅静态复核，未独立运行真实 Prisma omit 专项；不扩大为全量可见性验收。未覆盖两个独立释放 CAS 路径（CAS 已执行但 COMMIT 未返回、并发释放 CAS 冲突）；不以删除事务替代。可信账本快照恢复、完整浏览器/API、依赖处置、测试池、Release/生产和 v2.0 总门禁均未推进。
- **1B-3 接续**：先复核本节资源与最新工作区，不回退。读取 `docs/modules/data-deletion.md` 的“删除账本与历史备份”、`docs/modules/workspace-storage-quotas.md`、QUOTA-STORAGE 确认包，以及 `packages/core/src/data-delete-ledger.ts`、`packages/db/src/data-delete-replay.ts`、`scripts/workers/data-delete-worker.ts`，参考 `scripts/quality/data-delete-restore-runtime.ts` 的协议（不可直接运行旧 fixture 流程）。从可信外部 ledger head、快照内 sequence/head 与 dump hash 绑定开始；只能为 STORAGE 新建并登记独立恢复库/0700 目录，保留源库、源文件和所有其他域资源，不使用旧 DELETE fixture 全套流程，不开放新准入/HTTP，直到可信后缀重放及文件/原始占用验证完成。生产恢复另行确认。

#### STORAGE 阶段 1B-3（2026-10-02—2026-10-03）

- **1B-3 complete；STORAGE 整体 partial**。仅本地合成快照、可信后缀恢复、文件/原始占用与 fixture 准入门禁。分支 `codex/v19-platform-hardening`，HEAD `ddf690de7e030b103b36be3d9359ffc32ecaf6bd`；前序改动保留，索引为空，未提交/推送。新增 `scripts/quality/storage-quota-restore-{tools,control,data,runtime}.ts` 与隔离工具测试，复用既有 Core 账本选择、DB 恢复计划/冻结校验及删除执行器；未改业务协议、migration/hash、依赖或生产开关。
- 正常静止快照通过 `pg_export_snapshot` 与 `pg_dump --snapshot` 绑定真实快照内水位 **1**，dump hash `a14bd2438948d9bb5e3a3c4899239c6958b587140b53ad3734eb1a4927f6dc25`；文件清单 hash、水位 head 及 schema 摘要分别保存。独立查询受控源固定可信 **sequence 5** / `sha256:cf72aa0565cb221fcefe0752fca7c42a884212254ed92ca80ddee0b5b1d28493`，重放输入另读私有 `ledger.json`，实际重放 **2–5**。可信 head 漂移负例随后将源推进到 6，旧 head 不再授权开门。成功源计划/hash、授权 hash、文件阶段与可信 head 未被改写以凑通过。
- 确定性提交屏障：删除时间 `15:37:54.732Z`，快照 `15:37:54.861Z`，快照水位 **4**，随后提交 **5**；时间筛选得到空后缀，序号正确补放 5。仅无附件 Note 的事务挂起，文件写入全程静止；该用例不证明任意在线 dump 一致。正常与竞争目标都实际 pg_restore 并重验 55 条 ledger/checksum、schema、目标身份和 dump 内水位；CHECK 仅对已核对的两个 PostgreSQL 等价括号格式精确归一化，不放宽旧迁移。
- **33/33 组**：真实文件 unlink 后失败保留源行/占用，按持久意图和新租约继续；实际完成两份计划内文件及数据库删除；重复后缀零重复删除/结算。恢复后 9 条 Attachment（READY 6、PENDING 1、FAILED 2，其中一条已验证释放）与 8 个文件一致；冻结仍占用、原始字节门槛实测，其他 owner/Workspace 和单 FILE 资料闭包外附件保持。dump 篡改、错误 head、恢复库实际水位与错误 checkpoint、缺失/乱序/篡改后缀、自算 head、scope/目标误绑、缺文件/双文件/两种再现/hash/身份/未知归属均拒绝。失败目标不覆盖重建、不清 orphan。
- `StorageRestoreGate` 是 **fixture 隔离控制**：关闭时实际拒绝服务层上传（包括 quota=false）；全部核验后仅允许一次真实 `createStorageAttachmentIntent` 合成准入，再关闭。调用前重查目标、独立 head、全表摘要和文件 inode/hash；证据/head 漂移均关闭。HTTP、外呼、测试池未启动，不宣称生产恢复门禁或跨进程/并发开放已交付。
- 最终新源 `/private/tmp/areaforge-v20-storage-QRNBNxM9`，库/容器/卷 `areaforge_v20_storage_a2dc1dd721a1` / `areaforge-v20-storage-a2dc1dd721a1` / `areaforge-v20-storage-a2dc1dd721a1-data`，`127.0.0.1:32773`，UID 501，fixture `0adc8bda60eea34c7d2427c7d88673423dc854be5b6901f948381693cf4bb023`。20 个目标均新建在该根 `restores/` 和同容器的 `_restore_*` 库，以私有登记及数据库 comment 绑定。正向目标 `areaforge_v20_storage_a2dc1dd721a1_restore_1724f023ec1b`，ID `f5e08234381646d82346b0813c87c62930308ef4c34f67cda004f2dffceb0769`；完整列表在聚合证据。0700 根/0600 文件，dump/正文/凭据仅留私有目录。
- 原 `/private/tmp/areaforge-v20-storage-yzFcRtKE` 的 **4999 条既有行、170 个既有文件及可见性代次 114** 完全保持。前序回归改用本轮新根 `/private/tmp/areaforge-v20-storage-pG55qtVX`（`a112bd5e1810` / 32770），不写原资源。另保留诊断根 `/private/tmp/areaforge-v20-storage-YKOGGxpi`（`cc7fcddfe280` / 32769、1 目标）、`pG55qtVX`（8 目标）、`/private/tmp/areaforge-v20-storage-m9DReq4c`（`2e15abd47eb1` / 32772、17 目标）和初始化中断根 `/private/tmp/areaforge-v20-storage-DsQLGXDk`（`5d67249377a0`，登记端口 32771，容器退出、不可用）。本机磁盘曾仅余约 355 MiB，OrbStack 两次离线；空间恢复后仅启动精确已登记容器，不清理失败卷/目标。原容器/卷/端口身份恢复并核验，未触碰其他域。
- 证据 [runtime-evidence.json](../../output/storage-quota/runtime-evidence.json)，当前源码 `sha256:92e9b8b1718a7d6d1026514b119c0d2e066987e39b54ae573bb21b971ab5c79a`。`currentStages` 同源码 **1A 16/16、1B-1 11/11、1B-2 20/20、1B-3 33/33**；history 保留历史阶段。指纹自动覆盖新增恢复脚本/工具封装/测试，未缩小既有范围。命令为 `pnpm storage:quota:runtime:selftest <新根> --stage=1B-3 --prior-root=<原根>`，回归使用上述 pG55qtVX；最终源执行 deploy/repeat deploy。日志 `output/storage-quota/stage-1b-3-{runtime,admission,crash,deletion,migrate,targeted,isolation,check}.log`。定向 **39/39**、STORAGE/DELETE typecheck/isolation、附件 crash-window/reconciliation-summary 通过。`pnpm check` 首次被既有动态岛 200ms 压力阈值拒绝（223ms）；原测试单独重跑 12/12（该项约 2.7ms）后完整 `pnpm check` 通过，未改阈值；首轮失败与重跑均保留在 check 日志。
- 独立只读复核提出恢复校验失败的客户端连接清理缺口和实际水位负例覆盖不足，已修复：异常断开连接但保留资源；真实恢复连接复用同一水位校验函数，分别断言错误 head/sequence，再保留登记篡改负例。最终独立只读复核无本阶段阻断，独立重算 467 个指纹输入与四阶段证据一致；docs/readiness/links/evergreen、tasks/residual/risk/governance/secrets/diff 门禁通过。全量 check 为 0 error / 197 条既有 lint warning；以上静态/治理证据不替代 33 组运行态。
- **保留缺口**：释放 CAS 已执行但 COMMIT 未返回、并发释放 CAS 冲突、删除响应可见性 `omit` 的真实 Prisma 专项、依赖审计处置、完整浏览器/API 与最终整包交付。历史 `stage-1a-audit.log` **1 critical / 4 high / 4 moderate** 原样保留，未升级、未接受例外、不宣称 audit 通过。无共享/生产、Release、合并或 residual 关闭。
- **后续独立补验入口**：先读本节、QUOTA-STORAGE 确认包、`docs/modules/workspace-storage-quotas.md`、`docs/modules/data-deletion.md` 与 validation matrix。CAS 从 `apps/web/lib/study/attachment-storage-service.ts::settleAttachmentStorageCleanup` 的 `updateMany` 到事务提交窗口及并发调用入手，配合 `storage-quota-process-{child,control,runtime}.ts`、`packages/db/src/workspace-storage-quota.ts`；omit 从 `packages/db/src/data-delete-result-visibility.ts`、`data-delete-visibility.ts` 与 `storage-quota-deletion-scope-runtime.ts` 入手。恢复工具仅供参考本地协议，不直接复跑旧 DELETE fixture；本阶段到此停止，不自动推进这些缺口。

#### STORAGE 阶段 1B-4（2026-10-03）

- **1B-4 complete；STORAGE 整体 partial**。仅实施释放 CAS 成功、事务提交前的崩溃恢复及同附件并发释放；运行态 **12/12**、最终检查及独立只读复核已通过。分支 `codex/v19-platform-hardening` / HEAD `ddf690de7e030b103b36be3d9359ffc32ecaf6bd` 不变，前序差异保留，索引为空，未提交/推送。业务代码仅增加参数观察钩子 `afterReleaseCas(tx)` / `afterVerifiedRelease(tx)`；不改锁序、CAS 谓词、角色/权限、文件身份、计量粒度、留存或默认开关。新增 `storage-quota-release-{child,runtime}.ts` 和阶段证据测试，复用既有 runner、子进程身份校验及快照/保护断言。
- staging/final 各覆盖强杀及正常提交：精确 unlink、目录 fsync、缺失重验之后真实 `updateMany.count=1`；钩子读取真实事务 PID/xid 和释放字段。每例另有同桶成员附件，事务内原始占用 **60 B**，独立连接仍见未释放字段和 **120 B**，真实新上传被限额拒绝。SIGKILL 验证 IPC nonce/PID/PPID/UID/fixture/源码及退出信号；等待 PostgreSQL 事务和排他锁消失，并由独立连接重新取得行锁，才验证仍为 120 B。新进程经既有清理路径重验缺失、重新 CAS 后用量降为 60 B，原暂存释放时间回滚；正常放行则保留事务内时间。最终新上传才可使用释放的 60 B，重复回执保持证明/时间。
- 同附件并发分别覆盖首调用提交、CAS 后强杀回滚、已释放重复请求，并分别从 staging/final 开始。两独立子进程先完成准备屏障，再使首个事务停在 CAS 或已释放缺失重验后；竞争者真实调用返回 false / `WORKSPACE_STORAGE_QUOTA_BUSY`，且首事务在竞争结束后仍持有排他锁。竞争者 unlink/CAS 均为 0；首个提交后重试幂等，回滚后新进程重试缺失并结算。每例实际 unlink 总计 1、持久释放 CAS 1，同桶成员附件及其他既有对象不变。**正常锁序在附件排他锁处排除竞争，未命中或伪造 CAS count=0 分支**；不覆盖网络层 COMMIT 已发送但回执丢失。
- 复用普通回归根 `/private/tmp/areaforge-v20-storage-pG55qtVX`：数据库/容器/卷后缀 `a112bd5e1810`，loopback `32770`，UID 501，fixture `a65c31517cd7380f5ec780c48d600b129cd0b5f69234a60213d3af631132a176`。执行前完整 marker、仓库、权限、标签、镜像、端口及 55 条 ledger/checksum 均通过；无 DDL/apply、新环境、恢复目标或测试池操作。daemon 在线、宿主约余 11 GiB。定点预验及完整矩阵均执行既有对象保护；首轮完整矩阵前 **1263 行/43 文件/visibility 40** 原样保持；复核修复后的最终矩阵保护 **2076 行/82 文件/visibility 40**。后续回归也分别在前后验证既有全表行 hash 与文件 inode/hash，原源、恢复源/目标、失败资源均未写入或清理。
- 聚合证据 [runtime-evidence.json](../../output/storage-quota/runtime-evidence.json)，源码 `sha256:0e178bfefdcd413d4be0b2a5c3964cbb24f09317950a3124adaf5556ce81b192`，原指纹范围未缩小并自动包含新增脚本/钩子。独立命令 `pnpm storage:quota:runtime:selftest <上述根> --stage=1B-4`，回归用 `--stage=1A` / `--stage=1B-1`。`currentStages` 仅列当前指纹 **1B-4 12/12、1A 16/16、1B-1 11/11**，1B-2 **20/20**、1B-3 **33/33** 保持 history，最终整包仍需绑定最终源码。恢复路径未改，无钩子的既有调用语义保持；未机械复跑快照恢复或创建目标。日志为 `output/storage-quota/stage-1b-4-{runtime,admission,crash,targeted,typecheck,check,gates}.log`；定向 **20/20**、STORAGE typecheck、隔离及附件 crash-window/reconciliation-summary 已通过；最终 `pnpm check` 在白名单合成环境退出 0，包含类型/测试/lint/schema/build，0 error / 197 条既有 lint warning。docs/readiness/links/evergreen、tasks/residual/risk/governance/secrets/diff 门禁通过。
- 独立只读复核发现普通回归的严格 visibility 保护晚于 complete 保存：合成 40→41 输入复现“先保存再失败”。已把断言前移，且证据 writer 在任何 I/O 前拒绝缺失/变化代次；真实 writer 的临时目录测试证明三种普通阶段均拒绝并保留上一份证据。日志 `stage-1b-4-review-repro.log` 保留失败、`stage-1b-4-review-fix.log` 为 2/2 修复通过；最终源码三矩阵和定向检查已重跑。最终独立只读复核确认原 P2 修复且无新增阻断，独立重算 **470** 个指纹输入与最终三阶段一致；复核仅读源码/日志，真实写入验收由主运行器执行。未独立核验主线程保存的 5255 文件基线 hash，不将该限制写成独立保护证明。
- `release-cas-precommit` 与 `concurrent-release-cas` 仅在当前指纹的完整双文件形态矩阵、保护断言和单次结算证据齐全时关闭本地验收缺口，不关闭任何生产 residual。继续保留 `prisma-omit-runtime`、依赖审计、完整浏览器/API 和最终整包交付。历史 `stage-1a-audit.log` **1 critical / 4 high / 4 moderate** 未重跑、未升级、未接受例外；已报路径 next/og、Prisma 开发服务 fast-uri、Nodemailer 不由本次固定合成 PDF/loopback 服务层执行激活。1B-3 的恢复门禁仍仅为 fixture 机制。
- **1B-5 精确交接**：仅从 `packages/db/src/data-delete-result-visibility.ts`、`packages/db/src/data-delete-visibility.ts`、`scripts/quality/storage-quota-deletion-scope-runtime.ts` 的真实 Prisma omit 输入/投影与删除可见性入手，核对真实查询结果、必需关系过滤与未选字段；重新验证普通 fixture 身份后只建本阶段对象，不写恢复目标、不沿计量桶扩大删除范围。保留本阶段 CAS/锁行为回归和历史证据边界。1B-4 收尾后停止，本轮不进入该专项、依赖升级、浏览器、备份恢复或发布。

#### STORAGE 阶段 1B-5（2026-10-03）

- 本阶段只补真实 PostgreSQL / Prisma 7.9.1 的 omit、响应字段投影与冻结可见性。分支 `codex/v19-platform-hardening` / HEAD `ddf690de7e030b103b36be3d9359ffc32ecaf6bd`，前序工作区保留，索引为空，不提交/推送。新增 `storage-quota-omit-runtime.ts`，复用 runner；既有必选关系消费者新增冻结后身份登记回调供调用方 finally 恢复，原 1B-2 调用语义不变；`withDeletionVisibility` 仅新增可选 `afterQuery` 观察参数，不传递正文、参数或快照，不替换查询/跳过重验。现有投影逻辑未发现需修复缺陷；初轮 fixture LINK 缺少 `externalUrl` 触发真实 P2039，已按既有约束修正合成输入并保留失败日志。
- 真实矩阵 13 组覆盖：findUnique/findMany 的 id/业务字段 omit、false/省略/select、合法不同层 select/omit 与嵌套 include；输入不变、字段属性不存在、正向顶层/关联结果、冻结列表/可选及必选 to-one、父查询/take/_count、owner/workspace 限制、同 owner 其他对象/同 workspace 成员/其他 workspace、逻辑恢复。create/update/upsert 更新分支以行数与 revision 证明单次执行；交互事务与批事务覆盖 omit/select/count。查询后观察屏障提交真实冻结，read 重试两次后隐藏；mutation 恰执行一次且已提交，响应按协议拒绝，不声称回滚。
- 普通 fixture：`/private/tmp/areaforge-v20-storage-pG55qtVX`，库 `areaforge_v20_storage_a112bd5e1810`，容器 `areaforge-v20-storage-a112bd5e1810`，卷同名 `-data`，UID 501 / loopback 32770，fixture ID `a65c31517cd7380f5ec780c48d600b129cd0b5f69234a60213d3af631132a176`。执行前 marker/仓库/权限/标签/daemon/55 条 ledger/checksum 通过。历史 8 条 fence 保留；“无冻结对象”指本轮选定对象尚未冻结，不清空历史全局 fence；全局空 fence 快路径仅纯函数覆盖。最终矩阵精确 6 对冻结/恢复，visibility +12（含消费者冻结后失败的恢复）；既有全表行摘要与文件 inode/hash 保持，本轮主要附件行/文件也单独核对。首轮准备失败 +4（冻结两次、finally 恢复两次）；随后试运行 44→54、54→64，均未保存 complete 证据。
- 验证与保存：`pnpm storage:quota:runtime:selftest <普通根> --stage=1B-5 --no-save` 用于先验收；必需检查和只读复核完成后再去掉 `--no-save` 保存。定向 `tsx --test packages/db/src/data-delete-visibility.test.ts scripts/quality/storage-quota-{deletion,evidence}.test.ts` 14/14；STORAGE typecheck/isolation 已通过，首轮 `pnpm check` 退出 0（0 error / 197 条既有 lint warning）；收尾门禁通过；独立复核指出消费者失败后的恢复登记缺口，已修复并加入真实冻结后观察器失败/恢复用例，最终复验结果见本节后续记录。日志统一 `output/storage-quota/stage-1b-5-{runtime,targeted,typecheck,isolation,check,gates}.log`。聚合 `runtime-evidence.json` 的 currentStages 仅收同指纹实跑阶段，旧阶段原样留 history；1B-5 保护失败拒绝覆盖上一完成证据，未放宽 1A/1B-1/1B-4 代次不变保护。
- 未覆盖：全局 omit（项目未配置）、全局零 fence 的真实运行、所有 Prisma 操作排列、upsert create 分支、事务内代次竞争/COMMIT 网络回执丢失。独立 1B-4 和 1A/1B-1 未重跑：业务投影/锁/CAS 未改变，本轮禁止物理删除，已有必选关系消费者已在本矩阵实跑。1B-2/1B-3 与其他阶段保持历史范围，恢复门禁仍仅 fixture 机制，不借新指纹认领旧证据。
- 后续依赖处置入口：根 `package.json`、`apps/web/package.json`、`packages/db/package.json` 及其余 workspace 声明，解析版本 `pnpm-lock.yaml`，构建准入 `pnpm-workspace.yaml`；历史审计 `output/storage-quota/stage-1a-audit.log` 为 **1 critical / 4 high / 4 moderate**，本轮未重跑/升级/接受例外。已知 next/og、Prisma 开发服务 fast-uri、SMTP Nodemailer 攻击入口未启动，限定合成值不引入外部输入。后续只能先定界依赖最小修复和验收，不能沿用本轮授权安装/升级、开浏览器、备份恢复、提交发布或共享/生产写入。完整浏览器/API、最终源码整包验证、Release/生产仍缺，STORAGE 整体 partial。
- **最终结果：1B-5 complete；STORAGE 整体 partial**。独立只读复核的失败恢复问题已修复并复核通过；最终 13/13，visibility **88→100（+12）**，3448 条既有行、144 个既有文件及历史 8 条 fence 保持。源码 `sha256:65f81b4187640b2b4bc73fee57566422bb6aaa96df0c19de98b54ae9b8a3664b`；聚合 currentStages 仅 **1B-5**，history 原始记录保留。本地 `prisma-omit-runtime` 缺口在上述覆盖范围关闭，不关闭生产 residual。旧 1B-4 的两项本地结论保留为历史证据；聚合仍要求最终指纹的阶段证据，不能据此认领同源码 CAS 验收。
- 检查结果：定向 14/14、STORAGE typecheck/isolation、附件 crash-window/reconciliation-summary 及 docs/tasks/residual/risk/governance/secrets/diff 门禁通过；最终实现的 `pnpm check` 在白名单合成环境退出 0（0 error / 197 条既有 warning，不连接真实业务库）。其后仅 runner 的 1B-5 concurrency 元数据专属分支修正，重跑类型/定向/真实矩阵并独立复核；未将元数据修正冒充新一轮完整整包验证。前一份 76→88 的 1B-5 记录误沿用 1A 通用 SSI 描述，不支持 SSI 声明，原记录保留 history；本节最终指纹记录已改为真实查询后冻结提交屏障。后续精确代次记录为 64→76、76→88、88→100，每轮 +12。本轮所有冻结已逻辑恢复，未物理删除、建立恢复目标、切测试池、升级依赖或提交发布；至此停止。


### DEP-0 依赖重新审计与本地确认包准备（2026-10-03）

本节为 DEP-0 历史准备记录；当前结果见下方 DEP-1 检查点，不把历史“待确认”作为当前状态。

- DEP-0 诊断与准备完成，DEP-1 **待确认、未实施**；未安装/升级依赖，未改变既有 STORAGE 1B-5 历史事实或其批准范围，STORAGE 整体仍 partial。
- 当前分支/HEAD 与交接一致；依赖内容基线 SHA-256 `c107ea961f568e8922c46cc4e80e10fd2fc8da1d0ebd5027ed7ad3ab2f985c72` 绑定工作区而非仅 HEAD。新鲜 2026-10-03 10:36 北京时间 audit:all=1 critical/7 high/5 moderate，audit:prod=1 critical/4 high/4 moderate，均退出1，属于漏洞命中。
- 精确候选：Next/eslint-config-next 16.3.6、Nodemailer 10.0.9、fast-uri override 3.1.8、brace-expansion override 5.0.12；Prisma/client/adapter 保持实际 7.9.1，Sharp/其他 override/minimatch patch 保留。fast-uri unknown 有官方修复证据；braces@3.0.3 仍无可验证已发布修复，阻断全量门禁，不接受例外或推测 3.0.4 存在。
- 接续以 [DEP 本地确认包](../../docs/development/high-risk-confirmation-packets.md#dep-本地依赖修补确认包dep-0待确认未实施) 的精确写集、条件、验证与局部回退为准；[审计证据](../../output/dependency-audit/dep-0/audit-details.json)、[基线](../../output/dependency-audit/dep-0/baseline.json) 保留。依赖稳定后再集中最终源码整包/指纹及独立批准的 STORAGE 运行验收，不逐包重建恢复环境。没有提交推送、Release、生产或 residual 关闭。
- 阶段收尾：docs:readiness、docs:links、docs:evergreen、tasks:doctor、docs:completion、risk:preflight、governance:preflight、residuals:validate 与 diff 检查通过（仅文档/治理证据）；未执行升级后冻结安装、pnpm check、邮件/图像/数据库运行验证。前后12个依赖输入、39,577个安装树文件/软链接条目与 Git 索引内容相等，索引仍为空；见 [未变证明](../../output/dependency-audit/dep-0/unchanged-proof.json) 与 [门禁结果](../../output/dependency-audit/dep-0/validation-results.json)。

- **DEP-0 本轮重新核验（2026-10-03 11:20 北京时间）**：保留已有 DEP-0 和 STORAGE 历史记录；本轮 [证据目录](../../output/dependency-audit/dep-0-current/) 独立保存。分支/HEAD、12 个依赖输入 hash `c107ea961f568e8922c46cc4e80e10fd2fc8da1d0ebd5027ed7ad3ab2f985c72` 不变；audit:all=1 critical/7 high/5 moderate、audit:prod=1 critical/4 high/4 moderate，均真实退出 1（漏洞命中）。正式公告与 registry 重查支持 Next/eslint-config-next 16.3.6、Nodemailer 10.0.9、fast-uri 3.1.8、brace-expansion 5.0.12；braces 仍无已发布修复，全量门禁阻塞。接续 [确认包本轮核验](../../docs/development/high-risk-confirmation-packets.md#dep-0-本轮重新核验2026-10-03-1120-北京时间待确认未实施)，标识 DEP-1-LOCAL-20261003，待确认、未实施。仅诊断和准备，不授权安装、生成、数据库/容器、真实邮件、Git 或生产；STORAGE 整体 partial 与原指纹证据范围不变。
- 本轮收尾：DEP-0 complete（诊断与准备范围），DEP-1 待确认；文档/静态门禁退出 0，独立只读复核未发现阻断问题。[未变证明](../../output/dependency-audit/dep-0-current/unchanged-proof.json) 核对依赖输入、安装树、生成目录与索引保持，前序工作保留。本阶段未执行升级后检查或修补，braces 审计阻塞继续保留。

### DEP-1 局部本地依赖修补检查点（2026-10-03）

- 用户明确批准 `DEP-1-LOCAL-20261003`；执行前分支、HEAD、12 个逐文件 hash、聚合 hash 及索引全部匹配。原像保存于 [DEP-1 证据](../../output/dependency-audit/dep-1/)，前序 STORAGE、根 scripts、schema/migration 不变。
- 已安装 Next/eslint-config-next 16.3.6、Nodemailer 10.0.9、fast-uri 3.1.8、brace-expansion 5.0.12；仅配套 Next env/plugin/八个 SWC 节点和引用变化。lock 仍为 689 节点；Prisma/client/adapter 7.9.1、pg 8.22.0、Sharp 0.35.4、balanced-match、其他 override、patch 和 build allowlist 保留。
- 冻结安装退出 0；邮件 7 项、minimatch 导出/lint glob、Sharp/品牌图片、SVG/Next 本地图像处理及 standalone 构建通过。北京时间 13:28:03–13:29:20 完整 `pnpm check` 退出 0，含 1,364 项 workspace 测试、无 DB 冻结/worker 自测、类型、lint、validate 和两处生成；生成目录 107 文件无内容变化。初次隔离/测试类型错误和后续通过日志均保留；secrets/governance 通过。最终文档门禁和独立复核见该证据目录。
- 升级后 audit:all（13:18:29–13:18:31）为 **0 critical / 1 high / 0 moderate / 0 low，退出 1**；audit:prod 全零、退出 0；13:20 JSON 明细一致。唯一剩余 braces@3.0.3 / GHSA-vfj7-8cjw-p6xm 继续阻断，不接受例外。精确链与最新上游来源、回退边界见 [执行回执](../../docs/development/high-risk-confirmation-packets.md#dep-1-本地执行回执2026-10-03)。
- 当前依赖输入聚合 hash：`75397d8b4490129710668a9bde00f2f104b399a0d63b55d6071472892345a376`。DEP-1 局部修补检查点已完成；依赖治理和 STORAGE 整体仍为 **partial**。旧 STORAGE 证据仅覆盖旧指纹，最终整包留待依赖稳定后独立批准。未验证 Node24/Linux、真实数据库/omit 或浏览器；未调用数据库、容器/测试池、真实邮件/Provider、备份恢复、Git 交付、Release、生产或 residual 关闭。本阶段停止，braces 留待下一独立确认包。

### DEP-2A braces 定向调查与确认包（2026-10-03）

- **DEP-2A complete 仅限调查、未应用草案和确认包准备；以下待确认叙述为历史，DEP-2B 本轮状态见后续执行记录。** 依赖治理与 STORAGE 整体仍 partial。确认包为 [DEP-2B-BRACES-DEPTH-20261003](../../docs/development/high-risk-confirmation-packets.md#dep-2b-braces-局部深度保护确认包dep-2a-准备待确认未实施)。
- 当前完整锁图与安装解析只有 Web dev → eslint-config-next 16.3.6 → Next plugin 16.3.6 → fast-glob 3.3.1 → micromatch 4.0.8 → braces 3.0.3；唯一真实 globSync 调用为 plugin get-root-dirs，语义和源码行号见确认包。13:56–14:10 官方来源仍无已发布 braces 修复，PR72 open/unmerged；已发布 stable 消费者升级仍保留链。
- 推荐五文件深度保护的 PR72 安全子集回移，保留包名/3.0.3 版本，不新增依赖或包管理 hook。草案 hash `97e90c15ea31c7bac144a42e20c8ce68e98a75d8042a3c6d9a8ce1b4f05d1141`；[未应用 diff](../../output/dependency-audit/dep-2a/braces-3.0.3-depth-guard.patch)。tinyglobby/brace-expansion 直接替换已有真实语义差异，未作为等价解法批准。
- **A/B 分开**：草案只待验证递归深度风险缓解；保留 braces@3.0.3 时 all 仍预期 high/退出 1，B 门禁继续阻断，不接受例外。DEP-1 旧审计 all 1 high、prod 全零不升级为本阶段新图审计。本推荐不是全量门禁解法；若 DEP-2B 必须同时达成 B，需要真实修复发布或独立扩大兼容替换范围。
- 当前 HEAD `ddf690de7e030b103b36be3d9359ffc32ecaf6bd`，输入 hash `75397d8b4490129710668a9bde00f2f104b399a0d63b55d6071472892345a376`。来源、固定旧行为观察、文档/静态验证、独立复核与保护证明均在 [DEP-2A 证据](../../output/dependency-audit/dep-2a/)；未修改依赖输入、安装包、生成目录或索引，前序未提交成果保留。未安装/应用补丁、运行修补后代码、DB/容器/测试池、Git 交付、发布或关闭 residual。到此停止实施接力，等待新批准。


### DEP-2B 局部深度保护执行记录（2026-10-03）

- 用户已批准精确 `DEP-2B-BRACES-DEPTH-20261003`；分支/HEAD/输入及草案绑定匹配，前序 STORAGE 与 DEP-1 成果保留，未暂存或提交。
- **partial：A 阻塞，B FAIL。** 精确补丁与注册已写入，lock 仅三项 patch 身份变化；冻结安装退出 0，但 Next ESLint 消费链实际加载的五文件仍为原包。专项身份断言退出 1，深度边界、直接 AST、补丁后兼容与超限错误传播未验证，不宣称局部保护已生效。
- 旧包 58 组固定普通行为/真实 ESLint 基线通过；新鲜 audit:all 为唯一 braces high、退出 1，prod 全零、退出 0。没有接受漏洞例外，依赖治理与 STORAGE 整体仍 partial，既有 STORAGE 运行态证据未因本批而升级。
- 详情、输入 hash、限制与回退见 [确认包执行回执](../../docs/development/high-risk-confirmation-packets.md#dep-2b-本地执行回执2026-10-03)，命令和独立只读复核见 [验证汇总](../../output/dependency-audit/dep-2b/execution/validation-results.json)。本路径停止；后续须先解决精确补丁实际应用问题，再独立重验 A/B，不自动进入兼容替换、交付或上游等待。

- 最终独立只读复核确认阻塞及前序保护；另发现 `expand → stringify` 的 invalid/dollar fallback 重新计深，整体 199 层可能通过分段上限（静态推论，未运行）。当前 AST 矩阵未覆盖，后续须修订统一深度预算并补测试、重新绑定草案批准；不能只修复安装便认定 A 通过。

### DEP-2C-1 安装归因与下一包（2026-10-03）

- **归因/方案准备 partial；当前依赖治理与 STORAGE 仍 partial，A 未通过、B 阻断。** [报告](../../output/dependency-audit/dep-2c-1/report.md) 区分登记、实际文件、真实加载三层证据：当前五原像未变，两组临时 fixture 证明同字节 patch 可由既有 pnpm11.7.0 正常应用。
- 首次遗漏定位到增量根裁剪的高置信静态机制，历史进程轨迹仍缺；force 重放快捷返回及 rebuild 无补丁应用证据均已说明。保留前序失败记录、13 输入、安装树、生成物与空索引。
- DEP-2C-2 先修订 expand→stringify 的共享深度预算与身份门禁，再绑定新 hash、测试输出和当前安装树受控重建批准。关闭 optimistic 快速返回、force/side-effects-cache 选项与完整五后像校验见报告；本阶段不重装、不清缓存、不替换工具、不执行深度测试。临时两个 fixture 保留，不代表当前项目或 B 已修复。

独立复核发现：DEP-2C-1 已有两组临时复现未被初始盘点识别，本轮又新增两组；三份旧同名日志和一个旧证明脚本被覆盖，旧字节尚未恢复。全部四组资源保留，已停止安装与清理；详见 [范围偏差](../../output/dependency-audit/dep-2c-1/scope-deviation.json)。前述历史保护仅覆盖 DEP-2C-1 之外的证据；当前依赖输入、安装树、生成物、索引及 DEP-2B 历史未变，不能声称所有本阶段证据完整或遵守两组上限。


### DEP-2C-2 统一深度预算草案与下一确认包（2026-10-03）

本轮仅完成**未应用草案与待确认包准备**；未安装、应用、rebuild或运行深度测试，当前项目五文件仍为原像，A未通过、B继续阻断。DEP-2C-1保持partial，四个旧fixture保留，三份旧日志和一个证明脚本的遗失字节未恢复；不改历史事实。

- 五文件候选采用操作内总深度，覆盖expand invalid/dollar、range-empty和parse range-comma三处stringify委派；默认/硬上限100，有限小数取整、负数收紧到0，零剩余预算不回退。保留3.0.3 escapeInvalid parent与可见选项语义。199层仍为静态案例。
- [独立运行登记](../../output/dependency-audit/dep-2c-2/run-20261003-01/registration.json)、[设计与委派清单](../../output/dependency-audit/dep-2c-2/run-20261003-01/sealed/design.md)、[候选及工具绑定](../../output/dependency-audit/dep-2c-2/run-20261003-01/sealed/artifact-binding.json)。新patch SHA-256为`e9464ba5ace7e12c490eab62d6f7e12eefd54055bea3bb1ed6bade14233ef3df`；原/后像、未应用专项diff均在同一sealed目录。
- 15个hunk精确匹配、6份JavaScript语法检查、80396条独立有界整数路径模型通过；三项独立只读复核发现的问题已在草案中修订并复核。它们不证明补丁运行或安装生效，运行态/Node24/Linux仍未验证。文档门禁和前后保护以同目录最终记录为准。
- 下一包 [DEP-2C-3-UNIFIED-DEPTH-20261003](../../output/dependency-audit/dep-2c-2/run-20261003-01/sealed/next-confirmation.md) **待确认、未实施**，绑定当前HEAD/13输入、工具身份、新patch/五后像/专项diff；列明全workspace force写集、禁optimistic、原生恢复、生成物、排他证据与局部回退。没有复用旧批准，不接受漏洞例外，不改audit策略，不授权Git交付、数据库、容器或生产。DEP-2C-2到准备结束即停止。
