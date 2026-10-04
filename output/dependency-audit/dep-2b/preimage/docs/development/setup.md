# 开发设置

## 安装

```bash
pnpm install
```

仓库使用 pnpm 11.7.0，并在 `pnpm-workspace.yaml` 中声明 `onlyBuiltDependencies` 与 `allowBuilds`，允许 Prisma、Sharp 和相关解析依赖执行必要 build script。若 pnpm 仍提示 ignored builds，先运行：

```bash
pnpm approve-builds --all
```

## 启动数据库

```bash
docker compose up -d postgres
```

## 生成 Prisma Client

```bash
pnpm db:generate
```

## 数据库迁移

第一版初始 migration 已放在 `prisma/migrations/20260706000000_init/migration.sql`。

本地开发新建或调整 schema 时使用：

```bash
pnpm db:migrate:dev
```

生产部署只使用 deploy 流程，但必须先满足 Package E 的发布确认、备份点和 migration deploy 执行载体要求。当前 standalone Web runtime 镜像只包含 Next 运行产物，不能默认视为可执行 Prisma migrate deploy 的环境；生产迁移需要受控 release 工作目录或一次性 migration job。

```bash
pnpm db:migrate:deploy
```

确认前不要对生产数据库运行该命令；本地或临时库验证应显式指定 `DATABASE_URL`。

## 完整本地测试数据

需要重建全流程测试数据时，先单独备份数据库，再显式确认运行：

```bash
DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54329/areaforge \
AREAFORGE_CONFIRM_FULL_TEST_RESET=true \
pnpm db:seed:complete-test
```

该命令只接受上述 loopback 数据库 URL，会清空除 Prisma migration ledger 外的全部业务表，并重建单管理员合成数据。固定测试账号的用户名和密码均为 `admin@areasong.local`。数据覆盖学习、知识、任务、计时、复盘、检验、阶段调整与确认场景；不会创建磁盘附件、AI Provider 密钥或生产证据。命令本身不创建备份，也不得用于生产数据库。

## 启动 Web

```bash
pnpm dev
```

默认地址：

```text
http://localhost:3000
```

## v1.4 身份与 Workspace 本地验证

v1.4 多人功能默认关闭。开发者只有在全新或明确隔离的 PostgreSQL 已应用当前 migration、设置独立的 `AUTH_ACTION_TOKEN_SECRET`，并确认测试邮件使用 memory transport 或安全 SMTP 后，才可设置 `AUTH_MULTI_USER_ENABLED=true`。专项 runtime 还要求精确数据库名、loopback host 和显式 isolation flag；脚本会清空该隔离库的业务表，禁止指向默认开发库或生产库。

```bash
DATABASE_URL=<精确隔离数据库 URL> \
AREAFORGE_V14_AUTH_ISOLATED_DB=1 \
AREAFORGE_V14_AUTH_EXPECTED_DATABASE=<精确数据库名> \
AUTH_MULTI_USER_ENABLED=true \
pnpm ops:v14:auth:runtime:selftest
```

浏览器验收使用共享测试池 `pnpm dev:test:refresh` 和 `pnpm dev:test:latest -- --json` 返回的 URL，不另起长期容器。

## 检查

```bash
pnpm check
```

针对空库建表 SQL 的只读检查可运行：

```bash
pnpm db:migrate:diff:empty
```
