# 自托管操作者上手

## 定位

本文件面向第一次自托管 AreaForge 的操作者。它把本地准备、生产配置、管理员初始化、私有上传目录、GitHub Release 更新器、备份恢复、smoke、告警和残余风险串成一条可执行路径。

它不是生产执行授权。任何真实生产 deploy、migration、备份、恢复、updater apply、rollback、Nginx 变更、自动更新策略变更或写入型生产 smoke，仍必须按 `docs/development/high-risk-confirmation-packets.md` 先确认影响、风险、验证和回滚。

## 先决条件

- 一台可运行 Docker Compose 的服务器。
- PostgreSQL 16 容器或兼容实例。
- 一个 HTTPS 域名和 Nginx 反向代理。
- 一个 GitHub Release 可读来源；公开仓库不需要 release/package token，私有仓库需要只读 token。
- 一份只保存在服务器上的生产环境文件，例如 `/opt/areaforge/.env.production`。
- 一个不在 `public/` 下的上传目录或 volume。
- 一份 AreaForge Release cosign 公钥，默认路径为 `/etc/areaforge/cosign.pub`。

## 生产环境文件

从 `.env.example` 复制生产文件后逐项替换。不要把生产 `.env`、数据库 URL、AI key、session secret、smoke 密码或 cosign 私钥提交到 Git。

关键项：

```bash
NODE_ENV=production
APP_ENV=production
APP_URL=https://your-domain.example
APP_VERSION=0.1.7

DATABASE_URL=postgresql://...
POSTGRES_DB=areaforge
POSTGRES_USER=areaforge
POSTGRES_PASSWORD=<strong-random-password>
WEB_PORT=3020
AREAFORGE_IMAGE=ghcr.io/areasong/areaforge-web:v0.1.7@sha256:<digest>
AREAFORGE_OPS_STATE_HOST_DIR=/opt/areaforge/ops-state

AUTH_SESSION_SECRET=<strong-random-secret>
AUTH_ADMIN_EMAIL=<admin-email>
AUTH_ADMIN_PASSWORD_HASH=<scrypt-hash>

AI_ENABLED=false
AI_BASE_URL=https://...
AI_API_KEY=<server-only-key>
AI_MODEL=<model>
AI_LOG_PROMPTS=false
AI_ALLOW_SENSITIVE_CONTEXT=false

UPLOAD_DIR=/app/uploads
BACKUP_DIR=/backups
TRUST_PROXY=true
```

管理员密码哈希使用：

```bash
pnpm auth:hash
```

生产文件权限建议收紧到仅部署用户或 root 可读：

```bash
chmod 600 /opt/areaforge/.env.production
```

## 容器与 Nginx

生产使用 `docker-compose.prod.yml`，不要叠加本地开发 compose 文件。

要求：

- `postgres` 不暴露公网端口。
- `web` 只绑定服务器本机端口，例如 `127.0.0.1:${WEB_PORT:-3000}`。
- Nginx HTTPS 只反代到 AreaForge Web。
- 上传目录通过鉴权 API 下载，不由 Nginx 静态暴露。
- Web runtime 不挂载 `docker.sock`、生产备份目录、cosign 私钥或服务器命令能力。

只读结构检查：

```bash
docker compose --env-file .env.example -f docker-compose.prod.yml config
pnpm package-e:preflight
```

## GitHub Release 更新器

AreaForge 的更新路径是 GitHub Release 驱动的服务器侧 updater。Web 版本中心只提交受控请求；真正的 Docker、备份、migration、切换、smoke 和 rollback 由服务器上的 update-agent/updater 执行。

服务器侧关键配置见 `docs/deployment/github-release-updater.md`。安全默认值：

```bash
AREAFORGE_AUTO_APPLY=none
AREAFORGE_REQUIRE_SIGNATURE=true
AREAFORGE_COSIGN_PUBLIC_KEY=/etc/areaforge/cosign.pub
```

公开仓库通常不需要 `AREAFORGE_GITHUB_TOKEN`。私有仓库或私有 package 需要只读 token，且 token 只放在 `/etc/areaforge/updater.env`。

安装公钥示例：

```bash
sudo mkdir -p /etc/areaforge
curl -fsSL https://raw.githubusercontent.com/AreaSong/AreaForge/main/docs/deployment/keys/areaforge-cosign.pub \
  | sudo tee /etc/areaforge/cosign.pub >/dev/null
sudo chmod 644 /etc/areaforge/cosign.pub
```

定时检查默认只检查，不静默应用：

```bash
sudo systemctl enable --now areaforge-updater.timer
sudo systemctl enable --now areaforge-update-agent.timer
```

若未来要启用 patch 自动应用，必须先满足 `AF-RISK-REL-001` 的关闭条件：签名、备份、extra smoke、rollback target、manifest policy 和用户确认同时存在。

## 备份与恢复

生产至少保留：

- PostgreSQL dump。
- 上传目录归档。
- 生产 `.env` 备份 hash。
- 当前 `docker-compose.prod.yml` 副本。
- Nginx 配置副本。
- 当前 Release tag、镜像 digest 和回滚目标。

