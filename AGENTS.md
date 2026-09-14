# AreaForge Agent Guide

## 定位

- 本仓库是 AreaForge：面向个人长期备考的自我锻造与考研督战系统。
- 当前阶段优先实现私有 Web 应用，后续预留 PWA、桌面端和移动端。
- 对话、说明、提交说明、设计说明默认使用中文；代码标识符、类型名、文件名中的技术标识保持英文。

## 当前状态

- 最新稳定 GitHub Release 为 `v1.2.0`（commit `018cdfaa7a58cea2b32a33acaa0b968f29b9e09a`）；Release 于 2026-09-01 发布，workflow run `33521890241` 成功，manifest、SBOM、provenance、checksum、签名资产与不可变镜像 digest 已严格验证。`v1.2.0` 是 annotated tag，tag 本身没有 GPG signature，不能写成“签名 tag”。
- 当前默认分支的 workspace package version 已统一为 `1.2.0`；PR #49 已于 2026-09-01 经 CI run `33505174259` 成功后 squash 合并到 `main`，其后 main push CI run `33506280124` 也已成功。`v1.2.0` tag、GitHub Release 和 GHCR 镜像已创建；生产 apply 尚未执行。
- 已归档的生产交付/回滚记录基线为 `v1.1.1`（commit `f995310e30c41270ee1e0a1c1ceeae9b6a8017eb`），对应 2026-08-01 受控 production apply。2026-09-14 `05:39:05Z` 公网 health 的新鲜只读观测已报告 `v1.2.0` / `018cdfaa7a58cea2b32a33acaa0b968f29b9e09a` / verified；这不是本批执行的更新。缺少本次版本对应的服务器 migration、备份、agent、smoke 和回滚证据，完整生产交付仍待核验，不能把 health 观测当作 production apply 闭环。
- A -> B 当前进度：v1.3 动态个人版已由 PR #56 合并 `main` commit `40f1b36780418bbd544aaaadcd29c385aa2154e8`，尚缺独立 Release/production disposition；v1.4 AUTH、v1.5 RBAC/隐私授权/Coach、v1.6 数据任务/删除预览、v1.7 受控运维请求、v1.8 私有挑战/排名投影以及 v1.9 纯规则/持久排名通知基础，已由 PR #57 在两套 `verify` 成功后 squash 合并到 `main` commit `b04ba988ec32c1f6172ade06605b0cc1ce39788c`。当前后续分支正补独立通知入口和动态运行态；排名重建、持久搜索索引、配额执行、MFA/观测等剩余 runtime 尚未完成。所有候选 migration 均未 apply 到共享测试库或生产，仍缺新 Release、production apply 和对应运营证据；v2.0 综合门禁尚未完成。
- 当前主线仍是学习行动中心（`workflow/versions/v1.1-learning-action-center.md`）；开始学习、今日、知识、检验、路线构成五个一级业务入口，设置位于侧栏底部工具区，确认中心作为共享工作流入口。`/focus` 是独立一级入口，知识点是可跨阶段/考纲/检验复用的核心对象，报告、阶段建议、模拟考试、专项复测和 AI 草稿统一进入确认中心。当前只保留一套 canonical 路由，旧 `/plan/*`、`/review/*`、`/quick-review/*`、计时详情、重复设置路径、`/today/*`、`/stage/*` 和根级旧业务页面已移除，不再提供兼容重定向。本地优先计时在真实 session 同步后才进入证据接力。发布与 production apply 状态仍以本文件前述稳定基线和对应 evidence 文档为准。阶段索引见 `docs/development/v11-phase-packages.md`。
- Package A-E 和 docs 100% 当前证据已闭环，证据见 `docs/development/docs-100-completion-record.md`。学习行动中心规划能力不计入该完成声明。
- 自动更新采用 Web 版本中心受控请求和服务器侧 root update-agent/updater；当前 `AREAFORGE_AUTO_APPLY=none`，不会静默自动更新。
- Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令。
- 只读 `ops:data-integrity:doctor` 已用于发现重复活跃计时、task/session 状态矛盾和附件 reconciliation 缺口；它不修复数据。`AF-RISK-OPS-006` 的 partial unique index、task/session CAS、结束计时单次副作用和 CheckIn 锁已在生产 migration、controlled probe、before/after doctor 与 smoke 账号 write-smoke 中验证，并随 Phase B 关账记为 `closed-evidence`。

