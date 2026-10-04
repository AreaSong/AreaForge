# 0006 MVP 前工程准备

状态：已完成。

## 目标

在开始登录、任务和计时真实实现前，先补齐会阻塞 MVP 的工程准备断点。

## 范围

- 建立第一版 Prisma migration 策略。
- 统一 `.env.example`、根脚本和 Docker Compose 的数据库凭据。
- 明确本地开发 Compose 与生产部署 Compose 的边界。
- 明确 `apps/web` 消费 `packages/db/ai/storage/config` 的依赖和构建策略。
- 处理 `turbo.json` 是否接入或移除。
- 给 `packages/core` 加平台无关约束。
- 补强 `.dockerignore`。
- 处理 `pnpm check` 的依赖 build script 审批策略。
- 确认 `docs/development/validation-matrix.md` 中的验证命令能覆盖 MVP 前置改动。

## 不包含

- 业务登录实现。
- 任务 CRUD。
- 计时持久化。

## 参考源事实

- `docs/development/pre-code-closure.md`
- `docs/development/validation-matrix.md`
- `docs/architecture/project-structure.md`
- `docs/architecture/deployment.md`
- `docs/deployment/docker-compose.md`
- `docs/security/threat-model.md`

## 验收标准

- 空库建表路径清楚。
- 示例 env 复制后不会出现数据库凭据冲突。
- 生产部署不会默认暴露 PostgreSQL 到公网。
- `pnpm check` 的前置审批策略明确。
- 后续 MVP 任务不会再被工程配置阻塞。

## 处理结果

- 新增初始 Prisma migration：`prisma/migrations/20260706000000_init/migration.sql`。
- 新增 `pnpm db:migrate:diff:empty`，用于只读生成空库建表 SQL。
- 统一 `.env.example`、根脚本和本地 Compose 的默认数据库凭据。
- 新增 `docker-compose.prod.yml`，生产 PostgreSQL 不映射宿主端口。
- `apps/web` 显式声明 `packages/db/ai/storage/config/ui/core` 依赖并同步 Next `transpilePackages`。
- 移除未实际接入的 `turbo.json`，避免配置漂移。
- `packages/core` 移除 DOM lib 和 ambient types。
- `.dockerignore` 补齐生成物和构建产物。
- `packageManager` 对齐到 pnpm 11.7.0，`pnpm-workspace.yaml` 增加 `onlyBuiltDependencies` 与 `allowBuilds`，明确 build script 审批策略。

## 风险与回滚

- 初始 migration 只适用于空库；后续改 schema 必须新增 migration，不能直接改历史 migration。
- 本次未执行真实数据库写入；若 migration 文件需要回滚，删除未应用的 migration 目录即可。
- 生产部署前仍必须备份数据库和上传目录。

## 验证

- `pnpm install --frozen-lockfile`
- `pnpm check`
- `docker compose config`
- `POSTGRES_DB=areaforge POSTGRES_USER=areaforge POSTGRES_PASSWORD=areaforge APP_URL=http://127.0.0.1:3000 AUTH_SESSION_SECRET=local-development-secret-change-me docker compose -f docker-compose.prod.yml config`
- `pnpm db:migrate:diff:empty | sed '/^Loaded Prisma config/d;/^$/d' | diff -u <(sed '/^$/d' prisma/migrations/20260706000000_init/migration.sql) -`
- `git diff --check`