发布、更新或 migration 前必须有当前备份点。恢复演练按 `docs/deployment/backup-restore.md` 执行，并使用只读对账报告，不自动删除、移动、修复附件或覆盖 metadata。

发布记录需通过：

```bash
pnpm release:evidence:validate <release-record.md|txt> [attachment-reconciliation.csv]
```

## 首次 smoke

最小只读验证：

```bash
curl -fsS https://your-domain.example/api/health
pnpm ops:support:bundle-preview
pnpm ops:readiness:summary
pnpm ops:evidence:bundle
pnpm ops:alert:preview
```

如果要向公开 issue 或维护者提供上下文，优先生成 metadata-only 支持包预览，而不是贴生产日志或环境文件：

```bash
pnpm ops:support:bundle-preview > /tmp/areaforge-support-bundle-preview.json
pnpm ops:support:bundle-preview:validate /tmp/areaforge-support-bundle-preview.json
```

该预览只包含版本、文档入口、命令名、residual ID 和 redaction/safety facts；不导出附件、日志、数据库、备份或用户学习内容。

生产只读 smoke 推荐通过密码文件读取账号密码：

```bash
export AREAFORGE_SMOKE_BASE_URL=https://your-domain.example
export AREAFORGE_SMOKE_EMAIL=<smoke-account-email>
export AREAFORGE_SMOKE_PASSWORD_FILE=/etc/areaforge/smoke-password
export AREAFORGE_SMOKE_EXPECTED_VERSION=0.1.7
export AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none
export AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly'
pnpm smoke:prod-readonly:config
pnpm smoke:prod-readonly | tee /tmp/areaforge-prod-readonly-smoke.log
```

形成运维记录后，使用模板和校验：

```bash
AREAFORGE_READINESS_EXPECTED_VERSION=0.1.7 \
AREAFORGE_READINESS_RELEASE_TAG=v0.1.7 \
AREAFORGE_READINESS_GITHUB_REPO=AreaSong/AreaForge \
AREAFORGE_SMOKE_PASSWORD_FILE=/etc/areaforge/smoke-password \
AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly' \
pnpm smoke:prod-readonly:record /tmp/areaforge-prod-readonly-smoke.log > /tmp/areaforge-prod-readonly-smoke-record.txt
pnpm smoke:prod-readonly:validate <prod-readonly-smoke-record.md|txt>
```

创建任务、计时、附件上传、AI 外呼等写入型生产 smoke 不在默认路径内。执行前必须先明确专用账号、允许写入范围、清理策略、失败处理方式和确认记录。

如果生产目录和 `status.json` 是 root-only，管理员可用只读 helper 一次性导出 `AF-RISK-OPS-001` 所需 redacted 证据：

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-ops001-evidence-export.sh \
  --config /etc/areaforge/updater.env \
  --state-dir /opt/areaforge/ops-state \
  --output-dir /tmp/areaforge-ops001-$(date -u +%Y%m%d%H%M%S)
