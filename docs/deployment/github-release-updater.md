# GitHub Release 自动更新

## 定位

AreaForge 支持 GitHub Release 驱动的服务器侧自动更新。它适合单机 Docker Compose 部署：GitHub Release 发布固定镜像 digest 和 manifest，服务器上的 updater 定时检查，按策略决定是否更新。

它不是让 Web runtime 直接执行 Docker 的“一键更新”。Web 应用可以提供版本中心 UI，用于展示版本状态、提交检查/更新/回退请求和调整自动策略；真正的 Docker、备份、恢复、migration 和回滚命令必须由服务器侧 root agent 执行。

## 当前远端状态

截至 `2026-07-12`，远端生产已经完成 `v0.1.7` 签名 Release 更新：

- 线上地址：`https://forge.areasong.top/`
- 当前线上版本：`0.1.7`
- 最新 GitHub Release：`v0.1.7`
- Release 地址：`https://github.com/AreaSong/AreaForge/releases/tag/v0.1.7`
- Web image：`ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd`
- Migration image：`ghcr.io/areasong/areaforge-migration:v0.1.7@sha256:c2c27da7ed85be0796d4f6535557d3759bc14975a0238b725b99c1c0e232e654`
- 服务器健康检查：`AREAFORGE_HEALTH_URL=http://127.0.0.1:3020/api/health`
- 签名校验：`AREAFORGE_REQUIRE_SIGNATURE=true`，`AREAFORGE_COSIGN_PUBLIC_KEY=/etc/areaforge/cosign.pub`
- update-agent：`timerEnabled=true`、`timerActive=true`、`blocker=null`（生产 root-only status 进入仓库前必须先 redacted）
- 自动策略：`AREAFORGE_AUTO_APPLY=none`
- 更新记录：`/opt/areaforge/backups/github-release-updates/github-0.1.7-20260712112325/update-record.txt`
- 只读公网校验：`GET https://forge.areasong.top/api/health` 返回 `0.1.7`

当前发布证据见 `docs/development/release-v0.1.7-record.md`；`docs/development/package-e-remote-github-release-record.md` 保留 `v0.1.5` 历史证据。

## 发布端配置

1. 在 GitHub 仓库启用 GHCR packages。
2. 配置 Release 签名密钥：
   - `COSIGN_PRIVATE_KEY_B64`（推荐，一行 base64 编码的 `cosign.key`）
   - `COSIGN_PASSWORD`
   - `COSIGN_PRIVATE_KEY`（兼容多行 PEM 形式）
   AreaForge 官方发布使用 `docs/deployment/keys/areaforge-cosign.pub` 对应的私钥签名。私钥只应保存在 GitHub Actions Secrets 或受控离线发布环境，不能提交到 Git。
   Release workflow 只把解码后的临时私钥写入 `$RUNNER_TEMP`，并通过 EXIT trap 在签名成功或失败后删除私钥和错误临时文件；后续 Release 发布 Action 不应能读取签名私钥文件。
3. 打 tag：

```bash
git tag v1.0.3
git push origin v1.0.3
```

`.github/workflows/release.yml` 会先运行 validate job，再构建：

- `pnpm shellcheck:updater`
- `pnpm github-release-updater:preflight`
- `pnpm governance:preflight`
- `pnpm audit:all`
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
- `areaforge-sbom.spdx.json`
- `areaforge-provenance.json`
- `SHA256SUMS`
- `SHA256SUMS.sig`（cosign bundle，供 `cosign verify-blob --bundle` 校验）
- `areaforge-release-supply-chain.md`（签名后生成、发布前 strict 校验，并随 Release 发布）
- `docker-compose.prod.yml`

若要把本次 Release 作为 `AF-RISK-SC-001` / `AF-RISK-SC-002` 的关闭证据，使用
`docs/development/release-supply-chain-record-template.md` 记录 SBOM/provenance、`SHA256SUMS` 覆盖、
签名校验、Actions SHA pinning 和 `pnpm audit:prod` 结果，并运行：

```bash
AREAFORGE_SC002_RELEASE_RECORD=<release-supply-chain-record.md|txt> pnpm sc:sc-002:preflight
pnpm release:supply-chain:validate <release-supply-chain-record.md|txt>
```

