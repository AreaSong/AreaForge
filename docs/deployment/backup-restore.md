# 备份与恢复

## 备份对象

- PostgreSQL 数据库。
- 上传文件目录。
- 生产 `.env`。
- 当前部署版本 tag。
- 当前 `docker-compose.prod.yml` 和 Nginx 配置副本。

## 策略

- 每天自动 `pg_dump`。
- 至少保留 14 天。
- 上传目录与数据库同周期备份。
- 正式发布前生成手动备份点。

## 恢复验证

备份必须能恢复到临时库并启动应用，才算有效。

恢复演练至少验证：

- 数据库可导入。
- 附件 metadata 和文件本体能对应。
- 首页能读取数据。
- 登录仍可用。
- 附件对账只生成报告，不自动修复 metadata、不删除孤儿文件、不移动上传目录文件。
- 发布证据记录能通过 `pnpm release:evidence:validate <release-record.md|txt> [attachment-reconciliation.csv]`，并包含数据库/上传目录/生产 `.env` 备份 hash、compose/Nginx 副本路径、migration runner 和回滚演练字段。

例行月度或维护窗口恢复演练不复用发布记录作为唯一证据；使用 `docs/development/restore-drill-record-template.md` 记录非生产或临时环境恢复演练，并运行：

```bash
pnpm restore:drill:validate <restore-drill-record.md|txt>
```

该校验只读取 redacted 记录，不执行 restore、不删除备份、不移动上传目录、不连接生产、不写生产；它不能授权生产恢复。

## Metadata-only 预览

需要把当前备份/恢复证据缺口交接给维护者时，使用本地 metadata-only 预览：

```bash
pnpm ops:backup-restore:preview > /path/to/backup-restore-preview.json
pnpm ops:backup-restore:preview:validate /path/to/backup-restore-preview.json
```

默认读取 `docs/development/release-v0.1.7-record.md` 中的备份 hash、配置副本和回滚目标字段；如已有 redacted 恢复演练记录，可设置：

```bash
AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD=/path/to/restore-drill-record.txt \
pnpm ops:backup-restore:preview > /path/to/backup-restore-preview.json
```

该预览只生成 `metadata_only_backup_restore_preview` JSON，分类 `root_only`、`missing`、`present` 或 `invalid` 证据项，并写明 `blockingGaps`、`doesNotProve`、`forbiddenActions` 和只读 `safetyFacts`。`blockingGaps` 只从 `evidenceInventory` 派生，用 `gapType`、`sourceInput`、`sourceField`、`safeEvidence` 和稳定 `blocks` 枚举列出哪些 backup hash、root-only 记录、恢复演练或 rollback 缺口会阻塞 release evidence validator、long-term live gate、restore drill claim 或 maintenance handoff；它不读取备份归档、数据库 dump、上传文件、生产 `.env` 或密钥，不连接生产，不执行服务器命令，不备份、不恢复、不运行 migration、不回滚、不修改 residual 台账。validator 通过只说明预览形态安全，不能证明备份归档存在、恢复 dry-run 成功、生产 restore 已授权或长期运营 live gate 通过。

输入文件必须是仓库内或系统临时目录中的 redacted `.md` / `.txt` / `.json` 记录。脚本会拒绝 `.env`、`updater.env`、password/secret/token 命名文件、dump/archive/log/key 文件、上传/备份目录路径和包含数据库 URL、私钥或常见 secret assignment 的内容。显式设置 `AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD` 后，如果文件缺失或不符合 redacted record 规则，命令必须失败，而不是静默当作未提供。即使 preview `status=ready`，`pnpm ops:readiness:summary` 也只能把它当 metadata-only 证据降级为 `warn` / 高风险 scope 下 `blocked`；真实 backup pass 仍需要独立的新鲜备份 hash 或发布/恢复证据链。

## 命令模板

以下命令只作为生产备份、恢复演练和发布记录的手动参考。Package E 已完成；后续任何真实生产备份恢复、破坏性恢复、备份策略变化或服务器命令执行，仍必须按高风险确认流程说明影响、风险、验证和回滚后再执行。

数据库备份：

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl \
  > "$BACKUP_DIR/areaforge-$(date +%Y%m%d%H%M%S).dump"
```

上传目录归档：

```bash
tar -C "$(dirname "$UPLOAD_DIR")" -czf "$BACKUP_DIR/uploads-$(date +%Y%m%d%H%M%S).tar.gz" "$(basename "$UPLOAD_DIR")"
```

临时库恢复演练：

```bash
createdb "$POSTGRES_DB"_restore_check
pg_restore --clean --if-exists --no-owner --dbname "$POSTGRES_DB"_restore_check "$DATABASE_BACKUP_PATH"
```

临时上传目录恢复演练：

```bash
mkdir -p "$UPLOAD_DIR.restore-check"
tar -xzf "$UPLOADS_BACKUP_PATH" -C "$UPLOAD_DIR.restore-check"
```

## 对账报告格式

附件 metadata 与文件本体对账只生成报告，不自动修复：

```text
attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action
```

`action` 第一版固定为 `report_only`。孤儿文件清理、metadata 修复或批量删除必须另行确认。

若恢复演练使用临时脚本或 SQL 生成对账报告，脚本必须只读数据库和文件系统；不得在同一次演练中执行删除、移动、重命名、补写 metadata 或重新计算后覆盖数据库 hash。

推荐命令：

```bash
DATABASE_URL="$RESTORE_DATABASE_URL" \
  pnpm exec tsx scripts/quality/attachment-reconciliation.ts \
  "$RESTORED_UPLOAD_DIR" \
  "$BACKUP_DIR/attachment-reconciliation.csv"
```

`scripts/quality/attachment-reconciliation.ts` 只读取 `Attachment` metadata 和恢复后的上传目录，输出 `report_only` CSV；没有附件记录时可以输出仅表头报告。

## 发布证据校验

每次正式发布记录都必须通过只读校验。Package E 本机发布/回滚记录和远端 `v0.1.5` 历史记录已完成对应证据收口；当前 `v0.1.7` 生产更新已有服务器侧 apply、公网 health、extra smoke 和供应链记录，但因 root-only 备份 hash 未复制入仓库，`docs/development/release-v0.1.7-record.md` 仍应保持 release evidence validator 失败，直到补齐 redacted backup hash 证据。后续 release 仍继续要求：

```bash
pnpm release:evidence:validate <release-record.md|txt> [attachment-reconciliation.csv]
```

校验记录中必须包含 `envBackupSha256`、`composeConfigBackupPath`、`nginxConfigBackupPath`、`migrationRunner`、`rollbackPlan`、`rollbackDrillResult`、`rollbackDurationMinutes`、`databaseRestoreRequired`、`uploadsRestoreRequired` 和 `rollbackFailureReason`。该命令只读取发布记录和可选对账 CSV，不执行备份、恢复、migration、文件移动或 metadata 修复。

## 回滚

- 保留上一个 Docker 镜像 tag。
- migration 涉及破坏性字段时先写回滚说明。
- 第一版避免不可逆 migration。
