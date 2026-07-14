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

## Dependabot

`.github/dependabot.yml` 每周检查：

- npm/pnpm workspace。
- GitHub Actions。
- Docker base image。

Dependabot PR 仍需要普通验证。不能因为来自 Dependabot 就跳过 review、docs 或 release 证据。

## GitHub Actions

- 外部 `uses:` 必须 pin 到 40 位 commit SHA，并用行内注释保留原始主版本，例如 `# v5`，方便 Dependabot 或人工升级时追溯来源。
- CI 和 Release workflow 都必须运行 `pnpm audit:prod`。当前该命令执行 `pnpm audit --prod --audit-level high`，把生产依赖的 high/critical 漏洞作为阻断项；moderate 或 low 结果不阻断发布，但需要在依赖治理或残余风险里评估。
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
pnpm audit:prod
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

当前 Release workflow 已接入基础 SBOM 与 provenance 生成路径，并把资产纳入 `SHA256SUMS` 和签名覆盖范围。`v0.1.7` 已产生真实签名 Release 的 SBOM/provenance 资产、checksum/signature 校验输出和发布记录证据，并已由服务器侧 updater 应用到生产；残余项 `AF-RISK-SC-001` 仍保持打开，是因为关闭台账需要维护者人工复核，生产 apply 不自动关闭 residual。

`AF-RISK-SC-002` 已关闭为 CI-only 证据项：CI/Release 外部 Actions 已 pin 到 40 位 commit SHA，`pnpm audit:prod` 已进入 CI/Release validate gate，且机器台账要求后续记录中的 `expectedGitCommit` 与 GitHub run `gitCommit` 一致。后续修改 GitHub Actions、依赖审计策略、Release workflow、供应链记录生成/校验或创建新 Release 前，必须重新生成 CI-only 或签名 Release 供应链记录并通过 `pnpm sc:sc-002:preflight` 与对应 validator。CI-only 证据不关闭 `AF-RISK-SC-001`；签名 Release 路径仍需 SBOM/provenance、checksum/signature 和发布记录证据。

`AF-RISK-SC-003` 已关闭为证据项：本地 UX smoke 曾复现 `pg` transaction client query queue deprecation；当前 `packages/db` 对 Prisma pg adapter transaction query 做串行化，避免同一 transaction client 并发排队触发 `pg@9` 风险。当前 lockfile 只有 `pg@8.22.0`，`@prisma/adapter-pg@7.8.0` 也解析到同一 `pg@8.22.0`；临时 PostgreSQL 16 库上执行 `pnpm db:migrate:deploy`、增强后的 `NODE_OPTIONS=--trace-deprecation pnpm pg:trace-deprecation` 和本地 `NODE_OPTIONS=--trace-deprecation pnpm smoke:local-ux` 均未再出现 deprecation warning。后续升级 `pg` 或 Prisma adapter 时需重跑这些检查。