- v2.0 持久 worker 的内核、排名通知和独立 DATA-EXPORT 已形成本地隔离实现：51 条 migration 的专用导出合成库通过 15/11/14 组内核/通知/导出运行态；EXPORT 包含本人记录/READY 附件私有 ZIP、一次性 POST 下载、精确副本回收和四个进程强杀点，桌面/390px/320px 浏览器/API 验收通过。详见 `tasks/backlog/0041-data-lifecycle.md` 与 `0045-platform-hardening.md`。DELETE 与 OPS 另有独立本地验收；排名重建、共享/生产 migration、Release 和 v2.0 综合门禁仍未完成，所有新增开关默认关闭。

DATA-DELETE 已在独立本地批准下完成持久回收站/冻结、独立删除执行器和最小账本；53-migration 专用合成库通过 17 组运行态（含五个强杀点、真实权限变化、五类对象、并发/死信和备份快照竞争），真实 API 与桌面/390px/320px 浏览器验收通过。知识画布原生查询已接入冻结过滤，恢复重放以可信账本水位而非时间筛选。详见 `tasks/backlog/0041-data-lifecycle.md`；整体 v2.0 仍 partial，稳定 Release、生产与 residual 状态未由本地验收改变。

OPS 已在独立本地批准下实现冻结绑定、root-owned 桥接登记/文件、跨进程锁、不可覆盖日志、停止屏障和回执恢复；38 组合成运行态及真实 API/桌面/390px/320px 浏览器验收通过。仅部署既有 53 条 migration 到新 OPS 合成库，未新增 DDL；测试池只更新专属槽 3，槽 1/2 和既有数据库/卷保留。新入口默认关闭，生产适配器未运行；最终门禁和 Git/CI 交付见 `tasks/backlog/0042-controlled-operations-center.md`，不代表 Release、生产或 v2.0 综合门禁完成。

## 源事实

- 产品定位与功能边界：`docs/product/**`。
- 使用指南、配置参考与 FAQ：`docs/guide/**`；人类可读版本历史：`CHANGELOG.md`。
- 工程结构与分层：`docs/architecture/**`。
- 业务模块设计：`docs/modules/**`。
- 页面状态与交互：`docs/ux/**`。
- 开发顺序与验证门禁：`docs/development/**`。
- 部署、备份与恢复：`docs/deployment/**`。
- 安全边界与威胁模型：`docs/security/**`。
- 技术决策：`docs/adr/**`。
- 轻量任务拆分：`tasks/**`；为空或冲突时，以 `docs/development/implementation-order.md` 为准。
- 版本规划：`workflow/**`；为空或冲突时，以 `docs/product/roadmap.md` 为准。

## Skill 快速路由（抗上下文压缩）

| 任务场景 | Owner skill | 边界提示 |
|---|---|---|
| 跨多治理面 / 不确定归属 | `areaforge-operating-loop` | 单一面任务直接用对应 owner |
| 发布、tag、GitHub Release、updater 请求 | `areaforge-release-operator` | 制品信任给 supply-chain；本地 commit 给 git-checkpoint |
| 制品/依赖/签名/digest 信任验证 | `areaforge-supply-chain` | 发布执行给 release-operator |
| 本地 stage/commit/push 检查点 | `areaforge-git-checkpoint` | tag/Release 属发布动作 |
| 生产写操作（备份/恢复/updater apply/回滚） | `areaforge-sre-ops` | 只读信号给 observability |
| 只读生产信号与证据 | `areaforge-observability` | 写动作给 sre-ops；事故编排给 incident-response |
| 事故分级、止血、回滚决策、复盘 | `areaforge-incident-response` | 执行给 sre-ops；信号给 observability |
| 安全边界、鉴权、密钥、AI 隐私、数据生命周期协调 | `areaforge-security-governance` | 文件细节给 file-storage-safety；AI 细节给 ai-governance |
| 附件/上传/对账/存储迁移细节 | `areaforge-file-storage-safety` | 高风险边界审查给 security-governance |
| AI provider、fallback、成本、token | `areaforge-ai-governance` | 隐私生命周期归口给 security-governance |
| CI、依赖准入、仓库政策 | `areaforge-enterprise-governance` | 具体域细节交给对应 owner |
| 公开 issue、支持入口、贡献者 PR | `areaforge-public-maintenance` | 各风险面交给对应 owner |
| 浏览器/API smoke 与体验证据 | `areaforge-qa-smoke` | 产品设计判断给 product-experience |
| 产品体验设计与打磨判断 | `areaforge-product-experience` | 验证证据给 qa-smoke |
| 文档/任务/工作流状态同步 | `areaforge-doc-sync` | 验证命令选择给 validation-driver |
| 残余风险分类与关闭条件 | `areaforge-residual-ledger` | 状态同步给 doc-sync |
| 选择最小充分验证集 | `areaforge-validation-driver` | 失败语义归还 surface owner |

