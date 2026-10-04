# Package E Batch E1 发布记录草案

## 状态

本文件是 Package E Batch E1 的发布记录草案，不是最终生产发布记录。它只记录生产配置与发布工件预检结果，不包含生产 `.env`、密钥、数据库 URL、备份文件本体或真实生产命令输出。

确认记录：用户已明确确认“确认执行 Package E Batch E1：生产配置与发布工件预检”。

E1 范围：校验 compose/Nginx/镜像 tag/生产 env 清单、migration deploy 执行载体、生成发布记录草案和中止条件；不执行生产部署、不运行生产 migration、不触碰生产数据库或上传目录。

## E1 本地预检证据

| 项目 | E1 结果 |
|---|---|
| gitCommit | `10eb159c26f876dc09685570c05b2e08ad883fce` |
| composeHash | `9412d0f7f85eb46e5f2a3904202ff06a60e0fc13bf20388f6b2a6fdabf3121c6` |
| nginxConfigHash | `34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46` |
| AREAFORGE_IMAGE | `.env.example` 和生产 compose 默认值为 `areaforge-web:0.1.0`，是显式非 `latest` tag；E3 前必须替换为实际生产固定 tag |
| imageDigest 获取方式 | E3 发布前在受控 release 环境执行 `docker image inspect "$AREAFORGE_IMAGE" --format '{{index .RepoDigests 0}}'` 或从镜像仓库读取 digest，并写入最终发布记录 |
| compose config | `docker compose --env-file .env.example -f docker-compose.prod.yml config` 通过；Web 绑定 `127.0.0.1:${WEB_PORT:-3000}:3000`，PostgreSQL 不暴露公网端口，uploads 使用私有 volume |
| Nginx | 示例配置只反代到 `127.0.0.1:3000`，保留 `client_max_body_size 25m`、HSTS、`X-Content-Type-Options`；不直接暴露 `/app/uploads` |
| Web runtime | `infra/docker/web.Dockerfile` 运行 Next standalone，非 root 用户；不包含 Prisma migration runner 能力 |
| package scripts | 根脚本不提供生产 deploy/backup/restore/compose up/down 或服务器命令入口；`db:migrate:deploy` 仅作为 Package E 确认后的受控参考 |

## 生产 env 清单

E1 仅校验清单和占位值，不读取或提交真实生产 `.env`。

必须在 E3 前以真实生产值确认：

- `APP_URL`
- `APP_VERSION`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `WEB_PORT`
- `AREAFORGE_IMAGE`
- `AUTH_SESSION_COOKIE_NAME`
- `AUTH_SESSION_SECRET`
- `AUTH_ADMIN_EMAIL`
- `AUTH_ADMIN_PASSWORD_HASH`
- `UPLOAD_DIR`
- `MAX_UPLOAD_MB`
- `ALLOWED_UPLOAD_MIME`
- `TRUST_PROXY`
- `BACKUP_DIR`
- `BACKUP_RETENTION_DAYS`

若启用真实 AI provider，还必须确认：

- `AI_ENABLED=true`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- `AI_TIMEOUT_MS`
- `AI_MAX_RETRIES`
- `AI_LOG_PROMPTS=false`
- `AI_ALLOW_SENSITIVE_CONTEXT=false`

## Migration Deploy 执行载体草案

E1 选择的推荐执行载体：`controlled_release_workdir`。

要求：

- 受控 release 工作目录必须包含完整仓库、`pnpm-lock.yaml`、`prisma/schema.prisma`、`prisma/migrations`、`packages/db` 和已安装依赖。
- 生产 `DATABASE_URL` 只在 E3 确认后的受控环境使用，不写入仓库、日志或发布记录。
- 若 E3 前改为一次性 migration job，最终发布记录必须把 `migrationRunner` 写为 `one_off_migration_job`。
- 若确认无 migration 需要执行，最终发布记录必须把 `migrationApplied` 写为 `no`，`migrationRunner` 写为 `not-applicable`。
- Standalone Web runtime 不能作为 migration runner。

## 最终发布记录草案字段