已下载 Release 资产时，可先生成记录草稿：

```bash
AREAFORGE_RELEASE_WORKFLOW_RUN_URL=https://github.com/AreaSong/AreaForge/actions/runs/<run-id> \
AREAFORGE_RELEASE_WORKFLOW_RUN_CONCLUSION=success \
AREAFORGE_VALIDATE_JOB_STATUS=pass \
AREAFORGE_AUDIT_PROD_STATUS=pass \
AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS=pass \
AREAFORGE_ACTIONS_PINNING_STATUS=pass \
AREAFORGE_RELEASE_WORKFLOW_STATUS=pass \
AREAFORGE_CHECKSUM_VERIFICATION=pass \
AREAFORGE_SIGNATURE_VERIFICATION=pass \
AREAFORGE_UNSIGNED_PLACEHOLDER_PRESENT=no \
pnpm release:supply-chain:record /path/to/release-assets > /path/to/release-supply-chain-record.txt
```

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
AREAFORGE_PRODUCTION_STATE_LOCK_FILE=/opt/areaforge/.areaforge-production-state.lock
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

## Update Request V2 安全契约

当前 checkout 已完成 OPS-005 本地实现，但尚未通过新的签名 Release 部署到生产。生产 `v0.1.7`
不能据此宣称已经运行 V2。

V2 链路如下：

1. updater 完成 Release 签名、manifest 和 digest 校验后，通过 `--identity-json` 输出脱敏 target identity。
2. root update-agent 把 current version/image、policy、signature、verified target、rollback availability 和精确
   rollback source record hash 组成 agent-authored status snapshot，并写入 canonical `snapshotHash`。
3. 浏览器只提交它实际展示并由用户确认的 `snapshotHash` 和一次性 idempotency key；API 不接受客户端
   自行提供 expected-before 或 target identity。两个版本中心入口使用同一 intent canonicalization；
   browser session 以有界 intent→key 集合保留多个独立不确定请求；storage 读取或写入失败时，同一组件仍
   复用内存中的 key；durability uncertain、408、
   429、5xx 或无效响应不会提前销毁该 key。
4. Web 使用严格 schema V2、TTL、expected-before/semantic/request 三个 domain-separated hash，并通过
   file fsync、no-clobber atomic hard-link publish、request 目录和新建父目录链 fsync 发布请求；同名 final
   不可覆盖，final 已发布但目录持久化或临时链接清理未确认时返回 durability uncertain，不得把它解释为可立即重试。
5. root agent 原子领取到 root-only `processing/`，并以原子 rename 把 Web-owned inode 替换成 root-owned
   inode；替换失败时保留原请求名。V1 mutation、过期、篡改、重复、幂等冲突和状态漂移
   均 fail closed。stale 或缺 claim metadata 的 mutation 进入 `needs_reconciliation`，不自动重放；
   Web/API admission 在该状态也只允许只读 `check`。root agent 在 active processing 下仍可处理严格校验的
   check 来刷新脱敏状态，但不会领取、重放或清理 mutation。尚未移动 request 的空 pre-claim 目录会安全清理。
6. updater apply、agent rollback 和 policy mutation 共用 `AREAFORGE_PRODUCTION_STATE_LOCK_FILE`；apply 由
   agent 先持锁并通过显式握手让 updater 复用同一 fd inode；配置中的 lock path 或同路径文件若不再指向该
   inode 会 fail closed，rollback/policy 在最终边界也重新核验。run 模式持锁后重读自动策略。第一次 compare 通过后，在备份、env/config write 或 Docker
   副作用前再次校验 TTL 并 compare；apply 过期会输出结构化 `REQUEST_EXPIRED` rejection，rollback 的第二次 guard 位于
   source/env 候选准备完成后、原子替换 production env 前；最终 env rename 返回非零时按
   `ROLLBACK_ENV_SWITCH_UNCERTAIN` 保留 processing claim，不假定 rename 一定未发生。
7. immutable decision history 记录 reason code、hash、claim、两次 observed-before hash 和
   `executionAttempted`；updater 只有跨过备份边界时才发出 `executionAttempted=true` 机器标记。任何
   reconciliation marker 都优先于矛盾的 terminal marker，并立即在顶层 status 投影 blocker。

本地验证：

