# 生产发布、备份与恢复 Runbook

## 状态

本文件是 `tasks/backlog/0014-deployment-backup-release.md` 和 `workflow/versions/v1.0-prod-release.md` 的生产发布、备份与恢复 runbook。Package E E1-E4 已完成本机单机生产发布、备份、恢复和回滚证据；远端 `https://forge.areasong.top/` 已通过 GitHub Release `v0.1.5` 完成签名校验更新并运行 `0.1.5`。

后续任何新的生产发布、备份恢复、migration deploy、服务器命令、签名策略降级或 Web 运维能力扩大，仍必须等用户明确确认后再执行。

## 目标

把 AreaForge 部署为可运行、可备份、可恢复、可回滚的私有 Web 应用。

当前远端目标已经落地：

- 公网入口：`https://forge.areasong.top/`
- AreaForge 本机端口：`127.0.0.1:3020`
- 当前线上版本：`0.1.5`
- 最新 Release：`v0.1.5`
- 更新记录：`docs/development/package-e-remote-github-release-record.md`

目标架构：

```text
Nginx HTTPS -> 127.0.0.1:WEB_PORT -> web container -> postgres
                                              |
                                              -> uploads volume
```

## 发布前门禁

- GitHub Release workflow 必须先通过 `validate` job，再构建和发布镜像；stable release 缺少 `COSIGN_PRIVATE_KEY_B64` 或 `COSIGN_PRIVATE_KEY` 时必须失败。
- `pnpm check` 通过。
- `pnpm governance:preflight` 通过。
- `pnpm ops:readiness` 通过；该命令只检查长期运营证据入口和 release hard gate，不连接生产。
- `pnpm package-e:preflight` 通过；该命令只做本地 release artifact 结构检查和 compose config，不执行生产部署、备份、恢复或 migration。
- `docker compose config` 通过。
- `docker compose --env-file .env.example -f docker-compose.prod.yml config` 通过，用占位值验证生产 compose 结构。裸跑 `docker compose -f docker-compose.prod.yml config` 若没有生产 env，预期会因 `AUTH_SESSION_SECRET is required` 等 required production env 缺失而失败。
- 所有需要的 migration 已审查；高风险 migration 已有备份和回滚说明。
- 生产 `.env` 已准备，权限收紧，不提交到 Git。
- `APP_URL`、`AUTH_SESSION_SECRET`、`POSTGRES_PASSWORD` 使用真实生产值或强随机密钥；`AI_API_KEY` 仅在 `AI_ENABLED=true` 时必须使用真实密钥。
- `AREAFORGE_IMAGE` 使用固定版本 tag，不使用 `latest`。
- 上传目录和数据库卷位置明确。

## 备份对象

发布前必须备份：

- PostgreSQL 数据库。
- 上传目录或 Docker volume。
- 生产 `.env`。
- 当前部署版本 tag / 镜像 digest。
- 当前 `docker-compose.prod.yml` 和 Nginx 配置副本。

每日备份：

- `pg_dump`。
- 上传目录同周期归档。
- 至少保留 14 天。

## 发布流程

建议流程：

1. 进入服务器部署目录。
2. 记录当前版本：
   - 当前 `AREAFORGE_IMAGE`。
   - 当前 compose 文件 hash。
   - 当前 git commit 或 release tag。
3. 执行发布前备份：
   - 数据库 dump。
   - 上传目录归档。
   - `.env` 加密或权限收紧备份。
4. 拉取或加载新镜像。
5. 本地或确认前结构校验执行 `docker compose --env-file .env.example -f docker-compose.prod.yml config`；生产服务器执行时必须使用真实生产 `.env`，不得复用 `.env.example` 的占位密钥。
6. 如有 migration：
   - 确认备份点存在。
   - 先确认 migration deploy 的执行载体。
   - 在明确包含 Prisma CLI、`prisma/migrations`、workspace 依赖和生产 `DATABASE_URL` 的一次性任务或受控 release 环境中执行 Prisma migrate deploy。
7. 启动新版本：
   - `docker compose -f docker-compose.prod.yml up -d`
8. 发布后烟测。
9. 记录发布结果和残余风险。

注意：

- 不通过网页按钮触发部署、migration、备份或恢复。
- PostgreSQL 不暴露公网端口。
- 上传目录不由 Nginx 静态暴露。

## GitHub Release 受控自动更新