以下字段是 E1 阶段的发布记录草案模板；E2 本地受控恢复演练证据见 `docs/development/package-e-e2-restore-drill-record.md`，E3 本机生产发布证据见 `docs/development/package-e-e3-prod-local-release-record.md`，E4 本机生产回滚收口证据见 `docs/development/package-e-e4-prod-local-rollback-record.md`。E1 只确认字段完整性和敏感信息边界。

```text
releaseId: TBD_E3
releasedAt: TBD_E3
operator: TBD_E3
gitCommit: 10eb159c26f876dc09685570c05b2e08ad883fce
releaseTag: TBD_E3
AREAFORGE_IMAGE: TBD_E3_FIXED_NON_LATEST_TAG
imageDigest: TBD_E3_IMAGE_DIGEST
composeHash: 9412d0f7f85eb46e5f2a3904202ff06a60e0fc13bf20388f6b2a6fdabf3121c6
nginxConfigHash: 34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46
previousImage: TBD_E2_OR_E3
previousAppVersion: TBD_E2_OR_E3
databaseBackupPath: TBD_E2_PRIVATE_OPS_PATH
databaseBackupSha256: TBD_E2
uploadsBackupPath: TBD_E2_PRIVATE_OPS_PATH
uploadsBackupSha256: TBD_E2
envBackupPath: TBD_E2_PRIVATE_OPS_PATH
envBackupSha256: TBD_E2
composeConfigBackupPath: TBD_E2_PRIVATE_OPS_PATH
nginxConfigBackupPath: TBD_E2_PRIVATE_OPS_PATH
migrationVersion: TBD_E3_OR_NOT_APPLICABLE
migrationApplied: TBD_E3_yes_or_no
migrationRunner: controlled_release_workdir
preflight:
  pnpmCheck: PASS
  composeConfig: PASS
  prodComposeConfig: PASS
restoreDrill:
  databaseImported: TBD_E2_yes_or_no
  uploadsRestored: TBD_E2_yes_or_no
  attachmentHashMatched: TBD_E2_yes_no_or_not-applicable
postReleaseSmoke:
  health: TBD_E3_PASS_or_FAIL
  login: TBD_E3_PASS_or_FAIL
  dashboard: TBD_E3_PASS_or_FAIL
  taskTimerReview: TBD_E3_PASS_or_FAIL
  syllabusNotesAnalyticsReports: TBD_E3_PASS_or_FAIL
  attachmentSmoke: TBD_E3_PASS_FAIL_or_not-applicable
  aiFallbackOrProvider: TBD_E3_PASS_or_FAIL
rollbackDecision: TBD_E4
rollbackPlan: restore previousImage and rerun compose web, restoring database/uploads only if needed and separately confirmed
rollbackDrillResult: TBD_E4
rollbackDurationMinutes: TBD_E4
databaseRestoreRequired: TBD_E4_yes_or_no
uploadsRestoreRequired: TBD_E4_yes_or_no
rollbackFailureReason: TBD_E4_or_none
residualRisk: TBD_E4
followUpTasks: TBD_E4
expectedFailureOrStopConditions:
  migrationFailed: stop
  smokeFailed: rollback
  logLeakDetected: stop
  attachmentHashMismatch: stop
  backupMissing: stop
```

## 中止条件

- 生产 `.env` 仍含 `.env.example` 占位密钥或弱密码。
- `AREAFORGE_IMAGE` 使用 `latest` 或无法取得镜像 digest。
- `docker compose --env-file <production-env> -f docker-compose.prod.yml config` 失败。
- Nginx 配置直接暴露上传目录、启用 `autoindex` 或反代目标不是本机 Web 端口。
- migration deploy 执行载体不是受控 release 工作目录、一次性 migration job 或 `not-applicable`。
- 发布前数据库备份、上传目录备份、生产 `.env` 备份、当前镜像信息任一不存在。
- 发布后日志出现密钥、数据库 URL、完整 prompt/raw response、完整复盘正文、附件内容或附件绝对路径。
- 附件 metadata/hash/size 对账失败且无法确认只读 `report_only` 报告。

## E1 明确未执行事项

- 未执行生产部署。
- 未运行生产 migration deploy。
- 未连接、读取或修改生产数据库。
- 未读取、写入、移动或删除生产上传目录。
- 未生成真实生产备份。
- 未做发布后真实烟测或回滚演练。
