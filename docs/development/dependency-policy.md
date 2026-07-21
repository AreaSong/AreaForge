# Dependency Policy

## 目标

让 AreaForge 的依赖更新可解释、可验证、可回滚，不把公开项目的供应链风险藏在普通功能 PR 里。

## 覆盖范围

- `package.json`、`pnpm-lock.yaml` 和 workspace 包依赖。
- `.github/workflows/**` GitHub Actions。
- `infra/docker/**` Docker base image。
- Release/updater 相关工具链，如 cosign、shellcheck、Prisma migration image。

## 准入规则

- 新依赖必须说明用途、替代方案、运行时暴露面和维护状态。
- 能用现有依赖或标准库解决的，不新增依赖。
- 涉及 auth、uploads、AI、release/updater、backup/restore、migration 的依赖变更，按高风险边界处理。
- 不接受未说明用途的 transitive churn；锁文件变化必须能追溯到明确依赖。
- 不把生产密钥、registry token、cosign 私钥或 smoke 凭据写入依赖配置、CI 日志或 release 记录。
- 学习行动中心规划依赖（画布 `@xyflow/react`，学习树 `unified` / `remark-*` / `yaml` / `mdast-util-to-markdown`）在首次改 lockfile 前必须完成许可证、漏洞、bundle/build-script、telemetry 复核，并运行 `pnpm governance:preflight` 与 `pnpm audit:prod`；不得引入远程内容上传、客户端密钥或服务端 URL 抓取。确认包骨架见 `docs/development/high-risk-confirmation-packets.md`。

## Dependabot

`.github/dependabot.yml` 每周检查：

- npm/pnpm workspace。
- GitHub Actions。
- Docker base image。

Dependabot PR 仍需要普通验证。不能因为来自 Dependabot 就跳过 review、docs 或 release 证据。

## GitHub Actions

- 外部 `uses:` 必须 pin 到 40 位 commit SHA，并用行内注释保留原始主版本，例如 `# v5`，方便 Dependabot 或人工升级时追溯来源。
- 所有 `actions/checkout` 步骤必须设置 `persist-credentials: false`；需要发布 Release 或推送 GHCR 的步骤通过最小 job permission 和显式 action/token 输入完成，不把 Git 凭据留给后续任意 shell 步骤。
- CI 和 Release workflow 都必须运行 `pnpm audit:all`，覆盖运行时与构建/开发工具链的 high/critical 漏洞；`pnpm audit:prod` 保留为生产依赖单独报告。moderate 或 low 结果不阻断发布，但需要在依赖治理或残余风险里评估。
- CI 和 Release workflow 都必须运行 `pnpm secrets:scan`。扫描器固定为 Gitleaks CLI `8.30.1`，下载的 Linux release archive 必须通过官方 SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` 校验；扫描结果只输出 rule ID、仓库相对路径和行号，不输出匹配值、不上传报告、不评论 PR，也不读取 Actions secrets。已核验的历史测试 fixture 误报只能用 `.gitleaksignore` 的单条 fingerprint 放行，禁止按整个文件、目录或规则放行。
- CI 除 pull request 和受控分支 push 外，每周执行一次只读完整门禁，避免仓库长期无提交时漏掉新披露的高危依赖问题。
- `pnpm governance:preflight` 会扫描 `.github/workflows/ci.yml` 和 `.github/workflows/release.yml` 的外部 `uses:`，发现非 SHA pinning 时失败。
- GitHub Actions 升级应同时更新 SHA、行内版本注释、Dependabot/Release 证据和本文件需要的验证结果。

## 更新策略

- patch/minor 依赖更新：优先跑 `pnpm governance:preflight` 和 `pnpm check`；涉及 release/updater 时补跑 `pnpm github-release-updater:preflight`。
- major 依赖更新：必须说明 breaking changes、回滚方式和验证扩大范围。
- 安全更新：优先处理，但仍不能绕过高风险确认边界。
- build script 变化：检查 `pnpm-workspace.yaml` 的 build approval 口径，避免引入未解释的 postinstall 行为。

## 验证

常规依赖变更至少运行：

```bash
pnpm install --frozen-lockfile
pnpm audit:all
pnpm audit:prod
pnpm secrets:scan
pnpm governance:preflight
pnpm check
git diff --check
```

涉及 `pg`、`@prisma/adapter-pg` 或 Prisma 数据库 adapter 的变更，还要在临时库或受控数据库上运行：

```bash
DATABASE_URL=postgresql://... pnpm pg:trace-deprecation
```

该命令在 `NODE_OPTIONS=--trace-deprecation` 下执行 Prisma 查询矩阵，并把 `client.query()` / `already executing a query` / `deprecated` 匹配项作为失败条件。

Release/updater、Docker 或 GitHub Actions 相关依赖还要运行：

```bash
pnpm github-release-updater:preflight
pnpm shellcheck:updater
pnpm ops:readiness
```

## 残余风险

当前 lockfile 通过 workspace `overrides` 将 Next 传递依赖 `postcss` 固定为 `8.5.16`、Prisma dev 工具链的可选传递依赖 `@hono/node-server` 固定为 `1.19.13`、eslint/minimatch 传递依赖 `brace-expansion` 固定为 `1.1.16`，用于修复对应 advisory，同时避免升级 Next/Prisma/eslint 主版本。后续升级上游框架时应优先移除已不再需要的 override，并重新运行 `pnpm audit:all`、`pnpm audit:prod`、`pnpm check` 和 Prisma 验证。

当前 Release workflow 已接入基础 SBOM 与 provenance 生成路径，并把资产纳入 `SHA256SUMS` 和签名覆盖范围。`v0.1.7` 已产生真实签名 Release 的 SBOM/provenance 资产、checksum/signature 校验输出和发布记录证据，并已由服务器侧 updater 应用到生产；残余项 `AF-RISK-SC-001` 仍保持打开，是因为关闭台账需要维护者人工复核，生产 apply 不自动关闭 residual。

`AF-RISK-SC-002` 已关闭为 CI-only 证据项：CI/Release 外部 Actions 已 pin 到 40 位 commit SHA，`pnpm audit:prod` 已进入 CI/Release validate gate，且机器台账要求后续记录中的 `expectedGitCommit` 与 GitHub run `gitCommit` 一致。后续修改 GitHub Actions、依赖审计策略、Release workflow、供应链记录生成/校验或创建新 Release 前，必须重新生成 CI-only 或签名 Release 供应链记录并通过 `pnpm sc:sc-002:preflight` 与对应 validator。CI-only 证据不关闭 `AF-RISK-SC-001`；签名 Release 路径仍需 SBOM/provenance、checksum/signature 和发布记录证据。

`AF-RISK-SC-003` 已关闭为证据项：本地 UX smoke 曾复现 `pg` transaction client query queue deprecation；当前 `packages/db` 对 Prisma pg adapter transaction query 做串行化，避免同一 transaction client 并发排队触发 `pg@9` 风险。当前 lockfile 只有 `pg@8.22.0`，`@prisma/adapter-pg@7.8.0` 也解析到同一 `pg@8.22.0`；临时 PostgreSQL 16 库上执行 `pnpm db:migrate:deploy`、增强后的 `NODE_OPTIONS=--trace-deprecation pnpm pg:trace-deprecation` 和本地 `NODE_OPTIONS=--trace-deprecation pnpm smoke:local-ux` 均未再出现 deprecation warning。后续升级 `pg` 或 Prisma adapter 时需重跑这些检查。
