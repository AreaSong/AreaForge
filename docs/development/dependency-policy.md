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

## 更新策略

- patch/minor 依赖更新：优先跑 `pnpm governance:preflight` 和 `pnpm check`；涉及 release/updater 时补跑 `pnpm github-release-updater:preflight`。
- major 依赖更新：必须说明 breaking changes、回滚方式和验证扩大范围。
- 安全更新：优先处理，但仍不能绕过高风险确认边界。
- build script 变化：检查 `pnpm-workspace.yaml` 的 build approval 口径，避免引入未解释的 postinstall 行为。

## 验证

常规依赖变更至少运行：

```bash
pnpm install --frozen-lockfile
pnpm governance:preflight
pnpm check
git diff --check
```

Release/updater、Docker 或 GitHub Actions 相关依赖还要运行：

```bash
pnpm github-release-updater:preflight
pnpm shellcheck:updater
pnpm ops:readiness
```

## 残余风险

当前 Release workflow 已接入基础 SBOM 与 provenance 生成路径，并把资产纳入 `SHA256SUMS` 和签名覆盖范围。残余项 `AF-RISK-SC-001` 仍保持打开：它需要下一次真实签名 Release 产生 SBOM/provenance 资产、checksum/signature 校验输出和发布记录证据后才能关闭。
