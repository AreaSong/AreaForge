# GitHub Release 自动更新

## 定位

AreaForge 支持 GitHub Release 驱动的服务器侧自动更新。它适合单机 Docker Compose 部署：GitHub Release 发布固定镜像 digest 和 manifest，服务器上的 updater 定时检查，按策略决定是否更新。

它不是让 Web runtime 直接执行 Docker 的“一键更新”。Web 应用可以提供版本中心 UI，用于展示版本状态、提交检查/更新/回退请求和调整自动策略；真正的 Docker、备份、恢复、migration 和回滚命令必须由服务器侧 root agent 执行。

## 当前远端状态

截至 `2026-07-10`，远端生产已经完成一次签名 Release 更新：

- 线上地址：`https://forge.areasong.top/`
- 当前线上版本：`0.1.5`
- 最新 GitHub Release：`v0.1.5`
- Release 地址：`https://github.com/AreaSong/AreaForge/releases/tag/v0.1.5`
- Web image：`ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9`
- Migration image：`ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:04aa20e92323c9f9b14c8bd096d8cfa9ea62d9baab23f94d4976d7882bfa2ae7`
- 服务器健康检查：`AREAFORGE_HEALTH_URL=http://127.0.0.1:3020/api/health`
- 签名校验：`AREAFORGE_REQUIRE_SIGNATURE=true`，`AREAFORGE_COSIGN_PUBLIC_KEY=/etc/areaforge/cosign.pub`
- update-agent：`timerEnabled=true`、`timerActive=true`、`blocker=null`
- 自动策略：`AREAFORGE_AUTO_APPLY=none`

完整证据见 `docs/development/package-e-remote-github-release-record.md`。

## 发布端配置

1. 在 GitHub 仓库启用 GHCR packages。
2. 配置 Release 签名密钥：
   - `COSIGN_PRIVATE_KEY_B64`（推荐，一行 base64 编码的 `cosign.key`）
   - `COSIGN_PASSWORD`
   - `COSIGN_PRIVATE_KEY`（兼容多行 PEM 形式）
   AreaForge 官方发布使用 `docs/deployment/keys/areaforge-cosign.pub` 对应的私钥签名。私钥只应保存在 GitHub Actions Secrets 或受控离线发布环境，不能提交到 Git。
3. 打 tag：

```bash
git tag v1.0.3
git push origin v1.0.3
```

`.github/workflows/release.yml` 会先运行 validate job，再构建：

- `pnpm shellcheck:updater`
- `pnpm github-release-updater:preflight`
- `pnpm governance:preflight`
- `pnpm ops:readiness`
- `pnpm package-e:preflight`
- `pnpm risk:preflight`
- `pnpm docs:readiness`
- `pnpm docs:completion`
- `pnpm skills:validate`
- `pnpm check`

stable channel 缺少 `COSIGN_PRIVATE_KEY_B64` 或 `COSIGN_PRIVATE_KEY` 时必须失败；preview channel 可生成 `unsigned preview` 占位资产，但不得作为生产签名更新依据。

通过后 workflow 构建：

- `ghcr.io/<owner>/areaforge-web:v1.0.3`
- `ghcr.io/<owner>/areaforge-migration:v1.0.3`

并在 GitHub Release 中上传：

- `areaforge-release-manifest.json`
- `SHA256SUMS`
- `SHA256SUMS.sig`（cosign bundle，供 `cosign verify-blob --bundle` 校验）
- `docker-compose.prod.yml`

## 服务器配置

复制配置模板：

```bash
sudo mkdir -p /etc/areaforge
sudo cp /opt/areaforge/ops/github-release-updater/areaforge-updater.env.example /etc/areaforge/updater.env
sudo chmod 600 /etc/areaforge/updater.env
```

关键配置：

