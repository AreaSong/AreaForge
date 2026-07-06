# 认证与安全边界

第一版采用单管理员账号，不引入多用户、OAuth 或复杂 RBAC。

## 第一版认证方案

- 使用自有认证流程，不引入 NextAuth。
- 登录入口为 `/login`。
- API 入口为 `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
- 会话使用数据库会话表 + `HttpOnly` Cookie。
- Cookie 只保存随机 session token，不保存用户信息或权限信息。
- 数据库只保存 session token 的哈希值，不保存明文 token。
- 页面访问和所有写 API 都必须服务端校验有效会话。

## 密码与 seed

- 管理员密码只保存哈希，不保存明文。
- 第一版优先使用 Node.js 内置 `crypto.scrypt` 生成密码哈希，减少额外原生依赖。
- `AUTH_ADMIN_PASSWORD_HASH` 只用于首次 seed 创建管理员。
- seed 默认不覆盖已有管理员密码；需要重置密码时必须走明确的重置脚本或显式标志。
- seed 必须可重复执行，科目初始化使用稳定 code upsert，不能产生重复科目。

## 会话 Cookie

Cookie 要求：

- 名称来自 `AUTH_SESSION_COOKIE_NAME`，默认 `af_session`。
- `HttpOnly: true`。
- `SameSite: Lax`。
- 生产环境 `Secure: true`。
- `Path: /`。
- 第一版有效期默认 7 天。

注销时必须删除当前 Cookie，并删除或失效数据库中的当前会话记录。

## 登录限速

- 第一版提供基础限速，按 IP + email 维度限制连续失败登录。
- 限速实现可以先使用进程内存；后续多实例部署时再提升到数据库或 Redis。
- 登录失败日志不记录密码、明文 session token 或完整请求体。

## 审计

需要记录的安全事件：

- seed 创建管理员。
- seed 初始化或更新科目。
- 登录成功。
- 登录失败。
- 注销。
- 会话过期或无效访问可按需记录，避免噪声过大。

审计 metadata 不记录密码、明文 token、数据库连接串、AI key 或敏感正文。

## 高敏感数据

- 动机档案、情绪记录、复盘正文、错题和上传资料按高敏感数据处理。
- 日志不打印 AI key、数据库 URL、原始动机档案、完整 prompt。
- 文件上传必须限制 MIME、大小、路径和访问权限。
- 高风险操作需要二次确认和审计日志。