GitHub Release 自动更新不改变上述高风险边界。AreaForge Web 页面和 Web API 只能提交受控请求、读取状态或保存自动策略，不能直接执行 Docker、备份、恢复、migration、回滚或服务器命令；真正执行更新的只能是服务器侧 updater、root agent 或 CI/CD 手动批准流水线。

第一版实现见：

- `docs/development/github-release-updater-design.md`
- `docs/deployment/github-release-updater.md`
- `ops/github-release-updater/areaforge-updater.sh`
- `.github/workflows/release.yml`
- `infra/docker/migration.Dockerfile`

GitHub Release 必须发布以下 assets：

- `areaforge-release-manifest.json`
- `areaforge-sbom.spdx.json`
- `areaforge-provenance.json`
- `SHA256SUMS`
- `SHA256SUMS.sig`（cosign bundle）
- `docker-compose.prod.yml`

服务器侧 updater 必须：

1. 校验 Release 非 draft，非 prerelease 时才按 stable 策略处理。
2. 校验 manifest channel、`minimumAppVersion`、非 `latest` 镜像、`webImageDigest` 和 `migrationImageDigest`。
3. 校验 `SHA256SUMS` 和 `SHA256SUMS.sig`，确认 SBOM/provenance 也在 checksum 文件中；生产默认 `AREAFORGE_REQUIRE_SIGNATURE=true`，cosign 模式使用 `verify-blob --bundle`。
4. 先备份 PostgreSQL、上传 volume、生产 env、compose、Nginx 和 release assets。
5. 使用一次性 migration image 执行 `pnpm db:migrate:deploy`，日志中只能显示 `DATABASE_URL=<redacted>`。
6. 写入 `AREAFORGE_IMAGE=<image@sha256>` 和 `APP_VERSION=<version>` 后启动 web。
7. 执行 `/api/health` 和可选 `AREAFORGE_EXTRA_SMOKE_COMMAND`；仓库提供的默认只读命令是 `pnpm smoke:prod-readonly`，应通过 `AREAFORGE_SMOKE_PASSWORD_FILE` 读取 smoke 密码。
8. 失败时回滚应用镜像和 `APP_VERSION`，记录失败原因；默认不自动恢复生产数据库或移动上传目录。

自动策略：

- `AREAFORGE_AUTO_APPLY=none`：默认，只检查和记录。
- `AREAFORGE_AUTO_APPLY=patch`：只允许 manifest `autoApply.patch=true` 的 patch 版本自动应用。
- `minor` / `all` 只能在明确接受风险后启用。

只读门禁：

```bash
pnpm github-release-updater:preflight
```

该命令只检查 updater 结构、shell 语法、manifest 示例、workflow、migration image、文档和 Web 无运维入口边界，不连接 GitHub、不执行 Docker、不备份、不恢复、不运行 migration。

### 标准发版路径

后续功能完成后，推荐按以下路径发布：

1. 同步相关 docs/tasks/workflow，确认没有源事实漂移。
2. 运行 `pnpm check`、`pnpm governance:preflight`、`pnpm ops:readiness`、`pnpm github-release-updater:preflight`、`pnpm shellcheck:updater` 和必要的专项测试。
3. bump 所有 AreaForge workspace package version。
4. 提交干净 commit。
5. 创建并推送 `vX.Y.Z` tag；tag 版本必须和根 `package.json` 版本一致。
6. 等待 GitHub Release workflow 成功，确认 Release assets 包含 `areaforge-release-manifest.json`、`areaforge-sbom.spdx.json`、`areaforge-provenance.json`、`docker-compose.prod.yml`、`SHA256SUMS`、`SHA256SUMS.sig`。
7. 本地或 CI 验证 `sha256sum -c SHA256SUMS` 和 `cosign verify-blob --bundle SHA256SUMS.sig SHA256SUMS`。
8. 在 Web 版本中心提交受控更新请求，或由管理员执行服务器侧 updater。
9. 服务器 update-agent/updater 校验签名、备份、执行 migration、切换镜像和 health smoke。
10. 验证 `https://forge.areasong.top/api/health`、`/opt/areaforge/ops-state/status.json` 和 Release 更新记录。

## 发布记录模板