```

该命令只生成 redacted status、生产只读 smoke record、operational evidence bundle 和 OPS-001 closure packet；不执行 update apply、migration、备份、恢复、回滚或生产写入，不修改 residual 台账。导出目录可以交给维护者校验，配置文件、smoke 密码文件、生产 `.env` 和原始敏感日志不要外传。

OPS-001 helper 需要生产主机或受控 release 工作目录能执行仓库 `pnpm` 脚本，并且 `/etc/areaforge/updater.env` 中必须配置 `AREAFORGE_EXTRA_SMOKE_COMMAND`、`AREAFORGE_SMOKE_BASE_URL`、`AREAFORGE_SMOKE_EMAIL` 和权限收紧的 `AREAFORGE_SMOKE_PASSWORD_FILE`。若生产主机无法运行 Node.js/pnpm，可用 `ops/update-agent/areaforge-ops001-readonly-fallback.sh` 导出 redacted update-agent status、前置条件摘要和可选 curl smoke 输出，再回本地运行 `pnpm ops:ops-001:fallback:finalize <redacted-fallback-dir> [output-dir]` 生成 smoke record、operational evidence bundle 和 OPS-001 closure packet。2026-07-11 的首次尝试记录在 `docs/development/ops-001-production-readonly-attempt-20260711.md`；2026-07-11/12 已用 fallback 补齐当时版本的只读 smoke、redacted update-agent status、operational evidence bundle 和 OPS-001 closure packet，证据目录为 `docs/development/ops-001-production-readonly-20260711/`。这些证据在 `v0.1.7` 更新后只能作为历史输入；当前版本仍需重新采集 post-`v0.1.7` redacted smoke/status/evidence bundle/OPS-001 closure packet，且 residual 台账关闭仍需维护者人工复核。

通过 SSH/tmux 执行 fallback 时，操作者先在 TTY 中完成 `sudo -v`，再运行一次 helper。fallback 输出目录使用 `/tmp/areaforge-ops001-fallback-*` 时，helper 会把 redacted 目录移交给触发 sudo 的用户，并在 `remote-summary.txt` 写入 `redactedHandoffStatus`；状态为 `granted` 后可直接 `scp -r` 回本地。若状态为 `skipped-*` 或 `failed`，先修正输出目录或重新交互执行，不要追加链式 `sudo tar/chown` 命令。

## 告警与演练

仓库当前提供只读告警预览，不发送外部通知：

```bash
pnpm ops:alert:preview
```

真实告警接收人、人工值班窗口和演练记录仍属于 `AF-RISK-OPS-004`。完成演练后用：

```bash
pnpm ops:alert:preview > /tmp/areaforge-alert-preview.json
AREAFORGE_ALERT_DRILL_OPERATOR=<operator> \
AREAFORGE_ALERT_RECEIVER_TYPE=manual-window \
AREAFORGE_ALERT_RECEIVER_CONFIGURED=yes \
AREAFORGE_ALERT_RECEIVER_ACK=yes \
AREAFORGE_ALERT_DRILL_DETECTION_RESULT=PASS \
AREAFORGE_ALERT_DRILL_RECOVERY_RESULT=PASS \
AREAFORGE_ALERT_DRILL_RECOVERY_ACTION="<what was checked or restored>" \
pnpm alert:drill:record /tmp/areaforge-alert-preview.json > /tmp/areaforge-alert-drill-record.txt
pnpm alert:drill:validate <alert-drill-record.md|txt>
```

## 后续发布节奏

每次功能更新进入线上时，默认走 GitHub Release：

1. 同步 `docs/**`、`tasks/**`、`workflow/**`、README 和相关 skill。
2. 运行对应验证，至少覆盖 `pnpm check`、`pnpm docs:readiness`、`pnpm docs:completion`、`pnpm risk:preflight`、`pnpm ops:readiness` 和 `git diff --check`。
3. bump 版本，提交干净 commit，推送 `vX.Y.Z` tag。
4. 等待 GitHub Release workflow 生成 manifest、SBOM、provenance、`SHA256SUMS`、`SHA256SUMS.sig` 和 GHCR digest。
5. 用 Web 版本中心提交受控更新请求，或由管理员在服务器执行 updater。
6. 更新后记录 health、update-agent、smoke、rollback target、`pnpm ops:evidence:bundle` 的 `bundleHash` 和残余风险 ID。
7. 若本次 Release 用于关闭供应链残余项，填写 `docs/development/release-supply-chain-record-template.md`，先运行 `pnpm sc:sc-002:preflight`，再运行 `pnpm release:supply-chain:validate`。
   已下载 Release 资产时，可先用 `pnpm release:supply-chain:record <release-assets-dir>` 生成记录草稿；它仍要求显式填写 workflow run URL、`pnpm audit:prod`、Actions pinning、checksum 和签名校验结果。

## 禁止清单

- 不把生产 `.env`、数据库 URL、API key、session secret、smoke 密码或 cosign 私钥提交到 Git。
- 不把上传目录放进 `public/` 或由 Nginx 静态暴露。
- 不让 Web runtime 执行 Docker、备份、恢复、migration、rollback 或 shell 命令。
- 不把 `docker.sock`、备份目录或服务器 root 凭据挂进 Web 容器。
- 不在 Release 记录、updater 日志或 smoke 输出中打印密钥、完整 prompt、完整复盘正文、附件内容或上传绝对路径。
- 不在没有确认和清理策略时执行生产写入型 smoke。
- 不把 `AREAFORGE_AUTO_APPLY=patch` 当作默认安全选项。

## 当前残余风险

自托管上线时必须显式带入这些残余项：

- `AF-RISK-OPS-001`：2026-07-11/12 生产 extra/read-only smoke 是当时版本的可人工复核历史证据；post-`v0.1.7` 仍需重新采集 redacted smoke/status/evidence bundle/closure packet。
- `AF-RISK-OPS-002`：生产写入型 smoke 需要单独确认、账号和清理策略。
- `AF-RISK-REL-001`：默认 `AREAFORGE_AUTO_APPLY=none`，patch 自动应用需另行确认。
- `AF-RISK-SC-001`：`v0.1.7` 签名 Release 已有 SBOM/provenance、checksum、cosign signature、GHCR digest 和生产 apply 证据；台账关闭仍需维护者人工复核，生产更新本身不自动关闭 residual。
- `AF-RISK-SC-002`：已关闭为 CI-only 证据项；后续 GitHub Actions、依赖审计、Release workflow、供应链记录工具或新 Release 变更前需重新复核。
- `AF-RISK-OPS-003`：服务器、域名、Nginx 或端口迁移需单独 runbook 和证据。
- `AF-RISK-OPS-004`：2026-07-11 manual-window 告警/恢复演练仅作为历史输入；post-`v0.1.7` alert preview 已保存，但仍缺 matching alert drill/preflight，metrics dashboard 和外部接收人产品化仍是后续增强。

## 本地预检

修改操作者上手路径、部署文档、更新器文档或生产运维入口后，运行：

```bash
pnpm operator:onboarding:preflight
pnpm docs:readiness
pnpm ops:readiness
git diff --check
```
