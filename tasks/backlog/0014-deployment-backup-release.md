# 0014 部署、备份、恢复与发布闭环

## 目标

把本地私有 Web 应用推进到可部署、可备份、可恢复、可回滚的生产闭环。

## 范围

- 对齐生产 `docker-compose.prod.yml`。
- Next.js standalone 容器。
- PostgreSQL 16 生产部署。
- Nginx HTTPS 反代。
- 上传目录和数据库同周期备份。
- 发布前手动备份点。
- 生产 `.env` 和当前部署版本 tag 备份。
- migration deploy 流程。
- 临时库和临时上传目录恢复演练。
- 发布前、发布后和失败回滚检查清单。

## 不包含

- 网页内一键更新。
- 在网页内执行服务器命令。
- 不经备份的破坏性 migration。

## 参考源事实

- `docs/architecture/deployment.md`
- `docs/deployment/docker-compose.md`
- `docs/deployment/backup-restore.md`
- `docs/security/threat-model.md`
- `docs/security/file-ai-safety.md`
- `docs/development/production-release-runbook.md`

## 验收标准

- 生产 Compose 不暴露 PostgreSQL 公网端口。
- Web 仅监听本机端口供 Nginx 反代。
- 发布前备份数据库和上传目录。
- 发布前备份生产 `.env` 和当前镜像或版本 tag。
- 恢复验证能确认数据库可导入、附件 metadata 与文件本体对应、首页和登录可用。
- 每日 `pg_dump` 与上传目录同周期备份，至少保留 14 天。
- 失败时能回滚到上一镜像 tag，并用发布前数据库和上传目录备份恢复。
- `pnpm check` 与 Compose config 校验通过。

## 验证

- `pnpm check`
- `docker compose config`
- `docker compose --env-file .env.example -f docker-compose.prod.yml config`
- 临时库恢复演练。
- 上传目录 metadata 对账。
- 生产变量检查，不把密钥、数据库 URL 或 AI Key 写入日志。
- 发布后登录、首页、任务、计时、附件访问和 AI fallback 烟测。

## 确认后实施切入点

以下清单只用于获得 Package E 明确确认后的生产发布，不代表确认前可以执行生产部署、生产 migration deploy、备份恢复或服务器命令。

- 发布记录：记录发布时间、操作者、git commit、`AREAFORGE_IMAGE`、镜像 digest、compose 文件 hash、生产 `.env` 备份位置和发布前版本 tag。
- 发布前备份：生成 PostgreSQL dump、上传目录归档、生产 `.env` 权限收紧备份、Nginx 配置副本和当前 compose 文件副本；备份路径和 hash 只写入本地/运维记录，不提交密钥。
- Migration deploy：执行前确认备份点存在；仅在已确认的 additive migration 范围内运行；生产 deploy 失败时优先回滚应用镜像并保留新增字段。
- 恢复演练：先在临时库和临时上传目录恢复，验证登录、首页、任务、计时、复盘、附件 metadata/文件 hash 一致，再清理临时环境。
- 发布后烟测：`GET /api/health`、登录、首页、任务创建、计时开始/结束、复盘保存、`/syllabus`、`/notes`、`/analytics`、`/reports`；附件或真实 AI 若已启用，只使用小测试文件和最小测试数据。
- 回滚记录：失败时记录原因、回滚镜像 tag、是否恢复数据库和上传目录、恢复耗时、残余风险和后续修复任务。
- 自动化禁区：仍不允许网页内一键更新，不允许网页触发服务器命令、部署、备份、恢复或 migration。

## 风险

- 部署、备份、恢复和 migration 都属于高风险边界，执行前必须确认影响、验证和回滚。
- 不允许通过网页按钮触发部署、备份、恢复、migration 或服务器命令。
