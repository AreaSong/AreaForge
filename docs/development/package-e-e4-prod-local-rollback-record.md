# Package E Batch E4 本机生产回滚收口记录

确认记录：用户已授权从当前准确进度推进到 docs 100%，并明确允许继续完成 Package E Batch E4。

本记录对应当前本机 `areaforge` compose project 的单机私有生产目标：`http://127.0.0.1:3000`。它收口的是本机生产目标的应用镜像回滚与 roll-forward 机制，不声称已完成远端服务器、域名 HTTPS 或真实 Nginx 流量切换。

## 执行环境

| 字段 | 值 |
|---|---|
| releaseId | `prod-local-e4-20260709230645` |
| Candidate image | `areaforge-web:prod-local-20260709224600` |
| Candidate digest | `sha256:09d611cac93557bc627e0ae5ee22878d3258520c76b0d435c997273e0472ce1d` |
| Previous image | `areaforge-web:e3-local-20260709214850` |
| Previous digest | `sha256:1135d369fabbd2fbdf0d3af6b32b6aaec62bfe24d5d27bf606ba9eef6b5e9e6d` |
| Rollback app version | `0.1.0-prod-local-e4-rollback-20260709230645` |
| Roll-forward app version | `0.1.0-prod-local-20260709224600` |
| 私有证据目录 | `backups/package-e/prod-local-e4-20260709230645/` |

previous image 是当前机器上可用的上一 release image。它不是远端历史生产镜像；本次 E4 的完成口径是本机单机生产目标。

## 备份与回滚步骤

- E4 前生成当前 PostgreSQL dump：`db/areaforge-before-e4-rollback.dump`，sha256 `bfff7d587f082c007feb11d02a9aaa58ccb60870c4a47de84788a0f6bc16ee6b`。
- E4 前生成当前上传 volume 归档：`uploads/uploads-before-e4-rollback.tar.gz`，sha256 `267a8ebb4008020e057057ad2db59f159abdc65b2d79f87997a51c1a4bd23e45`。
- 生成 rollback env 和 roll-forward env，权限均为 `600`；rollback env sha256 `a131872bad20f021c978a26db505d85acbdfa04254b1d009a2711b5ae8db8a79`。
- 备份 compose/Nginx 副本；compose sha256 `9412d0f7f85eb46e5f2a3904202ff06a60e0fc13bf20388f6b2a6fdabf3121c6`，Nginx 示例 sha256 `34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46`。
- 回滚步骤：用 rollback env 将 `AREAFORGE_IMAGE` 切到 `areaforge-web:e3-local-20260709214850`，执行 `docker compose -p areaforge --env-file <rollback-env> -f docker-compose.prod.yml up -d --force-recreate web`。
- 回滚后不恢复数据库/上传目录，因为应用镜像回滚 smoke 通过，未发现数据损坏或附件不一致。
- roll-forward 步骤：用 roll-forward env 切回 `areaforge-web:prod-local-20260709224600` 并重建 Web 容器。

## 验收结果

| 项目 | 结果 |
|---|---|
| 回滚 health | PASS，版本 `0.1.0-prod-local-e4-rollback-20260709230645` |
| 回滚登录 | PASS |
| 回滚页面 | PASS，`/`、`/notes`、`/syllabus`、`/analytics`、`/reports`、`/simulation` 均为 200 |
| 回滚任务/计时/复盘 | PASS，创建任务、开始/结束计时、保存当日复盘均通过 |
| 回滚附件 smoke | PASS，PNG 上传、鉴权下载、`private, no-store` 和 `nosniff` 均通过 |
| 回滚 AI fallback | PASS，三条 AI 接口均 `externalCall=false` |
| 附件对账 | PASS，3 行，`mismatches=0`，全部 `report_only` |
| 数据库/上传目录恢复判定 | `databaseRestoreRequired=no`，`uploadsRestoreRequired=no` |
| 失败原因 | `none-prod-local-drill` |
| 恢复耗时 | 2 分钟 |
| Roll-forward | PASS，health 回到 `0.1.0-prod-local-20260709224600`，登录、页面、dashboard 和 notes API 通过 |
| 日志扫描 | PASS，本次扫描范围内未发现 `P2037`、连接数打满、数据库连接串、会话 secret、AI key、模型原始返回、附件内容或上传绝对路径泄露 |

E4 前数据库计数为 `User=1, StudyTask=10, Note=3, Attachment=2, Migrations=10`；E4 后为 `User=1, StudyTask=11, Note=4, Attachment=3, Migrations=10`，新增数据来自回滚 smoke。

## 证据校验

私有发布记录：

`backups/package-e/prod-local-e4-20260709230645/reports/release-record-after-prod-local-rollback.txt`

附件对账：

`backups/package-e/prod-local-e4-20260709230645/reports/attachment-reconciliation-after-rollback.csv`

已执行：

```bash
pnpm release:evidence:validate backups/package-e/prod-local-e4-20260709230645/reports/release-record-after-prod-local-rollback.txt backups/package-e/prod-local-e4-20260709230645/reports/attachment-reconciliation-after-rollback.csv
```

结果：PASS，字段完整、hash/枚举合法、未包含敏感值，附件对账保持 `report_only`。

## 残余风险

- 本次完成的是本机单机生产目标，不包含远端服务器、域名 HTTPS 或真实 Nginx 流量切换。
- previous image 是当前机器上的上一可用 release image，不是远端历史生产镜像。
- 当前 release image 仍来自 dirty worktree；后续外部发布前应创建干净 commit 和不可变 release tag。
- 本次只在应用镜像层执行回滚；数据库和上传目录保留同周期备份，但未执行破坏性恢复。
