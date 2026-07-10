# GitHub Release 自动更新器设计

## 状态

已实现服务器侧受控更新器第一版。它以 GitHub Release 为版本源，读取 release asset 中的 `areaforge-release-manifest.json`、SBOM、provenance、`SHA256SUMS`、`SHA256SUMS.sig`，拉取不可变镜像 digest，执行发布前备份、必要 migration、Web 切换、健康烟测和应用镜像回滚。

本设计不让 Web runtime 直接执行服务器命令。版本中心 UI 可以提交检查、更新、回退和自动策略请求；执行 Docker、备份、migration、回滚和状态回写的能力只属于服务器侧 root agent。不把生产密钥、数据库 URL、AI key、完整 prompt 或附件路径写入公开记录。

当前远端已按本设计上线：GitHub Release `v0.1.5` 成功生成 `SHA256SUMS.sig` cosign bundle，服务器安装 `cosign v3.1.1`，启用 `/etc/areaforge/cosign.pub` 校验并将 `https://forge.areasong.top/` 从 `0.1.1` 更新到 `0.1.5`。update-agent 状态为 `signatureRequired=true`、`blocker=null`、`timerEnabled=true`、`timerActive=true`。证据见 `docs/development/package-e-remote-github-release-record.md`。`v0.1.5` 是历史发布证据，不包含本次新增的 SBOM/provenance 资产。

## 目标形态

```text
GitHub tag / Release
        |
        v
GitHub Actions 构建 web image + migration image
        |
        v
发布 release manifest + SBOM + provenance + SHA256SUMS + SHA256SUMS.sig
        |
        v
服务器 systemd timer / 手动 apply
        |
        v
校验签名、hash、版本策略和 digest
        |
        v
备份数据库、上传 volume、env、compose、Nginx
        |
        v
一次性 migration image
        |
        v
切换 AREAFORGE_IMAGE / APP_VERSION 并 compose up web
        |
        v
health smoke / extra smoke
        |
        v
成功记录；失败回滚应用镜像并记录原因
```

应用内版本中心走另一条受控请求流：

```text
首页版本徽标弹层 / /settings UI
        |
        v
/api/system/update-requests 写入 ops-state/requests
        |
        v
areaforge-update-agent.timer
        |
        v
root agent 调用 updater / 修改自动策略 / 回写 status.json
        |
        v
/api/system/update-status 只读展示
```

## 产物

- `.github/workflows/release.yml`：tag 或手动 workflow 触发，先运行 validate job，再构建并推送 GHCR 镜像，发布 GitHub Release assets；stable release 缺少 cosign 签名密钥时 fail closed。
- `infra/docker/migration.Dockerfile`：只用于一次性 `pnpm db:migrate:deploy`，和 Web runtime 镜像分离。
- `ops/github-release-updater/areaforge-updater.sh`：服务器侧 updater CLI。
- `ops/github-release-updater/areaforge-updater.env.example`：私有 updater 配置模板。
- `ops/github-release-updater/areaforge-updater.service` 与 `.timer`：systemd 定时检查入口。
- `ops/update-agent/areaforge-update-agent.sh`：处理 UI 写入的受控更新请求。
- `ops/update-agent/areaforge-update-agent.service` 与 `.timer`：systemd 请求处理入口。
- `apps/web/components/update-version-popover.tsx`、`apps/web/app/settings/page.tsx` 与 `apps/web/app/api/system/**`：首页轻量版本弹层、完整版本中心 UI 和只读/写请求 API，不执行服务器命令。
- `ops/github-release-updater/manifest.schema.json` 与 `manifest.example.json`：Release manifest 合约。
- `scripts/quality/github-release-updater-preflight.ts`：只读门禁，检查 updater 文件、shell 语法、manifest、workflow、migration image 和 Web 无运维入口边界。
- `scripts/quality/ops-readiness-preflight.ts`：只读门禁，检查长期运营 evidence 入口、残余风险 ID、release workflow hard gate 和文档索引。
- `.github/workflows/ci.yml`：常规 CI 门禁，运行 `shellcheck`、updater preflight、治理 / ops readiness / Package E / 风险 / docs 门禁和 `pnpm check`。

## Release Manifest 合约

Release 必须包含：

