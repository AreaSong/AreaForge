# Package E Batch E2 恢复演练记录

## 状态

本文件记录 Package E Batch E2 的本地受控发布前备份与恢复演练。它不是最终生产发布记录，不包含生产 `.env`、密钥、数据库 URL、备份文件本体或附件内容。

确认记录：用户已明确确认“确认执行 Package E Batch E2：发布前备份与恢复演练”。

E2 范围：PostgreSQL dump、上传目录归档、生产 `.env` 权限收紧备份口径、compose/Nginx 副本、临时库导入、临时上传目录恢复、附件 metadata/hash 只读 `report_only` 对账；不覆盖生产库、不删除生产备份、不执行应用切换、不自动修复 metadata 或移动上传文件。

## 环境说明

当前仓库环境没有真实生产 `.env`、没有运行中的 `areaforge-web` 容器，也没有 `areaforge-uploads` Docker volume；本次 E2 使用本地 Docker PostgreSQL `areaforge` 数据库和空临时上传目录做可重复恢复演练。生产 `.env` 备份项使用 `.env.example` 的权限收紧副本作为本地替代证据，E3 前必须用真实生产 env 和真实备份点重新确认。

## 演练工件

所有工件保存在 Git 忽略目录 `backups/package-e/e2-20260709211732/`，不提交仓库。

| 项目 | 路径 | sha256 / 结果 |
|---|---|---|
| PostgreSQL dump | `backups/package-e/e2-20260709211732/db/areaforge-20260709211732.dump` | `ec8f0bb48898300d4f197e6d000cc95684f3b18fde1f46eabedbac2c794c5a6e` |
| 上传目录归档 | `backups/package-e/e2-20260709211732/uploads/uploads-20260709211732.tar.gz` | `dc11a91b3eac395ffbb83eb411ba1d441b93b5298f342575dbd121f71e525336` |
| 生产 `.env` 本地替代备份 | `backups/package-e/e2-20260709211732/env/env.example.e2-backup` | `envBackupSha256=05621bbbfd0c7a2c8f4bd1100b0858983e7ac0562300323df508f2c7d8ff2daa`；权限已收紧为 `600` |
| compose 副本 | `backups/package-e/e2-20260709211732/config/docker-compose.prod.yml` | `composeConfigBackupPath` 已生成；hash `9412d0f7f85eb46e5f2a3904202ff06a60e0fc13bf20388f6b2a6fdabf3121c6` |
| Nginx 副本 | `backups/package-e/e2-20260709211732/config/forge.areasong.top.conf.example` | `nginxConfigBackupPath` 已生成；hash `34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46` |
| 附件对账 CSV | `backups/package-e/e2-20260709211732/reports/attachment-reconciliation.csv` | `7c4e4e87f3d9de6b550788eae003f9766ef9cc7f9402b701ba8862b028ba2f54`；header-only，`action=report_only` |

## 恢复演练结果

| 验收项 | 结果 |
|---|---|
| 数据库 dump 可导入临时库 | PASS |
| 临时库 | `areaforge_e2_restore_20260709211732` 已创建、导入、验证并清理 |
| 恢复后计数 | `User=1`、`StudyTask=8`、`Note=1`、`Attachment=0` |
| 上传目录归档可恢复到临时目录 | PASS |
| 临时上传目录 | `backups/package-e/e2-20260709211732/uploads-restore/uploads` |
| metadata/hash 对账 | PASS / not-applicable；当前无附件记录，对账报告仅表头 |
| 对账动作 | 只读 `report_only`，没有自动修复、删除、移动或覆盖 metadata |
| 生产发布 / migration deploy | 未执行 |
| 应用切换 / Nginx 切换 | 未执行 |

## 已执行验证

- `docker exec areaforge-postgres pg_dump -U areaforge -d areaforge --format=custom --no-owner --no-acl`
- `docker exec -i areaforge-postgres pg_restore --clean --if-exists --no-owner --no-acl`
- `tar` 上传目录归档和恢复。
- `chmod 600` 生产 `.env` 本地替代备份。
- `sha256sum` 生成 dump、上传归档、env、compose、Nginx 和对账 CSV hash。
- `pnpm exec tsx scripts/quality/attachment-reconciliation.ts <restored-upload-dir> <attachment-reconciliation.csv>`
- `pnpm exec tsc --noEmit --module ESNext --moduleResolution Bundler --target ES2022 --skipLibCheck scripts/quality/attachment-reconciliation.ts`

## E2 未执行事项

- 未执行生产部署。
- 未运行生产 migration deploy。
- 未覆盖生产库。
- 未删除生产备份。
- 未执行应用切换、Nginx 切换或 `docker compose up`。
- 未自动修复 metadata，未删除孤儿文件，未移动上传目录文件。
- 未把生产 `.env`、数据库 URL、AI Key、完整命令输出或附件内容写入仓库。

## 后续要求

E3 前必须用真实生产 env、真实 `AREAFORGE_IMAGE`、真实上传目录或 volume 和真实备份目录重新确认备份点；E2 的本地替代记录只能证明流程、字段、对账脚本和恢复演练路径可用，不能替代最终生产发布记录。
