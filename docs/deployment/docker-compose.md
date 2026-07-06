# Docker Compose 部署

第一版部署目标：

- `web`：Next.js standalone 应用。
- `postgres`：PostgreSQL 16。
- `uploads`：附件持久化目录。

部署原则：

- PostgreSQL 不暴露公网端口。
- 上传目录不由 Nginx 直接暴露。
- 正式发布使用固定版本 tag，不直接依赖 `latest`。
- 发布前备份数据库和上传目录。
- migration 由部署流程执行，不提供网页按钮。

## 本地开发

本地使用 `docker-compose.yml`。PostgreSQL 默认映射到宿主机 `127.0.0.1:54329`，和 `.env.example`、根脚本默认 `DATABASE_URL` 一致：

```bash
docker compose up -d postgres
```

如果 54329 已被其他项目占用，可以临时换端口：

```bash
POSTGRES_PORT=54330 docker compose up -d postgres
DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge pnpm db:migrate:dev
```

Web 开发仍推荐本机运行：

```bash
pnpm dev
```

如需本地完整容器启动：

```bash
docker compose up -d --build
```

## 生产建议

生产使用 `docker-compose.prod.yml`，不要叠加本地开发 compose 文件：

```bash
docker compose -f docker-compose.prod.yml up -d
```

生产环境要求：

- `postgres` 不映射公网端口。
- `web` 只绑定 `127.0.0.1:${WEB_PORT:-3000}`，由 Nginx 反代访问。
- `.env` 只保存在服务器，权限收紧。
- `POSTGRES_PASSWORD`、`AUTH_SESSION_SECRET`、`AI_API_KEY` 使用强随机值。
- 上传目录和数据库卷必须备份。

发布前必须先备份数据库和上传目录，再执行 Prisma migration deploy；失败时回滚镜像版本，并使用备份恢复数据库和上传目录。