```bash
AREAFORGE_GITHUB_REPO=owner/AreaForge
AREAFORGE_DEPLOY_DIR=/opt/areaforge
AREAFORGE_ENV_FILE=/opt/areaforge/.env.production
AREAFORGE_COMPOSE_FILE=/opt/areaforge/docker-compose.prod.yml
AREAFORGE_COMPOSE_PROJECT=areaforge
AREAFORGE_BACKUP_DIR=/opt/areaforge/backups
AREAFORGE_AUTO_APPLY=none
AREAFORGE_REQUIRE_SIGNATURE=true
AREAFORGE_COSIGN_PUBLIC_KEY=/etc/areaforge/cosign.pub
```

安装 AreaForge 官方 Release 公钥：

```bash
sudo mkdir -p /etc/areaforge
curl -fsSL https://raw.githubusercontent.com/AreaSong/AreaForge/main/docs/deployment/keys/areaforge-cosign.pub \
  | sudo tee /etc/areaforge/cosign.pub >/dev/null
sudo chmod 644 /etc/areaforge/cosign.pub
```

如果仓库或 package 是私有的，配置：

```bash
AREAFORGE_GITHUB_TOKEN=<只读 release/package token>
```

不要把 `/etc/areaforge/updater.env` 提交到 Git。

## 手动更新

先检查：

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh check \
  --config /etc/areaforge/updater.env
```

应用指定 Release：

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh apply --yes \
  --tag v1.0.3 \
  --config /etc/areaforge/updater.env
```

AreaForge 当前远端验证过的命令：

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh check --tag v0.1.5 --config /etc/areaforge/updater.env
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh apply --yes --tag v0.1.5 --config /etc/areaforge/updater.env
sudo /opt/areaforge/ops/update-agent/areaforge-update-agent.sh
```

流程会自动：

1. 加锁，避免并发更新。
2. 下载 GitHub Release manifest、`SHA256SUMS` 和 `SHA256SUMS.sig`。
3. 使用官方公钥校验 cosign bundle 签名，并校验 hash。
4. 校验 channel、版本、镜像 digest 和 migration image。
5. 启动或确认 PostgreSQL healthy。
6. 备份数据库、上传 volume、生产 env、compose、Nginx 和 release assets。
7. 拉取 Web image 和 migration image。
8. 通过一次性 migration image 执行 `pnpm db:migrate:deploy`。
9. 写入 `AREAFORGE_IMAGE=<image@sha256>` 与 `APP_VERSION=<version>`。
10. `docker compose up -d web`。
11. 调用 `/api/health` 和可选 extra smoke。
12. 失败时切回上一 `AREAFORGE_IMAGE` 和 `APP_VERSION`，并记录原因。

### 可选只读 extra smoke

仓库提供只读生产 HTTP smoke：

```bash
pnpm smoke:prod-readonly
```

该脚本不会执行 Docker、备份、恢复、migration 或服务器命令；默认只做 HTTP 检查：

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/dashboard/today`
- `GET /api/notes`
- `GET /api/syllabus`
- `GET /api/analytics/summary`
- `GET /api/reports/periodic`
- `GET /api/analytics/long-term-risks`
- `GET /api/system/update-status`
- 可选 `GET /api/attachments/:id?disposition=inline`

推荐配置：

```bash
AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly'
AREAFORGE_SMOKE_BASE_URL=https://forge.areasong.top
AREAFORGE_SMOKE_EMAIL=<smoke-account-email>
AREAFORGE_SMOKE_PASSWORD_FILE=/etc/areaforge/smoke-password
AREAFORGE_SMOKE_EXPECTED_VERSION=0.1.5
AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none
AREAFORGE_SMOKE_ATTACHMENT_ID=<optional-known-attachment-id>
```

优先使用 `AREAFORGE_SMOKE_PASSWORD_FILE`，不要把 smoke 密码写入 Git、Release 记录、updater 日志或 shell history。若要做创建任务、计时、附件上传或 AI 外呼等写入型 smoke，应使用专门 smoke 账号和单独确认的写入策略；默认 `smoke:prod-readonly` 不污染生产业务数据。

## 定时检查

安装 systemd timer：