```bash
pnpm ops:ops-005:local:selftest
pnpm shellcheck:updater
pnpm github-release-updater:preflight
pnpm ops:ops-005:preflight
```

本地实现通过后，`pnpm ops:ops-005:preflight` 应进入 `needs_signed_release`，而不是
`ready_for_ops005_human_review`。生产部署仍需单独确认，并按维护窗口暂停 timer、记录并隔离旧请求、
同时部署匹配 Web/agent/updater、先执行 V2 check、再恢复 timer。失败时同时回滚 Web 与 agent，并隔离
所有 V2 请求；不得让旧 agent 读取 V2 mutation。

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
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh apply --yes --tag v0.1.7 --config /etc/areaforge/updater.env
sudo /opt/areaforge/ops/update-agent/areaforge-update-agent.sh
```

历史 `v0.1.5` 首次远端签名更新曾验证：

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh check --tag v0.1.5 --config /etc/areaforge/updater.env
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh apply --yes --tag v0.1.5 --config /etc/areaforge/updater.env
```

流程会自动：

1. 加锁，避免并发更新。
2. 下载 GitHub Release manifest、SBOM、provenance、`SHA256SUMS` 和 `SHA256SUMS.sig`。
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

Release workflow 在签名与发布之间运行：

```bash
pnpm release:supply-chain:record . > areaforge-release-supply-chain.md
AREAFORGE_COSIGN_PUBLIC_KEY=docs/deployment/keys/areaforge-cosign.pub \
  pnpm release:supply-chain:validate areaforge-release-supply-chain.md . --strict
```

不带 `--strict` 的 validator 只用于历史记录或结构检查，不能证明 assets、manifest identity 或 cosign
签名真实有效，也不能让 OPS-005 进入 signed Release 已满足状态。

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
AREAFORGE_SMOKE_EXPECTED_VERSION=0.1.7
AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none
AREAFORGE_SMOKE_ATTACHMENT_ID=<optional-known-attachment-id>
```

若生产主机不安装 Node.js/pnpm，不要关闭 extra smoke；改用仓库提供的 shell/curl 等价只读 smoke：

```bash
AREAFORGE_EXTRA_SMOKE_COMMAND='/opt/areaforge/ops/update-agent/areaforge-release-readonly-smoke.sh --config /etc/areaforge/updater.env'
```

该脚本同样只执行 `/api/health`、登录和核心只读 API 检查，不执行 Docker、备份、恢复、migration、回滚、数据库写入或上传目录写入。执行边界会通过 `O_NOFOLLOW` 文件描述符读取权限收紧的 `AREAFORGE_SMOKE_PASSWORD_FILE`，并在同一个 inode 上校验普通文件、唯一链接数和 group/world 权限；任何 `AREAFORGE_SMOKE_PASSWORD` 明文环境变量、symlink、hardlink、相对路径或弱权限文件都会 fail closed。它只把密码用于向 `/api/auth/login` 提交 smoke 账号登录请求；stdout、updater 记录和运维证据不得包含密码值，配置失败和运行异常也输出脱敏结构化结果。updater 在执行 extra smoke 时会把目标版本注入 `AREAFORGE_SMOKE_EXPECTED_VERSION`，避免发布后仍按旧版本校验。

生成 redacted 记录时，先保存 smoke 输出，再用 release manifest 或显式 digest 环境变量补齐记录：

```bash
export AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly'
export AREAFORGE_SMOKE_BASE_URL=https://forge.areasong.top
export AREAFORGE_SMOKE_EMAIL=<smoke-account-email>
export AREAFORGE_SMOKE_PASSWORD_FILE=/etc/areaforge/smoke-password
export AREAFORGE_SMOKE_EXPECTED_VERSION=0.1.7
export AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none
pnpm smoke:prod-readonly:config
pnpm smoke:prod-readonly | tee /tmp/areaforge-prod-readonly-smoke.log
AREAFORGE_READINESS_RELEASE_TAG=v0.1.7 \
AREAFORGE_READINESS_GITHUB_REPO=AreaSong/AreaForge \
AREAFORGE_SMOKE_PASSWORD_FILE=/etc/areaforge/smoke-password \
AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly' \
pnpm smoke:prod-readonly:record /tmp/areaforge-prod-readonly-smoke.log > /tmp/areaforge-prod-readonly-smoke-record.txt
pnpm smoke:prod-readonly:validate /tmp/areaforge-prod-readonly-smoke-record.txt
```

`pnpm smoke:prod-readonly:validate` 会强制 OPS-001 smoke proof 默认 24 小时内有效；超期记录只能作为历史 evidence，不会让 `pnpm ops:ops-001:preflight` 进入 `ready_for_human_close`。

优先使用 `AREAFORGE_SMOKE_PASSWORD_FILE`，不要把 smoke 密码写入 Git、Release 记录、updater 日志或 shell history。若要做创建任务、计时、附件上传或 AI 外呼等写入型 smoke，应使用专门 smoke 账号和单独确认的写入策略；默认 `smoke:prod-readonly` 不污染生产业务数据。

### OPS-001 只读证据导出

当需要关闭或复核 `AF-RISK-OPS-001`，且生产 `status.json`、smoke 密码文件和 `/opt/areaforge` 均为 root-only 时，管理员可在服务器上运行只读导出 helper：

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-ops001-evidence-export.sh \
  --config /etc/areaforge/updater.env \
  --state-dir /opt/areaforge/ops-state \
  --output-dir /tmp/areaforge-ops001-$(date -u +%Y%m%d%H%M%S)
```