同会话新任务须重新匹配本表；完整交接边界见 `.codex/skills-src/README.md` 的 Owner 边界表。

## 工作原则

- 从仓库根到目标路径逐层检查适用的 `AGENTS.md`，按任务范围读取相关源事实后再改代码；局部技术规则可细化实现，但不得放宽根安全和批准边界。skill 的条件阅读与完成规则归口 `docs/development/codex-workflow.md`。
- 更近目录的 `AGENTS.md` 只在其目录范围内细化或收紧全局规则；若涉及系统/平台硬门禁或高风险授权，仍取更严格规则。
- 小任务可直接执行；目标明确且可逆的多文件改动可先给简明计划并继续执行；只有未决选择会改变范围、权限、数据、外部副作用或验收标准时才等待确认。轻微歧义采用最小可逆假设并在收尾说明。
- 不把流程负担甩给用户；该我主动检查、主动验证、主动汇报的，直接执行并说明结果。
- Skill 或插件不得扩大用户请求的范围；本地脚手架可在明确请求内推进，但全局配置、系统安装、外部发布、凭据/权限变化、删除/替换和远端写入必须按当前环境的授权边界处理。
- 涉及企业治理、发布、真实体验、文档同步、生产运维、观测、事故响应、安全、供应链、残余风险、AI 或验证选择时，优先使用 `.codex/skills-src/` 中对应的 AreaForge repo-local skill。
- 涉及公开 issue、支持入口、贡献者 PR、公开安全披露或维护者 triage 时，优先使用 `.codex/skills-src/areaforge-public-maintenance`，再按风险面交给安全、SRE、Release、供应链或体验 owner skill。
- 跨多个治理面推进时，先用 `.codex/skills-src/areaforge-operating-loop` 做任务分级、owner skill 路由、验证选择和收尾证据整理。
- `.codex/skills-src/**` 是 Codex 工作流说明，不是产品源事实；产品和工程事实仍以 `docs/**`、`tasks/**`、`workflow/**`、`ops/**`、`README.md` 和本文件为准。
- 开发前协作流程遵循 `docs/development/codex-workflow.md`。
- 文档或入口变更后，按 `docs/development/doc-sync-checklist.md` 检查漂移。
- 验证选择遵循 `docs/development/validation-matrix.md`。
- 依赖、GitHub Actions、Docker base image、PR 模板、安全政策或公开仓库治理变更，遵循 `docs/development/dependency-policy.md` 并运行 `pnpm governance:preflight`。
- 新增或扩大外部能力、自动化、MCP、subagent、浏览器控制、部署插件或远程运维工具时，遵循 `docs/development/external-capability-admission.md`；已准入且在当前请求范围内的只读调用无需重复准入，worker 写集仍须有明确委派边界，不因准入自动扩大。既有精确生产只读确认包仅在原动作、目标、版本/资源和次数限制内有效，不得绕过 Web runtime 服务器命令禁区或生产高风险确认；历史已执行记录不构成新任务授权。
- Skill 的默认发布、部署、持久化、清理和验证步骤都是条件性流程：只有用户请求且当前环境允许时执行外部写入；无法完成必需验证时报告 partial/blocked，不把构建或计划成功写成运行态成功。
- 本地容器化 UI 验证统一使用 `areaforge-dev-test` 测试池：普通迭代执行 `pnpm dev:test:refresh` 复用最新槽位，只有明确需要保留旧版本比较时才执行 `pnpm dev:test:snapshot`；最多保留三个 Web 实例，不得绕过测试池创建递增命名的长期残留容器。
- 浏览器/Playwright 验收必须复用 `pnpm dev:test:latest -- --json` 返回的 URL；不得为每个对话、每个页面或每次截图另起 `areaforge-v11browser-runtime-*` 容器。若某个验收工具确实创建一次性 runtime 容器，必须在该次验收结束时删除，不能把它当作测试池实例或长期运行服务。
- 测试池收尾按 `docs/development/codex-workflow.md` 执行：本地 UI/浏览器验收、测试池操作或本地测试 URL 查询在范围内时，Docker 可用则运行 `pnpm dev:test:latest -- --json`；实际 `refresh`/`snapshot` 后报告机器返回的槽位、端口和 URL。未更新时标为既有实例；只有 source fingerprint 与当前 scope 匹配时才可作为当前环境证据，不能称为本任务更新后的 latest。fingerprint 不匹配或不可核验时报告未核验。纯文档、只读审阅、非 Web 任务标为不适用，不为收尾启动 Docker 或刷新测试池。
- 实际发布、生产运维、长期运营状态或其证据发生变化时，同步 `docs/development/operational-readiness.md`、`docs/development/residual-risk-ledger.md` 的受影响入口，并按验证矩阵运行 `pnpm ops:readiness`；release/update/运维交接证据需要 `pnpm ops:handoff`、`pnpm ops:evidence:bundle` 和 `pnpm ops:alert:preview`。单纯审阅这些规则或修正文案不表示生产状态变化。
- 当前学习闭环围绕“开始学习（选科目） -> 专注计时 -> 收口 -> 证据/复测 -> 今日闭环 -> 周期报告与阶段调整”展开；任务和考纲是可选上下文，学习是否真正学进去才是主要结果。
- `packages/core` 放平台无关业务规则，不依赖 Next.js、React、Prisma、浏览器 API 或环境变量。
- `packages/db` 集中数据库访问；页面和组件不直接调用 Prisma。
- `packages/ai` 只生成建议或草稿，不直接覆盖用户记录。
- 上传文件不放入 `public/`，必须通过鉴权接口访问。
- PostgreSQL 是主状态源事实；上传目录保存文件本体，数据库只保存 metadata、hash 和 URI。

