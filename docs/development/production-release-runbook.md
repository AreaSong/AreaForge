# 生产发布、备份与恢复 Runbook

## 状态

本文件是 `tasks/backlog/0014-deployment-backup-release.md` 和 `workflow/versions/v1.0-prod-release.md` 的实现前确认设计，不是已执行部署。任何生产发布、备份恢复、migration deploy 或服务器命令，都必须等用户明确确认后再做。

## 目标

把 AreaForge 部署为可运行、可备份、可恢复、可回滚的私有 Web 应用。

目标架构：

```text
Nginx HTTPS -> 127.0.0.1:WEB_PORT -> web container -> postgres
                                              |
                                              -> uploads volume
```

## 发布前门禁

- `pnpm check` 通过。
- `docker compose config` 通过。
- `docker compose --env-file .env.example -f docker-compose.prod.yml config` 通过，用占位值验证生产 compose 结构。裸跑 `docker compose -f docker-compose.prod.yml config` 若没有生产 env，预期会因 `AUTH_SESSION_SECRET is required` 等 required production env 缺失而失败。
- 所有需要的 migration 已审查；高风险 migration 已有备份和回滚说明。
- 生产 `.env` 已准备，权限收紧，不提交到 Git。
- `APP_URL`、`AUTH_SESSION_SECRET`、`POSTGRES_PASSWORD`、`AI_API_KEY` 使用强随机或真实密钥。
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
   - 在一次性任务或 web 镜像环境中执行 Prisma migrate deploy。
7. 启动新版本：
   - `docker compose -f docker-compose.prod.yml up -d`
8. 发布后烟测。
9. 记录发布结果和残余风险。

注意：

- 不通过网页按钮触发部署、migration、备份或恢复。
- PostgreSQL 不暴露公网端口。
- 上传目录不由 Nginx 静态暴露。

## 发布记录模板

Package E 完成时必须留下发布记录。记录可以放在运维私有目录或受控 issue/comment 中，不得提交生产 `.env`、密钥、数据库 URL 或备份文件本体。

```text
releaseId:
releasedAt:
operator:
gitCommit:
releaseTag:
AREAFORGE_IMAGE:
imageDigest:
composeHash:
nginxConfigHash:
previousImage:
previousAppVersion:
databaseBackupPath:
databaseBackupSha256:
uploadsBackupPath:
uploadsBackupSha256:
envBackupPath:
migrationVersion:
migrationApplied: yes/no
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
residualRisk:
followUpTasks:
expectedFailureOrStopConditions:
  migrationFailed:
  smokeFailed:
  logLeakDetected:
  attachmentHashMismatch:
  backupMissing:
```

中止条件：

- migration 失败或 Prisma Client 与 schema 不匹配。
- 登录、首页、任务计时复盘任一发布后烟测失败。
- 日志中出现密钥、完整 prompt、完整复盘正文、附件路径或数据库 URL。
- 附件 metadata/hash 与文件不一致。
- 发布前数据库备份、上传目录备份或上一版本镜像信息缺失。

## Migration deploy 边界

必须确认：

- migration 是否 additive。
- 是否包含不可逆字段删除或数据压缩。
- 是否需要旧数据回填。
- 失败时能否回滚应用镜像并保留新增字段。

生产执行前：

- 数据库备份必须存在。
- 上传目录备份必须存在。
- 当前版本 tag 必须记录。

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
- `docker compose config`
- `docker compose --env-file .env.example -f docker-compose.prod.yml config`

服务器：

- `docker compose -f docker-compose.prod.yml ps`
- `docker compose -f docker-compose.prod.yml logs --tail=100 web`
- `docker compose -f docker-compose.prod.yml logs --tail=100 postgres`

日志检查不得输出密钥、数据库 URL、AI Key、完整 prompt 或隐私正文。
