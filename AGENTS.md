# AreaForge Agent Guide

## 定位

- 本仓库是 AreaForge：面向个人长期备考的自我锻造与考研督战系统。
- 当前阶段优先实现私有 Web 应用，后续预留 PWA、桌面端和移动端。
- 对话、说明、提交说明、设计说明默认使用中文；代码标识符、类型名、文件名中的技术标识保持英文。

## 当前状态

- 仓库与生产均已切到签名 Release `v0.1.9`（commit `749692ba719d801f14186a94af97b96350380141`）；远端 `https://forge.areasong.top/` 公网 health 报告 `0.1.9`。G5 受控更新于 2026-07-21T05:08:11Z 完成（备份 hash 已入 redacted export；回滚目标仍为 `v0.1.7` 不可变 digest）。`v0.1.8` 计划保持搁置并由 `workflow/versions/v0.1.9-long-term-operations-release.md` 承接。2026-07-21 Phase B 后续关账已将 `AF-RISK-OPS-005/006/007/008` 记为 `closed-evidence`（mismatch 证据、doctor 时间序 + write-smoke、附件 recon、hold/barrier/clear）；`OPS-002` / `OPS-003` / `REL-001` 仍保持未关。dirty multi-residual worktree 下 OPS-005/006 的 human-review preflight 仍可能 `needs_signed_release` / blocked，不推翻已通过的 `evidence:validate`。
- 下一产品主线：学习行动中心（`workflow/versions/v1.1-learning-action-center.md`），隔离分支 `codex/v1.1-learning-action-center`；S0–S2 与 Batch 3–5（Migration 1–5 / workspace-inbox / 学习树 preview+confirm / StudyResource）已落地；Batch 6 与 S4–S5 已拆任务、业务代码未实施；`AF-RISK-DATA-001` 生命周期已接受、residual 保持 deferred-work 未关。阶段索引见 `docs/development/v11-phase-packages.md`。
- Package A-E 和 docs 100% 当前证据已闭环，证据见 `docs/development/docs-100-completion-record.md`。学习行动中心规划能力不计入该完成声明。
- 自动更新采用 Web 版本中心受控请求和服务器侧 root update-agent/updater；当前 `AREAFORGE_AUTO_APPLY=none`，不会静默自动更新。
- Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令。
- 只读 `ops:data-integrity:doctor` 已用于发现重复活跃计时、task/session 状态矛盾和附件 reconciliation 缺口；它不修复数据。`AF-RISK-OPS-006` 的 partial unique index、task/session CAS、结束计时单次副作用和 CheckIn 锁已在生产 migration、controlled probe、before/after doctor 与 smoke 账号 write-smoke 中验证，并随 Phase B 关账记为 `closed-evidence`。

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

- 先读方案、上下文和最近的局部 `AGENTS.md`，再改代码。
- 涉及企业治理、发布、真实体验、文档同步、生产运维、观测、事故响应、安全、供应链、残余风险、AI 或验证选择时，优先使用 `.codex/skills-src/` 中对应的 AreaForge repo-local skill。
- 涉及公开 issue、支持入口、贡献者 PR、公开安全披露或维护者 triage 时，优先使用 `.codex/skills-src/areaforge-public-maintenance`，再按风险面交给安全、SRE、Release、供应链或体验 owner skill。
- 跨多个治理面推进时，先用 `.codex/skills-src/areaforge-operating-loop` 做任务分级、owner skill 路由、验证选择和收尾证据整理。
- `.codex/skills-src/**` 是 Codex 工作流说明，不是产品源事实；产品和工程事实仍以 `docs/**`、`tasks/**`、`workflow/**`、`ops/**`、`README.md` 和本文件为准。
- 开发前协作流程遵循 `docs/development/codex-workflow.md`。
- 文档或入口变更后，按 `docs/development/doc-sync-checklist.md` 检查漂移。
- 验证选择遵循 `docs/development/validation-matrix.md`。
- 依赖、GitHub Actions、Docker base image、PR 模板、安全政策或公开仓库治理变更，遵循 `docs/development/dependency-policy.md` 并运行 `pnpm governance:preflight`。
- 外部能力、自动化、MCP、subagent、浏览器控制、部署插件或远程运维工具的准入与扩大，遵循 `docs/development/external-capability-admission.md`；它们不得绕过 Web runtime 服务器命令禁区或生产高风险确认。
- 发布、生产运维或长期运营状态变化，更新 `docs/development/operational-readiness.md`、`docs/development/residual-risk-ledger.md` 的相关入口，并运行 `pnpm ops:readiness`；进入 release/update/交接证据时先看 `pnpm ops:handoff`，再补跑 `pnpm ops:evidence:bundle` 和 `pnpm ops:alert:preview`。
- 第一版围绕“计划任务 -> 专注计时 -> 关联大纲 -> 产出笔记/错题 -> 晚间复盘 -> AI 鞭策 -> 明日调整”闭环。
- `packages/core` 放平台无关业务规则，不依赖 Next.js、React、Prisma、浏览器 API 或环境变量。
- `packages/db` 集中数据库访问；页面和组件不直接调用 Prisma。
- `packages/ai` 只生成建议或草稿，不直接覆盖用户记录。
- 上传文件不放入 `public/`，必须通过鉴权接口访问。
- PostgreSQL 是主状态源事实；上传目录保存文件本体，数据库只保存 metadata、hash 和 URI。

## 高风险边界

命中以下任一项时，先说明影响、风险、验证与回滚思路，再等待确认：

- 数据库 migration、数据修复、批量删除、清空记录。
- 删除附件、移动上传目录、修改备份/恢复策略。
- 认证、会话、权限、密钥、AI 调用隐私边界。
- 网页内直接触发部署、执行服务器命令或一键更新；允许的版本中心只能提交受控请求，由服务器侧 root update-agent/updater 执行签名校验、备份、migration、切换和回滚。
- 将动机档案、情绪记录、复盘正文发送给 AI 的默认策略变化。

文件上传、附件访问、AI 调用和备份恢复的细化安全边界见 `docs/security/file-ai-safety.md`。

## 验证要求

- 常规代码改动：运行 `pnpm check`，若耗时或环境不允许，至少运行相关 `typecheck`、`lint`、`db:validate`、`build`。
- `packages/core` 规则改动：补充或运行对应单元测试。
- UI 改动：能启动时用浏览器或截图检查主要页面状态。
- Prisma schema 改动：运行 `pnpm db:validate`。
