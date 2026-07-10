# AreaForge

AreaForge 是一个面向个人长期备考的自我锻造与考研督战系统。

当前目标形态是私有 Web 应用：用任务、专注计时、考纲进度、笔记资料、复盘、统计、AI 鞭策、阶段调整和发布运维闭环，形成每天可执行、长期可校准、生产可回滚的学习系统。

## 当前状态

- 当前版本：`0.1.5`。
- 线上地址：`https://forge.areasong.top/`。
- 线上健康检查：`GET https://forge.areasong.top/api/health` 返回 AreaForge `0.1.5`。
- docs 100% 当前证据已闭环：Package A 附件、Package B Batch 0-6 结构化学习状态、Package C 真实 AI Provider 第一版、Package D Batch D1-D5 长期闭环、Package E Batch E1-E4 生产发布/备份/恢复/回滚均已完成。
- GitHub Release `v0.1.5` 已完成签名发布，服务器通过 cosign bundle、hash、镜像 digest、一次性 migration image 和 health smoke 完成更新。
- 自动更新采用受控请求流：Web 版本中心只提交检查、应用、回退或策略请求，服务器侧 `areaforge-update-agent.timer` / updater 以 root agent 身份执行签名校验、备份、migration、切换和回滚；当前 `AREAFORGE_AUTO_APPLY=none`，不会静默自动更新。
- 2026-07-10 本地真实体验复核已覆盖 desktop/mobile、核心学习旅程、未授权状态和版本中心，记录见 `docs/development/product-experience-review-20260710-local.md`；后续 release/update 或体验改动仍需重跑体验复核。

详细证据见：

- `docs/development/docs-100-completion-record.md`
- `docs/development/package-e-remote-github-release-record.md`
- `docs/deployment/github-release-updater.md`

## 技术栈

- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Docker Compose
- Sub2API / OpenAI 兼容 AI 接口

## 本地开发

```bash
pnpm install
docker compose up -d postgres
pnpm db:generate
pnpm dev
```

Web 应用默认位于 `apps/web`。

默认开发数据库连接为 `postgresql://areaforge:areaforge@127.0.0.1:54329/areaforge`，与 `.env.example`、根脚本和本地 `docker-compose.yml` 保持一致。

## 常用命令

```bash
pnpm typecheck
pnpm lint
pnpm db:validate
pnpm build
pnpm check
pnpm docs:readiness
pnpm docs:completion
pnpm risk:preflight
pnpm audit:prod
pnpm github-release-updater:preflight
pnpm governance:preflight
pnpm ops:readiness
pnpm ops:readiness:summary
pnpm ops:evidence:bundle
pnpm ops:alert:preview
pnpm maintenance:cadence:preflight
pnpm operator:onboarding:preflight
pnpm support:intake:preflight
pnpm alert:drill:validate
pnpm smoke:prod-readonly:validate
pnpm smoke:prod-readonly:record
pnpm experience:review:validate
pnpm residuals:review-due
pnpm release:supply-chain:validate
pnpm skills:validate
pnpm smoke:prod-readonly
pnpm release:train:preflight
```

## 长期运营 Skills

AreaForge 已新增 repo-local Codex skills，用于把项目从“能运行”推进到“可长期运营”。源目录为 `.codex/skills-src/`，自动发现入口为 `.agents/skills/`。

- Release：`.codex/skills-src/areaforge-release-operator`
- Operating Loop：`.codex/skills-src/areaforge-operating-loop`
- Public Maintenance：`.codex/skills-src/areaforge-public-maintenance`
- QA Smoke：`.codex/skills-src/areaforge-qa-smoke`
- Docs Sync：`.codex/skills-src/areaforge-doc-sync`
- Git Checkpoint：`.codex/skills-src/areaforge-git-checkpoint`
- SRE Ops：`.codex/skills-src/areaforge-sre-ops`
- Security Governance：`.codex/skills-src/areaforge-security-governance`
- File Storage Safety：`.codex/skills-src/areaforge-file-storage-safety`
- Product Experience：`.codex/skills-src/areaforge-product-experience`
- AI Governance：`.codex/skills-src/areaforge-ai-governance`
- Validation Driver：`.codex/skills-src/areaforge-validation-driver`
- Enterprise Governance：`.codex/skills-src/areaforge-enterprise-governance`
- Observability：`.codex/skills-src/areaforge-observability`
- Incident Response：`.codex/skills-src/areaforge-incident-response`
- Supply Chain：`.codex/skills-src/areaforge-supply-chain`
- Residual Ledger：`.codex/skills-src/areaforge-residual-ledger`

## 文档入口

- 文档总览与源事实入口：`docs/README.md`
- 产品入口：`docs/product/charter.md`
- PRD：`docs/product/prd.md`
- 功能范围：`docs/product/feature-scope.md`
- 路线图：`docs/product/roadmap.md`
- 架构总览：`docs/architecture/overview.md`
- 工程结构：`docs/architecture/project-structure.md`
- 模块设计：`docs/modules/**`
- UX 状态：`docs/ux/**`
- 开发顺序：`docs/development/implementation-order.md`
- 开发前闭环：`docs/development/pre-code-closure.md`
- 协作工作流：`docs/development/codex-workflow.md`
- Release train：`docs/development/release-train.md`
- 完成声明证据清单：`docs/development/completion-evidence-checklist.md`
- 运行时写边界矩阵：`docs/development/runtime-write-boundary.md`
- 依赖治理：`docs/development/dependency-policy.md`
- 维护节奏：`docs/development/maintenance-cadence.md`
- 长期运营 readiness：`docs/development/operational-readiness.md`
- 残余风险台账：`docs/development/residual-risk-ledger.md`
- 验证矩阵：`docs/development/validation-matrix.md`
- 自托管操作者上手：`docs/deployment/operator-onboarding.md`
- 部署与备份：`docs/deployment/**`
- 安全模型：`docs/security/threat-model.md`
- 文件与 AI 安全：`docs/security/file-ai-safety.md`
- 安全披露：`SECURITY.md`
- 支持入口：`SUPPORT.md`
- 支持 triage：`docs/development/support-intake.md`
- 代码评审门禁：`CODE_REVIEW.md`
- 技术决策：`docs/adr/**`
- 轻量任务：`tasks/**`
- 版本规划：`workflow/**`

## 发布与更新

后续功能完成后默认走 GitHub Release 路径：

1. 按 `docs/development/release-train.md` 判断是否进入 Release train，并同步 `docs/**`、`tasks/**`、`workflow/**` 和相关入口 README。
2. 运行 `pnpm check`、`pnpm docs:readiness`、`pnpm docs:completion`、`pnpm risk:preflight`、`pnpm audit:prod` 和 `pnpm ops:readiness`，涉及更新器时补跑 `pnpm github-release-updater:preflight` 和 `pnpm shellcheck:updater`。
3. 统一 bump AreaForge workspace 版本，提交干净 commit，创建并推送 `vX.Y.Z` tag。
4. 等待 GitHub Release workflow 先通过 validate job，再生成 Web/migration 镜像、manifest、SBOM、provenance、`SHA256SUMS` 和 `SHA256SUMS.sig`；stable release 缺少 cosign 签名密钥时必须失败。
5. 按 `docs/development/release-record-template.md` 生成版本化发布记录，记录 tag、digest、health、update-agent、回滚目标、`pnpm ops:evidence:bundle` 的 `bundleHash`、`pnpm ops:alert:preview` 的告警预览结论和残余风险。
6. 通过 Web 版本中心提交受控更新请求，或由管理员执行服务器侧 updater。

Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令。
