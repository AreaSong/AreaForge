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
- 发布证据记录能通过 `pnpm release:evidence:validate <release-record.txt> [attachment-reconciliation.csv]`，并包含数据库/上传目录/生产 `.env` 备份 hash、compose/Nginx 副本路径、migration runner 和回滚演练字段。

## 命令模板

以下命令只作为 Package E 确认后的执行参考；确认前不得在生产环境运行。

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

Package E 收口前，发布记录必须通过只读校验：

```bash
pnpm release:evidence:validate <release-record.txt> [attachment-reconciliation.csv]
```

校验记录中必须包含 `envBackupSha256`、`composeConfigBackupPath`、`nginxConfigBackupPath`、`migrationRunner`、`rollbackPlan`、`rollbackDrillResult`、`rollbackDurationMinutes`、`databaseRestoreRequired`、`uploadsRestoreRequired` 和 `rollbackFailureReason`。该命令只读取发布记录和可选对账 CSV，不执行备份、恢复、migration、文件移动或 metadata 修复。

## 回滚

- 保留上一个 Docker 镜像 tag。
- migration 涉及破坏性字段时先写回滚说明。
- 第一版避免不可逆 migration。