- `areaforge-release-manifest.json`
- `areaforge-sbom.spdx.json`
- `areaforge-provenance.json`
- `SHA256SUMS`
- `SHA256SUMS.sig`
- `docker-compose.prod.yml`

manifest 必须包含：

- `version`
- `channel`
- `gitCommit`
- `minimumAppVersion`
- `webImage`
- `webImageDigest`
- `migrationImage`
- `migrationImageDigest`
- `requiresMigration`
- `sha256SumsAsset`
- `signatureAsset`
- `sbomAsset`
- `provenanceAsset`
- `autoApply.patch/minor/major`
- `smoke.healthPath`

`webImageDigest` 和 `migrationImageDigest` 必须是 `image@sha256:<digest>`，不允许 `latest`。`sbomAsset`、`provenanceAsset` 和 `composeAsset` 必须是简单 Release asset 文件名；updater 会下载这些资产并验证它们在 `SHA256SUMS` 中的 hash。updater 最终写入生产 `.env` 的 `AREAFORGE_IMAGE` 优先使用 `webImageDigest`，避免 tag 被重推后不可追溯。

## 自动更新策略

updater 有三种命令：

- `check`：只检查，不应用。
- `run`：按 `AREAFORGE_AUTO_APPLY` 和 manifest 的 `autoApply` 决定是否应用。
- `apply --yes`：显式应用指定 tag 或 latest release。

`AREAFORGE_AUTO_APPLY` 可选：

- `none`：默认，只提示新版本。
- `patch`：只自动应用 patch 版本，且 manifest `autoApply.patch=true`。
- `minor`：允许 minor 和 patch，且 manifest 对应字段为 true。
- `all`：允许 major、minor、patch，且 manifest 对应字段为 true。

第一版生产建议使用 `none` 或 `patch`。major 更新必须由操作者显式执行 `apply --yes --tag <tag>`。

## 安全边界

- 网页、Web API、管理后台按钮只能提交受控请求和读取状态；不能直接执行服务器命令。
- 不把 `docker.sock` 挂入 Web 容器。
- 不让 Web runtime 镜像承担 migration runner。
- 不使用 `latest`。
- 默认要求 `SHA256SUMS.sig`；cosign 模式下该文件是 bundle，通过 `cosign verify-blob --bundle` 校验，也保留 `gpg --verify` 可选路径。
- updater 记录只写路径、hash、版本、镜像 digest 和失败原因，不写生产 `.env` 内容、数据库 URL、密码、AI key 或附件内容。
- migration 通过一次性 migration image 执行；命令日志只显示 `DATABASE_URL=<redacted>`。
- 回滚默认只回滚应用镜像和 `APP_VERSION`。数据库恢复属于额外高风险动作，不在失败处理里默认执行。

## 验证

本地只读验证：

```bash
pnpm shellcheck:updater
pnpm github-release-updater:preflight
pnpm ops:readiness
```

发布端验证：

```bash
pnpm check
docker build -f infra/docker/web.Dockerfile .
docker build -f infra/docker/migration.Dockerfile .
```

服务器端验证：

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh check --config /etc/areaforge/updater.env
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh apply --yes --tag v1.0.3 --config /etc/areaforge/updater.env
sudo /opt/areaforge/ops/update-agent/areaforge-update-agent.sh
```

## 残余风险

- 首次远端服务器部署、域名 HTTPS 和真实 Nginx 切换已经通过 `v0.1.5` 远端签名 Release 验证；后续域名、Nginx、端口或服务器迁移仍需单独发布记录。
- GitHub Release stable 签名需要配置 `COSIGN_PRIVATE_KEY_B64` / `COSIGN_PASSWORD`（或兼容的 `COSIGN_PRIVATE_KEY` 多行 PEM）；缺少签名密钥时 stable workflow 必须失败。preview channel 可以生成 `unsigned preview` 占位资产，但生产 updater 若保持 `AREAFORGE_REQUIRE_SIGNATURE=true` 会拒绝应用。基础 SBOM/provenance 生成路径已接入，供应链残余项 `AF-RISK-SC-001` 需要下一次签名 Release 产生并校验真实资产后关闭。
- 完整登录、任务计时、附件上传下载等 smoke 依赖生产专用 `AREAFORGE_EXTRA_SMOKE_COMMAND`；updater 内置默认 smoke 只检查 `/api/health`。生产 extra smoke 残余项见 `AF-RISK-OPS-001`。