Package E 完成时必须留下发布记录。每个进入线上并需要仓库可追溯证据的版本，应在 `docs/development/` 新建版本化发布记录，例如 `release-vX.Y.Z-record.md`。服务器私有备份、updater 记录和 smoke 日志可以保留在运维目录，但需在仓库记录中摘要 tag、digest、health、update-agent 状态和残余风险。记录不得提交生产 `.env`、密钥、数据库 URL 或备份文件本体。

标准模板见 `docs/development/release-record-template.md`。下方字段与模板和只读校验脚本保持一致；后续新版本优先复制模板，再填入真实 Release、备份、smoke、回滚和残余风险证据。

```text
releaseId:
releasedAt:
operator:
gitCommit:
releaseTag:
AREAFORGE_IMAGE:
imageDigest:
webImageDigest:
migrationImageDigest:
sbomAsset:
sbomSha256:
provenanceAsset:
provenanceSha256:
supplyChainEvidence:
composeHash:
nginxConfigHash:
previousImage:
previousAppVersion:
databaseBackupPath:
databaseBackupSha256:
uploadsBackupPath:
uploadsBackupSha256:
envBackupPath:
envBackupSha256:
composeConfigBackupPath:
nginxConfigBackupPath:
migrationVersion:
migrationApplied: yes/no
migrationRunner: controlled_release_workdir/one_off_migration_job/not-applicable
preflight:
  pnpmCheck:
  composeConfig:
  prodComposeConfig:
restoreDrill:
  databaseImported: yes/no
  uploadsRestored: yes/no
  attachmentHashMatched: yes/no/not-applicable
postReleaseSmoke:
  health:
  login:
  dashboard:
  taskTimerReview:
  syllabusNotesAnalyticsReports:
  attachmentSmoke:
  aiFallbackOrProvider:
rollbackDecision:
rollbackPlan:
rollbackDrillResult:
rollbackDurationMinutes:
databaseRestoreRequired: yes/no
uploadsRestoreRequired: yes/no
rollbackFailureReason:
residualRisk:
residualRiskIds:
releaseEvidenceBundleHash:
followUpTasks:
expectedFailureOrStopConditions:
  migrationFailed:
  smokeFailed:
  logLeakDetected:
  attachmentHashMismatch:
  backupMissing:
```

发布记录写完后，可以用只读校验脚本检查字段完整性、hash 形态、枚举值、migration runner 选择、回滚演练字段、敏感值泄露和附件对账边界：

```bash
pnpm release:evidence:validate <release-record.md|txt> [attachment-reconciliation.csv]
```

该脚本只读取发布记录和可选附件对账 CSV，不连接生产服务，不执行 `docker compose`、`pg_dump`、`pg_restore`、migration deploy、文件删除、文件移动或 metadata 修复。附件对账 CSV 的 `action` 必须全部为 `report_only`。若 `migrationApplied=yes`，`migrationRunner` 必须是 `controlled_release_workdir` 或 `one_off_migration_job`；若 `migrationApplied=no`，`migrationRunner` 必须是 `not-applicable`。

中止条件：

- migration 失败或 Prisma Client 与 schema 不匹配。
- 登录、首页、任务计时复盘任一发布后烟测失败。
- 日志中出现密钥、完整 prompt、完整复盘正文、附件路径或数据库 URL。
- 附件 metadata/hash 与文件不一致。
- 发布前数据库备份、上传目录备份或上一版本镜像信息缺失。
- `pnpm ops:readiness` 失败，或残余风险台账显示当前发布阻塞项。

## Batch E1-E4 交付物

Package E 可以一次性确认，也可以逐批确认。逐批执行时，每批只留下对应证据，不能提前把 Package E 标为完成。

| 批次 | 交付物 | 禁止事项 |
|---|---|---|
| Batch E1 生产配置与发布工件预检 | `pnpm check`、`pnpm package-e:preflight`、compose config、生产 env 清单、`AREAFORGE_IMAGE` 固定 tag、镜像 digest 获取方式、Nginx 配置检查、migration deploy 执行载体选择、发布记录草案和中止条件 | 不执行生产部署，不运行生产 migration，不触碰生产数据库或上传目录 |
| Batch E2 发布前备份与恢复演练 | PostgreSQL dump、上传目录归档、生产 `.env` 权限收紧备份、compose/Nginx 副本、临时库导入、临时上传目录恢复、附件 metadata/hash 只读 `report_only` 对账 | 不覆盖生产库，不删除生产备份，不自动修复 metadata，不移动上传文件，不执行应用切换 |
| Batch E3 生产发布与 migration deploy | 备份点校验、受控 release 工作目录或一次性 migration job、必要 additive migration deploy、compose/Nginx 切换、发布后烟测、日志脱敏检查 | 不执行无备份 migration，不公开 PostgreSQL，不静态暴露上传目录，不把密钥或数据库 URL 写入记录 |
| Batch E4 回滚演练与 Package E 收口 | 上一镜像 tag、回滚步骤、是否需要数据库/上传目录恢复、失败原因、恢复耗时、残余风险、文档同步、completion record 证据 | 不新增网页内一键更新；准确说，不新增 Web runtime 直接执行服务器命令的一键更新，不新增网页服务器命令入口，不把未来未确认的自动应用能力算入生产完成 |

