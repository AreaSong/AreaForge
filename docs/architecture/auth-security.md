# 认证与安全边界

稳定 Release/生产采用单管理员账号，不引入 OAuth 或复杂 RBAC。v1.4 本地候选在默认关闭的功能开关后增加邀请制账户、Workspace/Membership 和账户安全；v1.5 才承接复杂 RBAC。

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
- seed 必须可重复执行且只负责管理员身份；业务工作区和科目由已登录用户在首次设置或设置页创建。

## 会话 Cookie

Cookie 要求：

- 名称来自 `AUTH_SESSION_COOKIE_NAME`，默认 `af_session`。
- `HttpOnly: true`。
- `SameSite: Lax`。
- 生产环境 `Secure: true`。
- `Path: /`。
- 第一版有效期默认 7 天。

注销时必须删除当前 Cookie，并撤销数据库中的当前会话记录，同时保留不含 token 的撤销原因用于账户安全审计。

## 登录限速

- 稳定第一版提供基础限速；v1.4 本地候选已改为 PostgreSQL 持久 bucket，按 session/account/IP 或 email/IP 多维预占登录、邀请、重置、重新验证和密码修改尝试，多实例重启不会清空防护。
- 登录失败日志不记录密码、明文 session token 或完整请求体。

## v1.4 本地候选

- 只允许邀请制开户，不提供公开注册。
- `User.status/authRevision`、session revision、撤销和密码变更共同保证冻结、重置或撤销后的旧 session 在下一请求失效。
- 邀请、邮箱验证和密码重置使用至少 256 bit 随机 token；数据库只保存 purpose-separated hash，链接使用 URL fragment 并由客户端读取后清理。
- `/settings/account` 管理账户状态、邮箱验证、设备会话、重新验证和密码修改；修改密码撤销旧当前会话并签发新 token。
- `WorkspaceMembership` 在 v1.4 只有 OWNER/MEMBER；`WorkspaceSelection` 只是导航状态。学习正文继续 owner-only，直到 v1.5 policy/grant 明确授权。
- 身份邮件只由 server-only SMTP adapter 投递；生产配置不完整时 fail closed，587 端口强制 STARTTLS。
- 忘记密码对有效与未知账户保持相同响应，并使用统一最小时延和随机抖动降低枚举时间差；SMTP 长尾仍由未来持久后台邮件任务进一步隔离。
- 默认 `AUTH_MULTI_USER_ENABLED=false`。当前实现与隔离验证不等于新 Release 或生产启用。

## 审计

需要记录的安全事件：

- seed 创建管理员。
- 首次设置或设置页创建、归档、恢复科目与分组。
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
