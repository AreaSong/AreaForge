# 部署架构

## 目标环境

- 系统：Ubuntu。
- 容器：Docker。
- 反向代理：Nginx。
- 域名：`forge.areasong.top`。
- 远端生产由 Nginx 反代到服务器本机的 Web 端口（`WEB_PORT`，示例 `127.0.0.1:3020`）；同一服务器的其他本机端口可能属于别的服务，反代目标以生产环境文件为准。
- 生产当前运行版本以 `/api/health` 返回值和 [运营 readiness](../development/operational-readiness.md) 为准。

## 服务

```text
Nginx -> web container -> PostgreSQL
                  |
                  -> uploads volume
```

## 第一版技术栈

- Next.js standalone。
- PostgreSQL 16。
- Prisma migration。
- Docker Compose。
- Nginx HTTPS 反代。

## 环境变量

关键变量：

- `APP_URL`
- `APP_VERSION`
- `DATABASE_URL`
- `AUTH_SESSION_SECRET`
- `AUTH_SESSION_COOKIE_NAME`
- `AUTH_ADMIN_EMAIL`
- `AUTH_ADMIN_PASSWORD_HASH`
- `AI_ENABLED`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- `AI_TIMEOUT_MS`
- `AI_MAX_RETRIES`
- `AI_LOG_PROMPTS`
- `AI_ALLOW_SENSITIVE_CONTEXT`
- `UPLOAD_DIR`
- `MAX_UPLOAD_MB`

## 发布策略

推荐：

- GitHub Release 作为正式发布触发点。
- 构建 Docker 镜像并使用版本 tag。
- 部署前备份数据库和上传目录。
- 通过一次性 migration image 执行 `pnpm db:migrate:deploy` 或等价的 Prisma migration deploy 流程。
- 使用服务器侧 updater 校验 Release 签名、hash 和镜像 digest 后拉起新版本容器。

第一版不做 Web runtime 直接执行服务器命令的一键更新。当前已具备版本中心受控请求流：Web UI 写入 update request，`areaforge-update-agent.timer` 以 root agent 身份读取请求并调用服务器侧 updater。

## Compose 边界

- 本地开发使用 `docker-compose.yml`，PostgreSQL 和 Web 端口只绑定 `127.0.0.1`。
- 生产部署使用 `docker-compose.prod.yml`，PostgreSQL 不映射宿主端口，Web 仅监听本机端口供 Nginx 反代。
- 生产环境必须显式提供 `POSTGRES_PASSWORD`、`AUTH_SESSION_SECRET`、`APP_URL` 等变量，不能依赖弱默认值。
