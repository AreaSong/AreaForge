# Package E 远端 GitHub Release 签名发布记录

本记录补充 Package E 在真实远端服务器上的 GitHub Release 受控更新证据。它不替代 E1-E4 的本机生产发布、备份、恢复和回滚演练记录，而是记录外部服务器、域名 HTTPS、GHCR Release、cosign 签名校验和 update-agent 状态已经完成的事实。

## 历史结论

本记录是 `v0.1.5` 首次远端 GitHub Release 签名更新的历史证据。当前生产版本已更新到 `0.1.7`，当前记录见 `docs/development/release-v0.1.7-record.md`；本文件不得作为当前线上版本、最新 Release 或长期运营闭环证据使用。

- 线上地址：`https://forge.areasong.top/`
- 线上健康检查：`GET https://forge.areasong.top/api/health` 返回 `{"ok":true,"service":"AreaForge","version":"0.1.5"}`。
- 当时最新 GitHub Release：`v0.1.5`，发布时间 `2026-07-10T07:15:36Z`。
- Release 地址：`https://github.com/AreaSong/AreaForge/releases/tag/v0.1.5`
- Release commit：`05bc4fe35db75d323d8391abcd1fb97bff575e2d`
- 服务器更新方式：`areaforge-updater.sh apply --yes --tag v0.1.5 --config /etc/areaforge/updater.env`
- 签名校验：已开启，`AREAFORGE_REQUIRE_SIGNATURE=true`，`AREAFORGE_COSIGN_PUBLIC_KEY=/etc/areaforge/cosign.pub`。
- update-agent 状态：`blocker=null`，`timerEnabled=true`，`timerActive=true`，`updateAvailable=false`。
- 当前自动应用策略：`AREAFORGE_AUTO_APPLY=none`，即 Web 版本中心可以提交受控请求，但不会静默自动更新。

## Release 资产

`v0.1.5` Release 包含：

- `areaforge-release-manifest.json`
- `docker-compose.prod.yml`
- `SHA256SUMS`
- `SHA256SUMS.sig`

本地验证已通过：

```bash
sha256sum -c SHA256SUMS
cosign verify-blob --key docs/deployment/keys/areaforge-cosign.pub --bundle SHA256SUMS.sig SHA256SUMS
```

结果：

- `areaforge-release-manifest.json: OK`
- `docker-compose.prod.yml: OK`
- `Verified OK`

## 镜像与 digest

Release manifest 中记录的不可变镜像 digest：

```text
webImageDigest:
ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9

migrationImageDigest:
ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:04aa20e92323c9f9b14c8bd096d8cfa9ea62d9baab23f94d4976d7882bfa2ae7
```

服务器当前 Web 容器状态：

```text
name=areaforge-web
image=ghcr.io/areasong/areaforge-web:v0.1.5
ports=127.0.0.1:3020->3000/tcp
```

注意：该服务器上的 `127.0.0.1:3000` 是 Grafana，不是 AreaForge。AreaForge 在服务器本机监听 `127.0.0.1:3020`，公网通过 Nginx 暴露 `https://forge.areasong.top/`。

## 服务器配置

当前 `/etc/areaforge/updater.env` 的关键状态：

```text
AREAFORGE_AUTO_APPLY=none
AREAFORGE_REQUIRE_SIGNATURE=true
AREAFORGE_COSIGN_PUBLIC_KEY=/etc/areaforge/cosign.pub
AREAFORGE_GPG_VERIFY=false
AREAFORGE_HEALTH_URL=http://127.0.0.1:3020/api/health
```

官方 cosign 公钥：

```text
/etc/areaforge/cosign.pub
sha256=7e3ab257233b26eadff67d8e087aa10604142bb8ec31befa715b1de64ee0e914
```

服务器 cosign：

```text
/usr/local/bin/cosign
GitVersion: v3.1.1
Platform: linux/amd64
```

## 更新执行证据

服务器只读检查：

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh check --tag v0.1.5 --config /etc/areaforge/updater.env
```

关键结果：

```text
cosign verify-blob --key /etc/areaforge/cosign.pub --bundle SHA256SUMS.sig SHA256SUMS
Verified OK
areaforge-release-manifest.json: OK
docker-compose.prod.yml: OK
update available: current=0.1.1 target=0.1.5 class=patch autoPolicy=none manifestAllowed=true
```

服务器应用更新：

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh apply --yes --tag v0.1.5 --config /etc/areaforge/updater.env
```

关键结果：

```text
Verified OK
docker pull ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9
docker pull ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:04aa20e92323c9f9b14c8bd096d8cfa9ea62d9baab23f94d4976d7882bfa2ae7
No pending migrations to apply.
docker compose up -d web
update applied: 0.1.1 -> 0.1.5
```

更新记录路径：

```text
/opt/areaforge/backups/github-release-updates/github-0.1.5-20260710074103/update-record.txt
```

## update-agent 状态

刷新 update-agent 后，`/opt/areaforge/ops-state/status.json` 的关键字段：

```json
{
  "currentVersion": "0.1.5",
  "currentImage": "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9",
  "appUrl": "https://forge.areasong.top",
  "releaseUrl": "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.5",
  "latestVersion": "v0.1.5",
  "latestPublishedAt": "2026-07-10T07:15:36Z",
  "updateAvailable": false,
  "autoApply": "none",
  "signatureRequired": true,
  "timerEnabled": true,
  "timerActive": true,
  "blocker": null,
  "rollback": {
    "available": true,
    "targetVersion": "0.1.1",
    "targetImage": "ghcr.io/areasong/areaforge-web:v0.1.1@sha256:908b3ce28ab12df003b934690156a7e054e221eff8e44f827c012c711c373e6b"
  }
}
```

## Web 版本中心边界

当前已具备 Web 在线更新入口的安全形态：

```text
Web UI 提交检查/应用/回退/策略请求
-> /api/system/update-requests 写入 ops-state/requests
-> areaforge-update-agent.timer 读取请求
-> root agent 调用服务器侧 updater
-> 签名校验、备份、migration、切换镜像、烟测、记录结果
-> /api/system/update-status 只读展示状态
```

Web runtime 不直接执行 `docker pull`、`docker compose`、`pg_dump`、migration、备份恢复或服务器命令，也不挂载 `docker.sock`、生产 `.env`、签名私钥或备份目录。

## 残余风险与后续规则

- 当前 `AREAFORGE_AUTO_APPLY=none`，所以后续新版本不会静默自动应用；需要通过 Web 受控请求、手动 updater 或显式调整策略触发。
- updater 内置 smoke 只检查 `/api/health`；仓库现已提供 `pnpm smoke:prod-readonly` 作为 `AREAFORGE_EXTRA_SMOKE_COMMAND` 的默认只读补强，可覆盖登录、核心只读 API、update-status 和可选附件下载。创建任务、计时、附件上传和 AI 外呼等写入型 smoke 仍需专门 smoke 账号和单独确认的写入策略。
- 数据库恢复和上传目录恢复仍不自动执行；失败时默认只回滚应用镜像和 `APP_VERSION`。
- 后续每次功能发布应使用干净 commit、版本 bump、tag、GitHub Release，并验证 `SHA256SUMS` 与 `SHA256SUMS.sig` 后再让服务器更新。