## 高风险边界

拟执行以下高风险边界变更、受控状态写入或外部写入时，先说明影响、风险、验证与回滚思路，再等待明确确认。仅触及相关文件但不改变边界的设计、测试、文档、静态检查和无真实状态写入的 mock 可先行；等待只阻止受限动作，其他已授权且独立的安全工作继续。上述准备工作不授权 migration、真实数据写入、Provider 外呼或生产操作。

- 数据库 migration、数据修复、批量删除、清空记录。
- 删除附件、移动上传目录、修改备份/恢复策略。
- 认证、会话、授权、租户隔离、权限模型、密钥生命周期、加密和 AI 调用隐私边界。
- 数据导出、留存、删除权、用户迁移，以及 AI history、token/cost ledger 或 provider trace 留存边界。
- 跨服务写一致性、Saga、Outbox、补偿逻辑，以及支付、计费、配额和计量。
- 破坏性操作或风险等级无法快速判断的变更。
- 网页内直接触发部署、执行服务器命令或一键更新；允许的版本中心只能提交受控请求，由服务器侧 root update-agent/updater 执行签名校验、备份、migration、切换和回滚。
- 将动机档案、情绪记录、复盘正文发送给 AI 的默认策略变化。
- 确认包明确要求独立批准的 rollout、controlled probe、Release 或 residual closure。

确认范围和跨 skill 复用以 `docs/development/high-risk-confirmation-packets.md` 为准：同一有效确认可在精确 action、target、scope、version/resource 和有效期内跨 handoff 复用；一次性确认消费后不可再次执行，独立确认包不得交叉复用。确认未覆盖新动作、目标/版本变化、风险实质增加、前置证据失效或明确失效时重新确认。文件上传、附件访问、AI 调用和备份恢复的细化安全边界见 `docs/security/file-ai-safety.md`。

## 验证要求

- 验证命令以 `docs/development/validation-matrix.md` 的改动路径和风险 profile 为准，最终文档/metadata 同步后执行。常规代码运行 `pnpm check`；环境阻塞时先运行可执行的相关检查并报告缺口，不以“耗时”豁免高风险或 Release 必需门禁。
- `packages/core` 规则改动：补充或运行对应单元测试。
- UI 改动：验证实际受影响页面、交互和失败状态；布局变化包含桌面/窄视口。无法启动时明确缺失体验证据，不宣称体验已验证。
- Prisma schema 改动：运行 `pnpm db:validate`。
- 完成状态按 `docs/development/completion-evidence-checklist.md` 区分 complete、partial、blocked 和不适用；审阅以文件/行号证据完成审阅交付，不自动修改文件或声称修复。