Package E 完成证据至少要能回答：

- 这次发布使用哪个 commit、tag、镜像 digest、compose hash 和 Nginx 配置 hash。
- 备份文件在哪里、hash 是什么、生产 `.env`、compose 和 Nginx 副本在哪里，是否能导入临时库、上传目录是否能恢复到临时目录。
- migration deploy 是由受控 release 工作目录还是一次性 migration job 执行。
- 发布后哪些页面/API 做了烟测，失败时回滚到哪个上一镜像 tag，回滚步骤是否演练、耗时多少、是否需要恢复数据库或上传目录。
- 附件对账是否只输出 `report_only`，没有自动删除、修复或移动文件。

## Migration deploy 边界

必须确认：

- migration 是否 additive。
- 是否包含不可逆字段删除或数据压缩。
- 是否需要旧数据回填。
- 失败时能否回滚应用镜像并保留新增字段。
- migration deploy 的执行载体。当前 `infra/docker/web.Dockerfile` 的 runner 只复制 Next standalone 运行产物，不能默认视为可执行 `pnpm db:migrate:deploy` 的环境。

生产执行前：

- 数据库备份必须存在。
- 上传目录备份必须存在。
- 当前版本 tag 必须记录。

允许的 migration deploy 执行载体必须二选一并写入发布记录：

- 受控 release 工作目录：包含完整仓库、`pnpm-lock.yaml`、`prisma/migrations` 和已安装依赖；通过生产 `DATABASE_URL` 执行 `pnpm db:migrate:deploy`。
- 一次性 migration 镜像或 job：镜像内显式包含 Prisma CLI、`prisma/schema.prisma`、`prisma/migrations`、`packages/db` 和必要 Node 依赖；执行后退出，不作为常驻 Web 服务。

禁止事项：

- 不在未确认备份点时运行生产 migration。
- 不假设 standalone Web runtime 镜像具备 `pnpm`、Prisma CLI 或 migration 文件。
- 不通过网页 API、按钮或管理页面触发 migration。
- 不把生产 `DATABASE_URL`、密钥或完整命令输出提交到仓库。

## 恢复演练

恢复不直接覆盖生产，先在临时库和临时上传目录验证。

步骤：

1. 创建临时 PostgreSQL 数据库。
2. 导入最近一次 `pg_dump`。
3. 准备临时上传目录或临时 volume。
4. 启动应用连接临时库和临时上传目录。
5. 验证：
   - 登录可用。
   - 首页可读取数据。
   - 任务、计时、复盘可读取。
   - 附件 metadata 指向的文件存在。
   - 文件 hash 与 metadata 一致。
   - 附件对账只生成 `report_only` 报告，不自动删除孤儿文件、不修复 metadata、不移动上传文件。
6. 验证完成后删除临时库和临时上传目录。

不得在未验证前直接覆盖生产库。

恢复演练验收判定表：

| 项目 | 判定 |
|---|---|
| 数据库 dump 可导入临时库 | PASS / FAIL |
| 上传目录或 volume 可恢复到临时目录 | PASS / FAIL |
| metadata 指向文件存在 | PASS / FAIL |
| metadata/hash/size 与文件一致 | PASS / FAIL |
| 登录、首页、任务、计时、复盘可读 | PASS / FAIL |
| 附件下载鉴权和响应头可用 | PASS / FAIL / not-applicable |
| AI fallback 或 provider 策略与生产配置一致 | PASS / FAIL |

## 备份与恢复命令模板

以下命令只作为确认后执行参考。确认前不得在生产服务器运行。

