# 0014 部署、备份、恢复与发布闭环

状态：待确认，归属 Package E。当前只完成生产发布 runbook、compose/Nginx/Dockerfile 结构预检和确认前护栏；生产部署、生产 migration deploy、真实备份恢复演练、发布后烟测和回滚记录仍需 Package E E1-E4 逐批确认。

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
- migration deploy 有明确执行载体，不能默认 Next standalone Web runtime 镜像具备 Prisma CLI 或 migration 文件。
- 附件 metadata/hash 对账第一版只输出 `report_only` 报告，不自动修复 metadata、不删除或移动上传文件。
- 每日 `pg_dump` 与上传目录同周期备份，至少保留 14 天。
- 失败时能回滚到上一镜像 tag，并用发布前数据库和上传目录备份恢复。
- `pnpm check` 与 Compose config 校验通过。

## 验证

- `pnpm check`
- `pnpm package-e:preflight`
- `docker compose config`
- `docker compose --env-file .env.example -f docker-compose.prod.yml config`
- 临时库恢复演练。
- 上传目录 metadata 对账。
- 生产变量检查，不把密钥、数据库 URL 或 AI Key 写入日志。
- 发布后登录、首页、任务、计时、附件访问和 AI fallback 烟测。
- migration deploy 执行载体检查：受控 release 工作目录或一次性 migration job 二选一。
- 附件 metadata/hash 对账报告检查：`action=report_only`，无自动修复或删除动作。

## 确认后实施切入点

以下清单只用于获得 Package E 明确确认后的生产发布，不代表确认前可以执行生产部署、生产 migration deploy、备份恢复或服务器命令。

| 批次 | 确认后交付物 | 验证/记录 |
|---|---|---|
| Batch E1 生产配置与发布工件预检 | 生产 env 清单、固定 `AREAFORGE_IMAGE`、镜像 digest 获取方式、compose/Nginx hash、migration deploy 执行载体、发布记录草案、中止条件 | `pnpm check`、`pnpm package-e:preflight`、`docker compose --env-file .env.example -f docker-compose.prod.yml config`、Nginx 检查、生产密钥不落库不提交 |
| Batch E2 发布前备份与恢复演练 | PostgreSQL dump、上传目录归档、生产 `.env` 权限收紧备份、当前 compose/Nginx 副本、临时库导入、临时上传目录恢复、附件只读对账 | 记录 backup path/hash；登录、首页、任务、计时、复盘可读；附件 metadata/hash 对账 `action=report_only` |
| Batch E3 生产发布与 migration deploy | 备份点校验、受控 release 工作目录或一次性 migration job、必要 additive migration deploy、compose/Nginx 切换、发布后烟测、日志脱敏检查 | `GET /api/health`、登录、首页、任务、计时、复盘、`/syllabus`、`/notes`、`/analytics`、`/reports`；附件和 AI 只用最小测试数据 |
| Batch E4 回滚演练与 Package E 收口 | 上一镜像 tag、回滚步骤、是否恢复数据库/上传目录、失败原因、恢复耗时、残余风险、文档同步和 completion record | 回滚记录可执行；`pnpm docs:readiness`、`pnpm risk:preflight`、`pnpm docs:completion` 的 Package E 证据更新 |

- 发布记录：记录发布时间、操作者、git commit、`AREAFORGE_IMAGE`、镜像 digest、compose 文件 hash、生产 `.env` 备份位置和发布前版本 tag。
- 发布前备份：生成 PostgreSQL dump、上传目录归档、生产 `.env` 权限收紧备份、Nginx 配置副本和当前 compose 文件副本；备份路径和 hash 只写入本地/运维记录，不提交密钥。
- Migration deploy：执行前确认备份点存在；仅在已确认的 additive migration 范围内运行；通过受控 release 工作目录或一次性 migration job 执行，不默认使用 standalone Web runtime 镜像；生产 deploy 失败时优先回滚应用镜像并保留新增字段。
- 恢复演练：先在临时库和临时上传目录恢复，验证登录、首页、任务、计时、复盘、附件 metadata/文件 hash 一致；附件对账只输出 `report_only` 报告，不自动修复或删除；再清理临时环境。
- 发布后烟测：`GET /api/health`、登录、首页、任务创建、计时开始/结束、复盘保存、`/syllabus`、`/notes`、`/analytics`、`/reports`；附件或真实 AI 若已启用，只使用小测试文件和最小测试数据。
- 回滚记录：失败时记录原因、回滚镜像 tag、是否恢复数据库和上传目录、恢复耗时、残余风险和后续修复任务。
- 自动化禁区：仍不允许网页内一键更新，不允许网页触发服务器命令、部署、备份、恢复或 migration。

## 风险

- 部署、备份、恢复和 migration 都属于高风险边界，执行前必须确认影响、验证和回滚。
- 不允许通过网页按钮触发部署、备份、恢复、migration 或服务器命令。
