# Package E Batch E4 本地回滚演练记录

## 状态

本文件记录 Package E Batch E4 在本机受控环境中的回滚演练。它不是最终真实生产回滚记录，不包含生产 `.env`、密钥、数据库 URL、生产备份文件本体或附件内容。

结论：本地回滚机制、回滚后 smoke、附件只读对账、回滚后 roll-forward 和 release evidence 校验已通过；本文件是早期本地机制演练记录，不作为当前远端生产状态依据。prod-local 回滚收口见 `docs/development/package-e-e4-prod-local-rollback-record.md`，真实远端 `v0.1.5` 历史 GitHub Release 签名更新证据见 `docs/development/package-e-remote-github-release-record.md`，当前生产更新证据见 `docs/development/release-v0.1.7-record.md`。

## 执行环境

- 本地 Compose project：`areaforgee3`
- App URL：`http://127.0.0.1:3100`
- Candidate image：`areaforge-web:e3-local-20260709214850`
- Candidate digest：`sha256:1135d369fabbd2fbdf0d3af6b32b6aaec62bfe24d5d27bf606ba9eef6b5e9e6d`
- Local previous image：`areaforge-web:e4-local-previous-20260709223000`
- Local previous digest：`sha256:1135d369fabbd2fbdf0d3af6b32b6aaec62bfe24d5d27bf606ba9eef6b5e9e6d`
- Compose hash：`ab8772a36f9b9d7b56b21e9de68a1b157c4b1d19f61110057ceccfb79ef84f57`
- Rollback env hash：`9392821ec9d46c510887da512f61a427c8f9204ab9877fc424b6b25dc9cb6508`

注意：本地 previous image 是用 candidate image 打的本地 tag，digest 相同；它只验证回滚命令和切换机制，不代表真实上一生产版本。

## 回滚步骤

1. 复制 E3 compose/env 到 `backups/package-e/e4-local-20260709223000/`。
2. 把当前 candidate image 标记为本地 previous image。
3. 修改本地 rollback env：`AREAFORGE_IMAGE=areaforge-web:e4-local-previous-20260709223000`，`APP_VERSION=0.1.0-e4-local-rollback-previous-20260709223000`。
4. 执行 `docker compose -p areaforgee3 --env-file <rollback-env> -f <compose> up -d --force-recreate web`。
5. 验证 rollback health、登录、首页、`/notes`、`/reports`。
6. 对上传 volume 执行附件 metadata/hash 只读 `report_only` 对账。
7. 修改回 candidate env 并重建 Web 容器。
8. 验证 roll-forward health。

## 验收结果

| 项目 | 结果 |
|---|---|
| 回滚 health | PASS，版本 `0.1.0-e4-local-rollback-previous-20260709223000` |
| 回滚登录 | PASS，本地 smoke 管理员可登录 |
| 回滚首页 | PASS，200 |
| 回滚 `/notes` | PASS，200 |
| 回滚 `/reports` | PASS，200 |
| 附件对账 | PASS，1 行，`mismatches=0`，`action=report_only` |
| 回滚耗时 | 1 分钟 |
| 是否需要数据库恢复 | no |
| 是否需要上传目录恢复 | no |
| 回滚失败原因 | none-local-drill |
| Roll-forward health | PASS，版本恢复为 `0.1.0-e3-local-20260709214850` |
| 日志脱敏检查 | PASS，未发现 `P2037`、数据库 URL、密钥、完整 prompt/raw response 或上传绝对路径泄露 |

## 证据文件

- 本地 E4 目录：`backups/package-e/e4-local-20260709223000/`
- 本地回滚 release record：`backups/package-e/e4-local-20260709223000/reports/release-record-after-local-rollback.txt`
- 附件对账 CSV：`backups/package-e/e4-local-20260709223000/reports/attachment-reconciliation-after-rollback.csv`
- 回滚 smoke：`backups/package-e/e4-local-20260709223000/reports/rollback-smoke.txt`
- Roll-forward smoke：`backups/package-e/e4-local-20260709223000/reports/roll-forward-smoke.txt`

已执行：

```bash
pnpm release:evidence:validate backups/package-e/e4-local-20260709223000/reports/release-record-after-local-rollback.txt backups/package-e/e4-local-20260709223000/reports/attachment-reconciliation-after-rollback.csv
```

结果：PASS，字段完整、hash/枚举合法、未包含敏感值，附件对账保持 `report_only`。

## 本地机制演练未覆盖事项

- 未执行真实生产回滚。
- 未验证真实上一生产镜像 tag。
- 未切换真实生产 Nginx。
- 未恢复真实生产数据库或上传目录。
- 本文件没有记录 prod-local 生产目标失败原因或恢复耗时；后续收口见 `docs/development/package-e-e4-prod-local-rollback-record.md`。
- 本文件不单独作为 Package E Batch E4 或 Package E 主状态完成证据。

## 残余风险

- 本地 previous image 与 candidate image digest 相同，只证明回滚流程可执行，不证明旧版本兼容性。
- prod-local 生产目标的 E4 收口已由 `docs/development/package-e-e4-prod-local-rollback-record.md` 记录。
- 远端服务器、域名 HTTPS 和真实 Nginx 流量切换已由后续 `v0.1.5` GitHub Release 记录补齐；未来服务器、域名、端口或 Nginx 迁移仍需另列外部部署演练。
