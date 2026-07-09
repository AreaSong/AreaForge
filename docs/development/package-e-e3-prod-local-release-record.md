# Package E Batch E3 本机单机生产发布记录

确认记录：用户已明确确认“确认执行 Package E Batch E3：生产发布与 migration deploy”。

本记录对应本机 `docker-compose.prod.yml` 单机私有生产目标：`areaforge` compose project，Web 绑定 `127.0.0.1:3000`，PostgreSQL 仅在 compose network 内暴露 `5432/tcp`，上传目录使用私有 Docker volume。它不代表远端服务器、域名 HTTPS 或真实 Nginx 切换已经完成。

## 发布目标

| 字段 | 值 |
|---|---|
| releaseId | `prod-local-20260709224600` |
| APP_VERSION | `0.1.0-prod-local-20260709224600` |
| git commit | `fc7cb3f69897c9d05202f0a97964534a0792212d` |
| Web image | `areaforge-web:prod-local-20260709224600` |
| Web image id | `sha256:09d611cac93557bc627e0ae5ee22878d3258520c76b0d435c997273e0472ce1d` |
| Migration image | `areaforge-migration:prod-local-20260709224600` |
| Migration image id | `sha256:46245ce56d85b46ef675c0cc5dfc6100acf4eed882c005fdf766230de3b5b0ae` |
| 私有证据目录 | `backups/package-e/prod-local-20260709224600/` |

## 备份与配置证据

| 项目 | 证据 |
|---|---|
| 数据库发布前备份 | `db/areaforge-before-prod-release.dump`，sha256 `105ab0d8a87cbcf37379ef6c3b71ed500cfb73f7de8b5c9b89b465f61c368cad` |
| 上传目录发布前归档 | `uploads/uploads-before-prod-release.tar.gz`，sha256 `a94405d72d4caf5df376482073b9ac516a1be8e610a2ac937cff8ad77d9a6ab9`；发布前 volume 不存在，因此归档为空上传目录基线 |
| 生产 env 私有备份 | `env/production.env`，sha256 `e5936c043dc42efbdfd1b71413dabb3500da65678d27e0bc2c1eb52d07b4a8d2`，权限收紧为 `600`；管理员种子 env 已拆分到私有 `env/admin-seed.env`，避免 Compose `$` 插值和长期运行容器携带 seed-only hash |
| compose 副本 | `config/docker-compose.prod.yml`，sha256 `9412d0f7f85eb46e5f2a3904202ff06a60e0fc13bf20388f6b2a6fdabf3121c6` |
| Nginx 示例副本 | `config/forge.areasong.top.conf.example`，sha256 `34892685d1e5b7483eb6df565b8f329980db4e3a8c6c2bb21f3e4c6cac540b46` |
| 生产 compose config | `reports/prod-compose-config.txt`，sha256 `889338bfeb3ea219003745a4bfae3334dc391a9e759c51f4179bf403c880b1c2`，生成时无 `$` 插值警告 |
| 发布前数据计数 | `User=1, StudyTask=8, Note=1, Attachment=0, Migrations=2` |

## 执行记录

- 修正生产 env 边界：把 `AUTH_ADMIN_EMAIL` / `AUTH_ADMIN_PASSWORD_HASH` 从长期运行 `production.env` 拆到私有 `admin-seed.env`，避免 Compose 插值警告，也避免 Web 容器携带 seed-only hash。
- 将现有 PostgreSQL 角色密码受控旋转到生产 env 中的值，并用生产 env 从 `areaforge_default` 网络验证连接成功。
- 执行 `docker compose -p areaforge --env-file backups/package-e/prod-local-20260709224600/env/production.env -f docker-compose.prod.yml up -d postgres`，PostgreSQL healthy，且不再绑定宿主公网或本机端口。
- 通过一次性 migration job 执行 `pnpm db:migrate:deploy`，执行载体为 `one_off_migration_job`；migration 数量从 2 增至 10，8 条 additive migration 全部成功应用。
- 用私有管理员种子 env 对唯一管理员设置烟测密码并写入 `AUTH_ADMIN_PASSWORD_SET_FOR_RELEASE_SMOKE` 审计事件；日志只保留更新条数和审计动作，不打印密码或 hash。
- 执行 `docker compose -p areaforge --env-file backups/package-e/prod-local-20260709224600/env/production.env -f docker-compose.prod.yml up -d web`，Web 运行在 `127.0.0.1:3000`。

## 发布后烟测

发布后 `GET /api/health` 返回：

```json
{"ok":true,"service":"AreaForge","version":"0.1.0-prod-local-20260709224600"}
```

`logs/post-release-smoke.json` 记录 26 项 HTTP 烟测通过：

- 登录成功并取得鉴权 cookie。
- 页面 smoke：`/`、`/notes`、`/syllabus`、`/analytics`、`/reports`、`/simulation`、`/mistakes`、`/motivation` 均返回 200，未跳转登录页。
- API smoke：subjects、dashboard、syllabus、tasks list 可读。
- 写路径 smoke：创建任务、开始/结束计时、保存当日复盘、创建笔记。
- 附件 smoke：note 绑定 PNG 上传成功，鉴权下载字节一致，响应头包含 `private, no-store` 和 `nosniff`。
- AI smoke：鞭策、每日复盘、明日最小任务三接口均走 fallback，`externalCall=false`。

附件只读对账输出 `reports/attachment-reconciliation.csv`，sha256 `3c41f7a19593425d30373ca4080baf24c51b5a0f8c7ad0154167bc4a1f623aed`；共 2 行附件记录，`mismatches=0`，所有动作均为 `report_only`。

发布后数据计数为 `User=1, StudyTask=10, Note=3, Attachment=2, Migrations=10`。新增任务、笔记和附件来自两次 E3 HTTP smoke，其中第一次在 AI 断言命名过窄处停止，第二次完整通过；两次均未泄露密钥或数据库 URL。

## 日志与安全检查

- `logs/web-logs-after-start.log` 和 `logs/web-logs-after-smoke.log` 未匹配 `P2037`、数据库 URL、`AUTH_SESSION_SECRET`、`AI_API_KEY`、API key、完整 prompt/raw response、附件内容或上传绝对路径。
- `production.env`、`admin-seed.env` 和 `admin-smoke-credentials.txt` 均位于 `.gitignore` 忽略的 `backups/` 私有目录，不提交内容。
- 本次没有新增网页内一键更新、服务器命令、部署、备份、恢复或 migration 执行入口。

## 残余风险

- Batch E4 回滚演练与 Package E 收口尚未在本机生产目标执行，因此 Package E 主状态不能改为完成。
- 本机生产目标未完成远端域名 HTTPS / Nginx 真实切换；当前仅验证 Nginx 示例配置备份和 hash。
- 发布镜像基于当前 dirty worktree 构建，后续正式发布前应在干净 commit/tag 上重建固定 tag。
- 生产 Web 已运行在 `http://127.0.0.1:3000`；若后续执行 E4，需要先确认上一镜像、回滚步骤、是否恢复数据库/上传目录和恢复耗时记录口径。
