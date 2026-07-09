# Package E Batch E3 本地生产模式发布记录

## 状态

本文件记录 Package E Batch E3 在本机受控环境中的 production-mode 发布演练。它不是最终真实生产发布记录，不包含生产 `.env`、密钥、数据库 URL、备份文件本体或附件内容。

确认记录：用户已明确确认“确认执行 Package E Batch E3：生产发布与 migration deploy”。

结论：本地生产模式发布、一次性 migration job、发布后 smoke、附件只读对账和 release evidence 校验已通过；真实生产服务器发布仍未完成，因为当前环境没有真实生产 `.env`、生产域名/Nginx 切换、真实生产上传 volume、远程服务器备份点或上一生产镜像 tag。

## 执行环境

- 本地 Compose project：`areaforgee3`
- App URL：`http://127.0.0.1:3100`
- Web 镜像：`areaforge-web:e3-local-20260709214850`
- Web 镜像 digest：`sha256:1135d369fabbd2fbdf0d3af6b32b6aaec62bfe24d5d27bf606ba9eef6b5e9e6d`
- Migration 镜像：`areaforge-migration:e3-local-20260709214850`
- Migration 镜像 digest：`sha256:950285faced677ce7c5aa541c84399eb6572fb0f14caa0a3808d4c54f6608d3b`
- Compose hash：`ab8772a36f9b9d7b56b21e9de68a1b157c4b1d19f61110057ceccfb79ef84f57`
- Nginx 示例配置 hash：`34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46`
- Git commit：`fc7cb3f69897c9d05202f0a97964534a0792212d`，发布镜像来自 dirty worktree，包含本次 `PrismaClient` 复用修复。

## 备份点

本次 E3 本地演练在全新隔离库上执行，仍按 runbook 生成 migration 前备份点。

| 项目 | 路径 | sha256 / 结果 |
|---|---|---|
| PostgreSQL migration 前 dump | `backups/package-e/e3-20260709214850/db/areaforge-e3-before-migration-20260709214850.dump` | `ec999584e815761b90927708ecb69f05241d0fcb71a97141203eb84741e1d7c2` |
| 上传目录发布前空归档 | `backups/package-e/e3-20260709214850/uploads/uploads-e3-before-release-empty-20260709214850.tar.gz` | `4709d49a30194c742efecaab847b77dc37828936280ea5388ad016e449eade03` |
| E3 本地 env 备份 | `backups/package-e/e3-20260709214850/env/e3-local.env` | `envBackupSha256=c0d7de6feff55a98037a532b40c5cf1d48e006c24e57ab09b1643a4fa115c580` |
| E3 Compose 副本 | `backups/package-e/e3-20260709214850/config/docker-compose.e3-local.yml` | `ab8772a36f9b9d7b56b21e9de68a1b157c4b1d19f61110057ceccfb79ef84f57` |
| Nginx 示例副本 | `backups/package-e/e3-20260709214850/config/forge.areasong.top.conf.example` | `34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46` |

## Migration Deploy

- 执行载体：`one_off_migration_job`
- 执行镜像：`areaforge-migration:e3-local-20260709214850`
- 执行结果：10 条 migration 全部成功应用。
- 最新 migration：`20260708010000_add_periodic_report_decisions`
- 执行范围：本地 E3 隔离 PostgreSQL 容器；未触碰开发库、真实生产库或真实上传目录。

## 发布过程

1. `pnpm package-e:preflight` 通过。
2. `pnpm risk:preflight` 通过。
3. E3 Compose config 使用本地 env 通过。
4. 启动 E3 PostgreSQL 并等待 healthy。
5. 生成 migration 前 PostgreSQL dump。
6. 使用一次性 migration job 执行 `pnpm db:migrate:deploy`。
7. seed 本地 smoke 管理员和基础科目。
8. 构建并启动生产模式 Web 镜像。
9. 首次首页 smoke 暴露 `P2037 TooManyConnections`，定位为 `packages/db` 在生产模式未复用 `PrismaClient`。
10. 修复 `packages/db/src/index.ts`：进程和全局复用同一个 PrismaClient，Proxy method 只绑定同一 client。
11. `pnpm --filter @areaforge/db typecheck`、`pnpm db:validate`、`pnpm check` 通过。
12. 重建 Web 与 migration 镜像，强制重建 E3 Web 容器。
13. `GET /api/health`、登录、首页、任务、计时、复盘、页面、附件和 AI fallback smoke 通过。
14. 生成 release record 并执行 `pnpm release:evidence:validate` 通过。

## 发布后 Smoke

| 项目 | 结果 |
|---|---|
| `GET /api/health` | PASS，返回 `0.1.0-e3-local-20260709214850` |
| 登录 | PASS，本地 smoke 管理员可登录 |
| 首页 | PASS，Playwright 登录后打开 `/` 正常渲染 |
| 任务 | PASS，创建 `E3 smoke task` |
| 计时 | PASS，开始并结束 `StudySession` |
| 复盘 | PASS，保存今日复盘 |
| `/syllabus` | PASS，200 |
| `/notes` | PASS，200 |
| `/analytics` | PASS，200 |
| `/reports` | PASS，200 |
| `/simulation` | PASS，200 |
| 附件上传/下载 | PASS，note 绑定 PNG 上传成功，鉴权下载 200，hash matched |
| 附件 metadata/hash 对账 | PASS，`attachment-reconciliation.csv` 1 行，`mismatches=0`，`action=report_only` |
| AI fallback | PASS，`discipline`、`daily-review`、`tomorrow-plan` 均为 `local_rule_fallback`、`externalCall=false`、`sensitiveContextIncluded=false` |
| 日志脱敏 | PASS，未发现 `P2037`、数据库 URL、AI key、session secret、prompt/raw response 或上传绝对路径泄露 |

## 证据文件

- 脱敏 release record：`backups/package-e/e3-20260709214850/reports/release-record.txt`
- 附件对账 CSV：`backups/package-e/e3-20260709214850/reports/attachment-reconciliation.csv`
- migration 日志：`backups/package-e/e3-20260709214850/logs/migration-deploy.log`
- 镜像重建日志：`backups/package-e/e3-20260709214850/logs/docker-rebuild-after-prisma-client-reuse.log`

已执行：

```bash
pnpm release:evidence:validate backups/package-e/e3-20260709214850/reports/release-record.txt backups/package-e/e3-20260709214850/reports/attachment-reconciliation.csv
```

结果：PASS，字段完整、hash/枚举合法、未包含敏感值，附件对账保持 `report_only`。

## 未完成事项

- 未执行真实生产服务器发布。
- 未使用真实生产 `.env`。
- 未切换真实生产 Nginx。
- 未连接或修改真实生产数据库。
- 未读取、写入、移动或删除真实生产上传目录。
- 未记录上一真实生产镜像 tag。
- 未执行真实回滚演练。
- 未把 Package E 主状态标为完成。

## 残余风险

- 当前 E3 只能证明本地受控 production-mode 发布链路可用，不能替代真实生产发布。
- 发布镜像来自 dirty worktree，真实发布前应先提交或明确 release commit/tag。
- Web 日志仍出现一条 `pg` 未来弃用 warning：`Calling client.query() when the client is already executing a query is deprecated`；它不含敏感信息且 smoke 通过，但真实生产前建议继续跟踪 Prisma adapter 或事务并发来源。
- E4 本机生产回滚收口证据已在后续 `docs/development/package-e-e4-prod-local-rollback-record.md` 中补齐；本文件只保留 E3 本地 production-mode 演练的历史记录。