```bash
sudo cp /opt/areaforge/ops/github-release-updater/areaforge-updater.service /etc/systemd/system/
sudo cp /opt/areaforge/ops/github-release-updater/areaforge-updater.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now areaforge-updater.timer
```

默认配置 `AREAFORGE_AUTO_APPLY=none` 只检查。若你希望 patch 版本自动更新：

```bash
AREAFORGE_AUTO_APPLY=patch
```

同时 Release manifest 必须写明：

```json
{
  "autoApply": {
    "patch": true,
    "minor": false,
    "major": false
  }
}
```

## 应用内版本中心

AreaForge 首页品牌旁的版本徽标会展开轻量版本弹层，展示当前版本、最新 Release、阻塞原因、最近操作、检查更新、应用更新、查看发布和版本回退入口。`/settings` 页面提供完整版本中心，可以额外保存自动更新策略。两个入口都不会直接执行服务器命令，而是把请求写入受控状态目录：

```text
$AREAFORGE_OPS_STATE_DIR/requests/*.json
```

服务器上的 `areaforge-update-agent.service` 由 `areaforge-update-agent.timer` 定时运行，读取请求后再调用服务器侧 updater 或修改 `AREAFORGE_AUTO_APPLY`。生产 compose 需要把状态目录挂入 Web 容器：

```yaml
volumes:
  - ${AREAFORGE_OPS_STATE_HOST_DIR:-/opt/areaforge/ops-state}:/app/ops-state
```

默认权限模型：

- Web 容器只写 `requests/` 并读取 `status.json`。
- root agent 读取请求、执行更新动作、移动历史请求并回写 `status.json`。
- 不挂载 `docker.sock` 到 Web 容器。
- 不在 Web API 中执行 `docker compose`、`pg_dump`、`prisma migrate deploy` 或恢复命令。

安装 agent：

```bash
sudo cp /opt/areaforge/ops/update-agent/areaforge-update-agent.service /etc/systemd/system/
sudo cp /opt/areaforge/ops/update-agent/areaforge-update-agent.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now areaforge-update-agent.timer
```

## 备份与记录

每次实际应用更新会在：

```text
$AREAFORGE_UPDATE_RECORD_DIR/github-<version>-<timestamp>/
```

写入：

- 数据库 dump。
- 上传 volume 归档。
- 生产 env 副本。
- compose 副本。
- Nginx 副本。
- release manifest、checksums、signature。
- `update-record.txt`。

记录只包含路径、hash、版本、镜像 digest、smoke 状态和失败原因，不包含生产 `.env` 内容、数据库 URL、密码、AI key 或附件正文。

## 回滚

失败时 updater 默认执行应用镜像回滚：

```text
AREAFORGE_IMAGE -> previousImage
APP_VERSION     -> previousAppVersion
docker compose up -d web
```

数据库恢复默认不自动执行。AreaForge 第一版 migration 设计以 additive 为主，失败后优先回滚应用镜像并保留新增字段。若确实需要恢复数据库和上传目录，必须按 `docs/deployment/backup-restore.md` 走单独确认和恢复演练。

## 验收

本地或 CI：

```bash
pnpm shellcheck:updater
pnpm github-release-updater:preflight
pnpm ops:readiness
pnpm check
```

服务器：

```bash
sudo systemctl status areaforge-updater.timer
sudo systemctl status areaforge-update-agent.timer
sudo journalctl -u areaforge-updater.service -n 100 --no-pager
sudo journalctl -u areaforge-update-agent.service -n 100 --no-pager
curl -fsS http://127.0.0.1:${WEB_PORT:-3000}/api/health
curl -fsS https://forge.areasong.top/api/health
```

当前远端 AreaForge 使用 `WEB_PORT=3020`，因此服务器本机 health 是 `http://127.0.0.1:3020/api/health`；`127.0.0.1:3000` 在该服务器上属于 Grafana。

日志中不得出现数据库 URL、`AUTH_SESSION_SECRET`、`AI_API_KEY`、完整 prompt、完整复盘正文、附件内容或上传绝对路径。