该 helper 只读取 updater 配置、`ops-state/status.json` 和 smoke 密码文件，通过 `pnpm smoke:prod-readonly` 执行只读 HTTP smoke，并生成 redacted update-agent status、生产只读 smoke record、operational evidence bundle 和 OPS-001 closure packet。它不会执行 updater `check/apply`、不会处理 Web 更新请求、不会运行 migration、不会备份/恢复、不会回滚、不会写数据库或上传目录，也不会修改 residual 台账。

helper 依赖生产主机或受控 release 工作目录能执行仓库 `pnpm` 脚本。运行前必须确认 `/etc/areaforge/updater.env` 已配置 `AREAFORGE_EXTRA_SMOKE_COMMAND`、`AREAFORGE_SMOKE_BASE_URL`、`AREAFORGE_SMOKE_EMAIL`、权限收紧的 `AREAFORGE_SMOKE_PASSWORD_FILE`、期望版本和 `AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none`。若缺少 host-level `pnpm`、extra smoke command、smoke email 或 smoke password file，只能形成 blocker 证据，不能生成 OPS-001 收口包；2026-07-11 的阻塞记录见 `docs/development/ops-001-production-readonly-attempt-20260711.md`。

如果生产主机无法运行 Node.js/pnpm，可先使用只读 curl fallback helper 导出本地生成器可消费的 redacted 输入：

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-ops001-readonly-fallback.sh \
  --config /etc/areaforge/updater.env \
  --state-dir /opt/areaforge/ops-state \
  --output-dir /tmp/areaforge-ops001-fallback-$(date -u +%Y%m%d%H%M%S)
```

fallback helper 只读取 updater 配置、`ops-state/status.json` 和 smoke 密码文件，通过 curl 执行与 `pnpm smoke:prod-readonly` 等价的只读 HTTP 检查，输出 `redacted-update-status.json`、`remote-prerequisites.json`、可选 `prod-readonly-smoke-output.log` 和 `remote-summary.txt`。它不生成最终 smoke record、operational evidence bundle 或 closure packet；这些仍需把 redacted 输出复制回本地后运行 `pnpm ops:ops-001:fallback:finalize <redacted-fallback-dir> [output-dir]`，或手动运行 `pnpm smoke:prod-readonly:record`、`pnpm ops:evidence:bundle` 和 `pnpm ops:ops-001:closure`。从 fallback 输出生成 smoke record 时设置 `AREAFORGE_PROD_READONLY_SMOKE_COMMAND=ops/update-agent/areaforge-ops001-readonly-fallback.sh`，并设置 `AREAFORGE_UPDATE_RECORD_SUMMARY="redacted update-agent status hash sha256:<64 hex>"` 或等价 redacted update record hash，使 `smokeCommand` 和 `updateRecordSummary` 准确标注证据来源。缺少 smoke 配置时，fallback helper 只形成 blocked evidence，不能关闭 `AF-RISK-OPS-001`。

交互 SSH 场景下，先在 TTY 中运行 `sudo -v`，再执行 fallback helper。输出目录必须是 `/tmp/areaforge-ops001-fallback-*`，helper 会把 redacted 输出目录移交给触发 sudo 的用户，并在 `remote-summary.txt` 记录 `redactedHandoffStatus`。该状态为 `granted` 后，维护者可直接 `scp -r` 该 redacted 目录回本地；若状态为 `skipped-*` 或 `failed`，不要追加链式 `sudo tar/chown`，应修正输出目录或重新通过交互 TTY 采集。

如果当前确认范围禁止读取 smoke 密码文件，不能使用上述 fallback 执行 authenticated smoke。此时只能导出无 secret 的 release/update 证据摘要，用于补齐 release record 的 root-only backup hash 或 update-agent redacted status 输入：

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-release-evidence-redacted-export.sh \
  --update-record /opt/areaforge/backups/github-release-updates/github-0.1.7-20260712112325/update-record.txt \
  --status /opt/areaforge/ops-state/status.json \
  --output-dir /tmp/areaforge-release-evidence-redacted-$(date -u +%Y%m%d%H%M%S)
```

