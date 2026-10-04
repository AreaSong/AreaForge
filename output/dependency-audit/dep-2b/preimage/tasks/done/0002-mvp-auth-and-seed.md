# 0002 单管理员登录与初始化数据

状态：已完成。认证、会话和 seed 属于高风险边界，本任务已按影响、风险、验证和回滚思路完成实现与烟测。

## 目标

实现第一版私有 Web 应用的入口保护和基础数据初始化。

## 范围

- 单管理员登录。
- 管理员密码哈希。
- 初始化数学、英语、政治、408 科目。
- 登录后才能访问作战台。
- 数据库会话表与 `HttpOnly` Cookie。
- 基础登录限速。
- 认证相关审计事件。

## 不包含

- 多用户系统。
- OAuth。
- 复杂 RBAC。
- 找回密码流程。
- 第三方登录。

## 参考源事实

- `docs/architecture/auth-security.md`
- `docs/architecture/data-model.md`
- `docs/architecture/api-surface.md`
- `docs/security/threat-model.md`
- `docs/development/implementation-order.md`
- `docs/modules/dashboard.md`

## 推荐实现路径

1. 新增 `AuthSession` Prisma 模型和 migration。
2. 新增认证工具：密码哈希/校验、session token 生成/哈希、Cookie 读写。
3. 新增 seed：用 `AUTH_ADMIN_EMAIL` 和 `AUTH_ADMIN_PASSWORD_HASH` 首次创建管理员，并 upsert 基础科目。
4. 新增 `/login` 页面。
5. 新增 `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
6. 保护首页作战台：未登录跳转 `/login`，无效会话清 Cookie。
7. 为后续写 API 准备 `requireCurrentUser` 服务端 helper。
8. 记录登录成功、失败、注销和 seed 审计事件。

## 影响

- 会新增一张认证会话表。
- 首页访问会从公开变为需要登录。
- `.env` 必须提供 `AUTH_SESSION_SECRET`，首次 seed 需要 `AUTH_ADMIN_EMAIL` 和 `AUTH_ADMIN_PASSWORD_HASH`。
- 后续任务、计时、复盘等写 API 都应复用本任务产出的鉴权 helper。

## 风险

- migration 失败可能阻塞本地或生产启动。
- Cookie 配置错误会导致无法保持登录，或在生产环境不安全。
- seed 如果覆盖已有管理员密码，会造成登录风险；因此默认不覆盖已有密码。
- 登录失败限速如果过严，可能误伤本人；如果过松，则无法挡住基础爆破。
- 认证 helper 如果没有被后续 API 复用，写接口可能绕过鉴权。

## 回滚思路

- 未部署前：删除本任务新增 migration、认证代码和页面即可回退。
- 已部署但未产生重要数据前：回滚镜像和代码，必要时删除 `AuthSession` 表。
- 已部署且有数据后：优先只禁用认证入口或清空 session，不删除 `User` 和业务数据。
- seed 误操作时：通过备份或显式密码重置脚本恢复，不手工编辑哈希。

## 验收标准

- 未登录访问作战台会跳转登录页。
- 登录失败有基础限速或防爆破策略。
- 初始化科目可重复执行且不产生重复数据。
- seed 默认不覆盖已有管理员密码。
- 登录后 Cookie 为 `HttpOnly`，生产环境 `Secure`。
- 注销后当前 session 失效。
- Auth API 不返回密码哈希或 session token 明文。
- `pnpm check` 通过。

## 验证

- `DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge AUTH_SESSION_SECRET=local-development-secret-change-me pnpm db:validate`
- `DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge AUTH_SESSION_SECRET=local-development-secret-change-me pnpm db:migrate:dev`
- `DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge AUTH_SESSION_SECRET=local-development-secret-change-me pnpm db:generate`
- `DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge AUTH_SESSION_SECRET=local-development-secret-change-me pnpm -r --if-present typecheck`
- `DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge AUTH_SESSION_SECRET=local-development-secret-change-me pnpm check`
- `pnpm install --frozen-lockfile`
- `docker compose config`
- `POSTGRES_DB=areaforge POSTGRES_USER=areaforge POSTGRES_PASSWORD=areaforge APP_URL=http://127.0.0.1:3000 AUTH_SESSION_SECRET=local-development-secret-change-me docker compose -f docker-compose.prod.yml config`
- `git diff --check`
- 旧引用扫描只剩 `docs/architecture/auth-security.md` 中“不引入 NextAuth”的设计说明。
- `pnpm db:seed` 重复执行通过；当前本地库验证为 1 个管理员、7 个科目。
- API 烟测通过：未登录访问首页返回 `307 -> /login`；登录成功返回最小用户信息；Cookie 写入 `af_session` 且为 `HttpOnly`；`GET /api/auth/me` 登录后返回用户、注销后返回 `401`；注销返回 `{"ok":true}`。
- 登录限速烟测通过：连续错误密码第 6 次返回 `429 {"error":"TOO_MANY_ATTEMPTS","retryAfterSeconds":600}`。