```bash
# 记录 compose hash 和镜像 digest
sha256sum docker-compose.prod.yml
docker image inspect "$AREAFORGE_IMAGE" --format '{{index .RepoDigests 0}}'

# 发布前数据库备份
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl \
  > "$BACKUP_DIR/areaforge-$APP_VERSION-$(date +%Y%m%d%H%M%S).dump"

# 上传目录归档
tar -C "$(dirname "$UPLOAD_DIR")" -czf "$BACKUP_DIR/uploads-$APP_VERSION-$(date +%Y%m%d%H%M%S).tar.gz" "$(basename "$UPLOAD_DIR")"

# 恢复演练：导入临时库
createdb "$POSTGRES_DB"_restore_check
pg_restore --clean --if-exists --no-owner --dbname "$POSTGRES_DB"_restore_check "$DATABASE_BACKUP_PATH"

# 恢复演练：准备临时上传目录
mkdir -p "$UPLOAD_DIR.restore-check"
tar -xzf "$UPLOADS_BACKUP_PATH" -C "$UPLOAD_DIR.restore-check"
```

附件对账只输出报告，不自动删除或修复：

```text
attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action
...,report_only
```

推荐使用仓库内只读脚本生成对账报告：

```bash
DATABASE_URL="$RESTORE_DATABASE_URL" \
  pnpm exec tsx scripts/quality/attachment-reconciliation.ts \
  "$RESTORED_UPLOAD_DIR" \
  "$BACKUP_DIR/attachment-reconciliation.csv"
```

`scripts/quality/attachment-reconciliation.ts` 只读取恢复后的数据库和上传目录，写出 CSV 报告；`action` 固定为 `report_only`。若当前没有附件记录，可以生成 header-only 报告，并在发布记录中把 `restoreDrill.attachmentHashMatched` 标为 `not-applicable`。

## 回滚流程

如果发布后失败：

1. 停止新版本 web。
2. 将 `AREAFORGE_IMAGE` 改回上一版本 tag。
3. `docker compose -f docker-compose.prod.yml up -d web`。
4. 如果 migration 未改变数据结构或仅 additive，优先只回滚应用镜像。
5. 如果需要恢复数据库：
   - 再次确认影响。
   - 停止 web。
   - 使用发布前数据库备份恢复。
   - 同步恢复上传目录备份，保证 metadata 与文件本体一致。
6. 记录失败原因、恢复时间和残余风险。

## 生产变量检查

必须存在：

- `APP_URL`
- `APP_VERSION`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `AUTH_SESSION_SECRET`
- `AREAFORGE_IMAGE`
- `UPLOAD_DIR`
- `BACKUP_DIR`
- `BACKUP_RETENTION_DAYS`

AI 若启用还必须存在：

- `AI_ENABLED=true`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`

禁止：

- 使用本地开发 `AUTH_SESSION_SECRET`。
- 使用弱 `POSTGRES_PASSWORD`。
- 把生产 `.env` 提交到 Git。
- 在日志中打印数据库 URL、AI Key、session token。

## Nginx 检查

- `server_name` 指向真实域名。
- HTTPS 证书有效。
- `client_max_body_size` 大于 `MAX_UPLOAD_MB`，当前示例为 `25m`。
- 只反代到 `127.0.0.1:WEB_PORT`。
- 不直接暴露 `/app/uploads` 或 Docker volume。
- 安全响应头保留。

## 发布后烟测

- `GET /api/health` 成功。
- 未登录访问首页跳转登录。
- 登录成功，Cookie 为 `HttpOnly`。
- 首页加载今日作战台。
- 创建任务、开始计时、结束计时、保存复盘。
- `/syllabus`、`/notes`、`/analytics`、`/reports` 可打开。
- 若附件功能已启用：上传和下载一个小测试文件，再删除测试数据需单独确认。
- `AI_ENABLED=false` 时 AI API 返回本地 fallback。
- `AI_ENABLED=true` 时只用最小测试数据做真实 provider 烟测。

## 验收命令

本地或 CI：

- `pnpm check`
- `pnpm package-e:preflight`
- `docker compose config`
- `docker compose --env-file .env.example -f docker-compose.prod.yml config`

服务器：

- `docker compose -f docker-compose.prod.yml ps`
- `docker compose -f docker-compose.prod.yml logs --tail=100 web`
- `docker compose -f docker-compose.prod.yml logs --tail=100 postgres`

日志检查不得输出密钥、数据库 URL、AI Key、完整 prompt 或隐私正文。