该 helper 不 source `/etc/areaforge/updater.env`，不读取 `AREAFORGE_SMOKE_PASSWORD_FILE`，不重新登录，不执行 smoke；它只从 update-record 输出 allowlist 字段、生成 redacted update-agent status，并在存在既有 extra smoke 日志时只保留 `PASS/FAIL` 行和最终 JSON。输出目录必须是 `/tmp/areaforge-release-evidence-redacted-*`，导出文件不得包含 root-only backup/config/smoke log 绝对路径。输出复制回本地后，先运行：

```bash
pnpm release:evidence:redacted-export:validate /path/to/areaforge-release-evidence-redacted-<timestamp>
```

validator 会检查目录文件、backup hash、redacted update-agent status、既有 smoke 输出摘要、smoke `checkedAt >= update-record updatedAt`、summary safety facts 和敏感值泄露，并只输出 hash 字段和 redacted path presence，不打印 root-only 绝对路径。若既有 smoke log 缺失，helper 可生成占位输出用于诊断，但 validator 会失败，不能用于 release evidence completion。通过后可生成 release record 修订稿：

```bash
pnpm release:evidence:redacted-export:record \
  /path/to/areaforge-release-evidence-redacted-<timestamp> \
  docs/development/release-v0.1.7-record.md \
  /tmp/release-v0.1.7-record.redacted-draft.md \
  /path/to/attachment-reconciliation.csv \
  /path/to/attachment-reconciliation-summary.json
pnpm release:evidence:validate /tmp/release-v0.1.7-record.redacted-draft.md /path/to/attachment-reconciliation.csv /path/to/attachment-reconciliation-summary.json
```

生成器只消费 allowlisted safe fields、redacted status、bounded smoke output 和已独立生成的附件双向 reconciliation CSV/summary，默认拒绝覆盖原 release record；redacted updater export 本身不读取上传目录，也不能伪造 `not-applicable`。它会写入 redacted backup hash/path presence、redacted update-record hash、附件对账路径/status/hash 绑定、`releaseEvidenceRedactedExportHash`、`releaseEvidenceRedactedRecordMode`、`releaseEvidenceRedactedRecordDoesNotProve`、`releaseEvidenceRedactedRecordClosesResidual: no`、`releaseEvidenceRedactedRecordResidualLedgerUpdated: no` 和计算后的 `releaseEvidenceBundleHash`，随后立即运行 `pnpm release:evidence:validate` 复核 hash 一致性。该链路可用于 release record backup hash 补全和 `AREAFORGE_UPDATE_RECORD_SUMMARY` 摘要；它不能单独生成 `prod-readonly-smoke-record.txt`、`operational-evidence-bundle.json` 或 `ops-001-closure-packet.txt`，也不能关闭 `AF-RISK-OPS-001` 或支撑长期运营完成声明。仓库侧回归入口是 `pnpm release:evidence:redacted-export:selftest` 和 `pnpm release:evidence:redacted-export:record:selftest`，发布/updater 门禁会通过 `pnpm shellcheck:updater` 和 `pnpm github-release-updater:preflight` 检查该 helper 与生成器。

