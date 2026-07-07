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
- `docker compose -f docker-compose.prod.yml config`
- 临时库恢复演练。
- 上传目录 metadata 对账。
- 生产变量检查，不把密钥、数据库 URL 或 AI Key 写入日志。
- 发布后登录、首页、任务、计时、附件访问和 AI fallback 烟测。

## 风险

- 部署、备份、恢复和 migration 都属于高风险边界，执行前必须确认影响、验证和回滚。
- 不允许通过网页按钮触发部署、备份、恢复、migration 或服务器命令。
