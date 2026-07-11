# AreaForge

**面向个人长期备考的自我锻造与考研督战系统。**

AreaForge 不是普通打卡软件，也不是单纯的待办清单。它把每天的任务、专注投入、知识证据、复盘和阶段调整串成一条长期学习闭环，让数据持续回答两个问题：今天最该做什么，以及接下来应该如何调整。

[线上版本](https://forge.areasong.top/) · [产品定位](docs/product/charter.md) · [完整文档](docs/README.md) · [自托管指南](docs/deployment/operator-onboarding.md) · [安全披露](SECURITY.md)

![AreaForge 今日作战台](output/playwright/experience-review/desktop-dashboard.png)

## 当前重点

- 产品重点：服务一个人的长期备考闭环，不做通用团队项目管理。
- 功能状态：任务、计时、考纲、笔记附件、错题、复盘、AI 建议、模拟考试、周期报告、阶段草稿和发布/备份/恢复/回滚链路都有实现与验证记录。
- 线上基线：`0.1.5` 已通过签名 GitHub Release `v0.1.5` 更新到 [forge.areasong.top](https://forge.areasong.top/)。
- 当前边界：单管理员私有 Web 应用；AI 只生成建议或草稿，附件走私有鉴权访问，Web runtime 不直接执行服务器命令。
- README 只突出内容重点、当前状态和常用入口；功能追踪、发布证据、验证矩阵和残余风险以 `docs/**` 为准。

## 核心闭环

```text
计划任务 -> 专注计时 -> 关联考纲 -> 留下笔记/错题 -> 晚间复盘 -> AI/规则建议 -> 明日调整 -> 周期报告
```

AreaForge 的重点不是记录得更多，而是让每次学习都留下可复核的结果，并把结果转成下一步行动。AI 只生成建议或草稿，不直接覆盖用户记录，也不自动修改任务或阶段计划。

## 产品内容重点

| 内容重点 | 当前能力 |
|---|---|
| 今日作战 | 双节点倒计时、今日任务、风险等级、连续打卡、任务欠账、阶段称号、恢复模式和行动型鞭策 |
| 执行闭环 | 每日任务与债务流转、专注计时暂停/继续/恢复、结构化结束收口、有效学习判断、晚间复盘 |
| 知识证据 | 考纲进度树、作战地图、掌握条件与证据、复测记录、笔记、私有附件、错题与复习提醒 |
| 长期校准 | 近 7 天统计、长期风险、周审判、月复盘、全真模拟、阶段计划和需确认的调整草稿 |
| AI 协助 | OpenAI-compatible Provider、结构化输出校验、本地规则回退、最小化上下文和显式触发 |
| 私有交付 | 单管理员登录、PostgreSQL 持久化、备份恢复、签名 Release、服务器侧受控更新与回滚 |

第一版与第二阶段文档范围的当前实现状态，统一以 [功能追踪矩阵](docs/development/feature-traceability.md) 为准。

## 当前状态

| 层级 | 当前事实 |
|---|---|
| 线上基线 | `0.1.5`，已通过签名 GitHub Release `v0.1.5` 更新到 [forge.areasong.top](https://forge.areasong.top/)；远端发布记录曾验证 health 返回 `0.1.5` |
| 功能完成度 | 文档定义的第一版必需项与第二阶段增强项当前均有实现和验证证据，附件、结构化学习状态、真实 AI、长期校准、Package E 本机发布/备份/恢复/回滚演练和远端签名 Release 更新证据已闭环 |
| 仓库当前重点 | `v0.1.5` 线上基线之后，后续工作集中在长期运营证据、下一次签名 Release 的 SBOM/provenance，并持续维护支持入口、维护记录与 repo-local Codex skills；这些仓库能力不能自动等同于线上已更新 |
| 更新策略 | `AREAFORGE_AUTO_APPLY=none`；Web 版本中心只提交受控请求，服务器侧 update-agent/updater 执行签名校验、备份、migration、切换、smoke 和回滚 |
| 残余证据 | 当前未完全关闭的是 `AF-RISK-OPS-001` 生产只读 smoke 前置配置、`AF-RISK-SC-001` 下一次签名 Release SBOM/provenance、`AF-RISK-OPS-004` 告警人工复核等长期运营证据，不是主功能缺失 |

状态证据与剩余边界：

- [docs 100% 完成记录](docs/development/docs-100-completion-record.md)
- [`v0.1.5` 远端签名发布记录](docs/development/package-e-remote-github-release-record.md)
- [长期运营控制面](docs/development/long-term-operability-control-plane.md)
- [运营 readiness](docs/development/operational-readiness.md)
- [残余风险台账](docs/development/residual-risk-ledger.md)

## 产品边界

- 当前是单管理员、电脑优先、移动端响应式适配的私有 Web 应用。
- PostgreSQL 是结构化状态的源事实；附件本体保存在私有上传目录，并通过鉴权 API 访问。
- AI 默认不读取动机档案、完整情绪记录、完整复盘正文、附件内容或完整任务标题。
- 报告、债务重排和阶段调整都保留用户确认边界，不静默自动应用。
- Web runtime 不执行 Docker、备份、恢复、migration、回滚或服务器命令。
- 多用户、排名、小程序、原生 App、复杂权限、AI 自动完整计划和复杂 PDF 自动解析仍不在当前范围。

## 技术架构

| 层 | 实现 |
|---|---|
| Web | Next.js、React、TypeScript |
| 业务规则 | `packages/core`，保持平台无关，不依赖 Next.js、React、Prisma、浏览器 API 或环境变量 |
| 数据 | PostgreSQL、Prisma、`packages/db` |
| AI 与文件 | `packages/ai`、`packages/storage` |
| 部署 | Docker Compose、Nginx、GitHub Release、GHCR、服务器侧 updater |

```text
apps/web          私有 Web 应用与 API
packages/core     平台无关业务规则
packages/db       Prisma 与数据库访问
packages/ai       AI 适配、校验与回退
packages/storage  附件安全规则
prisma            数据模型与 migrations
docs              产品、架构、开发、部署和安全源事实
ops / scripts     发布、更新、验证与只读运营工具
```

详细调用方向见 [架构总览](docs/architecture/overview.md) 和 [工程结构](docs/architecture/project-structure.md)。

## 本地开发

建议使用 Node.js 24（当前 CI/Release 基线）、pnpm `11.7.0` 和 Docker Compose。

```bash
pnpm install
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate:dev
```

首次启动前，从 `.env.example` 准备本地 `.env`，并至少完成以下配置：

- 将 `AUTH_SESSION_SECRET` 替换为不少于 32 个字符的本地随机值。
- 设置 `AUTH_ADMIN_EMAIL`，并将密码哈希写入 `AUTH_ADMIN_PASSWORD_HASH`。
- 将 `UPLOAD_DIR` 改为本机可写、位于 `apps/web/public` 之外的绝对路径。
- 将 `APP_VERSION` 与根 `package.json` 的当前版本保持一致。

密码哈希可通过以下命令生成：

```bash
pnpm auth:hash '<local-password>'
```

把输出写回 `.env` 后，再初始化管理员和基础科目并启动应用：

```bash
pnpm db:seed
pnpm dev
```

默认访问地址是 `http://localhost:3000`，默认开发数据库是 `postgresql://areaforge:areaforge@127.0.0.1:54329/areaforge`。完整说明见 [开发设置](docs/development/setup.md)。

## 常用验证入口

| 场景 | 入口 |
|---|---|
| 常规代码改动 | `pnpm check`；需要全包测试时补 `pnpm test` |
| 文档、治理、高风险边界 | `pnpm docs:readiness`、`pnpm docs:completion`、`pnpm risk:preflight`、`pnpm governance:preflight` |
| 发布或更新准备 | `pnpm release:train:preflight`、`pnpm github-release-updater:preflight`，按 [Release train](docs/development/release-train.md) 固定版本、资产、回滚和停止条件 |
| 日常只读运营 | `pnpm ops:handoff --summary`、`pnpm ops:status --summary`、`pnpm ops:readiness`、`pnpm residuals:review-due` |
| 维护与证据收口 | `pnpm maintenance:window:record`、`pnpm ops:evidence:bundle`、`pnpm ops:alert:preview`、`pnpm ops:support:bundle-preview` |
| 长期运营控制面 | `pnpm enterprise:operability:preflight`、`pnpm update-agent:status:record <status.json>`、`pnpm ops:ops-001:preflight`、`pnpm ops:ops-001:blocked:validate <record>`、`pnpm ops:ops-001:closure <smoke> <status> <bundle>`、`pnpm ops:ops-004:preflight` |
| 供应链与体验复核 | `pnpm release:supply-chain:validate <record>`、`pnpm ci:supply-chain:record`、`pnpm sc:sc-002:preflight`、`pnpm experience:review:validate <record>` |

`pnpm ops:long-term:gate` 是“产品可长期运营”完成声明前的严格 live evidence gate。缺少生产 smoke、告警、签名 Release 供应链或新鲜体验证据时，它应当失败；它不是常规本地检查，也不会执行任何生产动作。

不要从 README 猜测专项命令。按改动范围查阅 [验证矩阵](docs/development/validation-matrix.md)，长期运营节奏查阅 [维护节奏](docs/development/maintenance-cadence.md) 和 [长期运营控制面](docs/development/long-term-operability-control-plane.md)。

## 文档地图

| 主题 | 入口 |
|---|---|
| 产品定位、范围与路线 | [产品 Charter](docs/product/charter.md)、[PRD](docs/product/prd.md)、[功能范围](docs/product/feature-scope.md)、[路线图](docs/product/roadmap.md) |
| 架构与数据边界 | [架构总览](docs/architecture/overview.md)、[数据模型](docs/architecture/data-model.md)、[API 边界](docs/architecture/api-surface.md) |
| 模块与页面行为 | [模块文档](docs/modules/)、[UX 文档](docs/ux/)、[品牌素材](docs/ux/brand-assets.md) |
| 实现与完成证据 | [实现顺序](docs/development/implementation-order.md)、[功能追踪矩阵](docs/development/feature-traceability.md)、[完成记录](docs/development/docs-100-completion-record.md) |
| 协作与验证 | [Codex 工作流](docs/development/codex-workflow.md)、[文档同步清单](docs/development/doc-sync-checklist.md)、[验证矩阵](docs/development/validation-matrix.md) |
| 发布与长期运营 | [长期运营控制面](docs/development/long-term-operability-control-plane.md)、[Release train](docs/development/release-train.md)、[运营 readiness](docs/development/operational-readiness.md)、[维护节奏](docs/development/maintenance-cadence.md)、[残余风险台账](docs/development/residual-risk-ledger.md)、[体验复核模板](docs/development/product-experience-review-record-template.md) |
| 自托管与恢复 | [操作者上手](docs/deployment/operator-onboarding.md)、[GitHub Release updater](docs/deployment/github-release-updater.md)、[备份恢复](docs/deployment/backup-restore.md) |
| 安全、支持与评审 | [威胁模型](docs/security/threat-model.md)、[文件与 AI 安全](docs/security/file-ai-safety.md)、[安全披露](SECURITY.md)、[支持入口](SUPPORT.md)、[支持 intake](docs/development/support-intake.md)、[支持包预览](docs/development/support-bundle-preview.md)、[代码评审门禁](CODE_REVIEW.md) |
| 任务与版本 | [轻量任务](tasks/README.md)、[版本规划](workflow/README.md)、[残余风险索引](tasks/indexes/residuals.md) |

README 只负责突出重点和导航，产品规则、架构约束、验证门禁与生产证据仍以对应源文档为准。

## Codex 协作能力

仓库提供 repo-local Codex skills，用于发布、安全、文件存储、AI 治理、体验复核、SRE、供应链、文档同步和残余风险管理。跨多个治理面时由 `areaforge-operating-loop` 编排 owner skill、验证选择和收尾证据。源目录是 `.codex/skills-src/`，自动发现入口是 `.agents/skills/`；完整 owner 边界见 [.codex/skills-src/README.md](.codex/skills-src/README.md)。

## 发布与更新

AreaForge 的生产路径是 Docker Compose + PostgreSQL + Nginx HTTPS + GitHub Release updater，不使用 Web runtime 直接运维服务器。

一次正式更新必须区分三个阶段：

1. 本地与 CI 验证当前 checkout，并按 Release train 固定版本、范围、残余风险和回滚目标。
2. GitHub Release workflow 生成 Web/migration 镜像、manifest、SBOM、provenance、checksum 和签名资产；stable Release 缺少签名条件时必须失败。
3. Web 版本中心提交受控请求，或管理员在服务器执行 updater；服务器侧完成签名校验、备份、migration、切换、smoke 和必要时回滚。

发布完成不等于生产更新完成，生产更新完成也不等于长期运营证据全部关闭。具体流程见 [生产发布 runbook](docs/development/production-release-runbook.md) 和 [GitHub Release updater](docs/deployment/github-release-updater.md)。