导出后只把生成目录里的 redacted 文件复制回本地或运维记录；不要复制 `/etc/areaforge/updater.env`、smoke 密码文件、生产 `.env`、数据库 dump、原始日志或附件内容。维护者复核时仍需运行：

```bash
pnpm smoke:prod-readonly:validate <prod-readonly-smoke-record.txt>
pnpm update-agent:status:validate <redacted-update-status.json>
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
AREAFORGE_OPS001_SMOKE_RECORD=<prod-readonly-smoke-record.txt> \
AREAFORGE_OPS001_UPDATE_STATUS_RECORD=<redacted-update-status.json> \
AREAFORGE_OPS001_EVIDENCE_BUNDLE=<operational-evidence-bundle.json> \
AREAFORGE_OPS001_CLOSURE_PACKET=<ops-001-closure-packet.txt> \
pnpm ops:ops-001:preflight
pnpm ops:ops-001:closure:validate <ops-001-closure-packet.txt>
```

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
  "sbomAsset": "areaforge-sbom.spdx.json",
  "provenanceAsset": "areaforge-provenance.json",
  "autoApply": {
    "patch": true,
    "minor": false,
    "major": false
  }
}
```

## 应用内版本中心

AreaForge 首页品牌旁的版本徽标会展开轻量版本弹层，展示当前版本、最新 Release、阻塞原因、最近操作、检查更新、应用更新、查看发布和版本回退入口。`/settings` 页面提供完整版本中心，可以额外保存自动更新策略。两个入口都不会直接执行服务器命令；入队前会先做本地只读状态校验，同版本或旧版本 `apply`、无回退目标的 `rollback`、未变化的自动策略会直接返回明确错误，不写 request 文件。`status.blocker` 非空或最近操作为 `needs_reconciliation` 时只允许 `check`，服务端拒绝 `apply`、`rollback` 和策略变更；缺少可验证 snapshot 时只允许发布 V1 只读 check，stale/unknown snapshot 的 mutation 在服务端 admission 同样 fail closed。当前 UI/API 只开放 `none` 与 `patch`，`minor/all` 仅作为旧状态兼容显示，不允许新提交。策略变化还需要用户二次确认。提交请求后 UI 对 `queued` / `running` 状态进行有上限的只读轮询；只有完整 queued request 或有效 error response 才会结束客户端幂等 attempt，无效响应继续保留原 key。`needs_reconciliation` 会显示脱敏 reason code 和执行边界状态，并阻塞后续 mutation。rollback 状态只暴露来自 `updatedAt` 最新候选记录、带 immutable GHCR digest 且 image tag 与 target version 一致的目标；通过校验的请求才会写入受控状态目录：

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
- root agent 读取请求、执行更新动作、移动历史请求并回写 `status.json`；写入 `lastOperation.message` 前会对常见 URL、token、password、secret 和 bearer 片段做 best-effort 脱敏，但原始 updater 日志、配置文件、smoke 密码文件和备份目录仍不得复制到 Web runtime 或公开记录。
- root agent 会再次校验请求 JSON 的 `id`、`action`、`tag`、`autoApply` 和 actor hash 形态；无效请求会被归档为 failed，不执行 updater、回滚或配置修改。
- 服务器侧 updater 仍是最终保护层：未带 `--force` 时，当前版本或旧版本 `apply` 会失败，不执行备份、migration 或 Web 切换。
- 不挂载 `docker.sock` 到 Web 容器。
- 不在 Web API 中执行 `docker compose`、`pg_dump`、`prisma migrate deploy` 或恢复命令。

若把 `$AREAFORGE_OPS_STATE_DIR/status.json` 或服务器侧等价摘要作为运维交接证据，先复制成 redacted JSON，并按 `docs/development/update-agent-status-record-template.md` 运行：

```bash
pnpm update-agent:status:record /path/to/status.json > /path/to/redacted-update-status.json
pnpm update-agent:status:validate /path/to/redacted-update-status.json
```

该校验只读取本地 JSON，检查版本、`autoApply=none`、`signatureRequired=true`、timer、`blocker=null`、rollback digest 和安全事实；它不执行 updater check/apply，不修改自动策略，不连接生产，不写生产。

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
- release manifest、SBOM、provenance、checksums、signature。
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
