# API Surface

## 原则

- 所有写操作必须服务端鉴权。
- Route Handler / Server Action 不写复杂业务规则。
- 参数校验集中使用 schema。
- 返回结构稳定，方便后续桌面端和移动端复用。
- AI、上传、数据库写入都需要失败回退或明确错误。

## 第一版 API 分组

### Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

认证 API 原则：

- `login` 校验 email、password 和基础限速，通过后创建数据库会话并写入 `HttpOnly` Cookie。
- `logout` 删除或失效当前会话，并清除 Cookie。
- `me` 只返回最小用户信息，例如 id 和 email。
- 所有认证 API 都不返回密码哈希、session token 明文或内部错误堆栈。

### Dashboard

- `GET /api/dashboard/today`

### Tasks

- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/complete`
- `POST /api/tasks/:id/defer`
- `POST /api/tasks/:id/drop`

### Timer

- `GET /api/study-sessions/active`
- `POST /api/study-sessions/start`
- `POST /api/study-sessions/:id/pause`
- `POST /api/study-sessions/:id/resume`
- `POST /api/study-sessions/:id/end`

计时写入原则：

- 不每秒写数据库。
- 状态变化时写入。
- 支持刷新页面后恢复 active session。
- 同一用户第一版只允许一个 active session。

### Syllabus

- `GET /api/syllabus`
- `POST /api/syllabus/nodes`
- `PATCH /api/syllabus/nodes/:id`
- `POST /api/syllabus/import-markdown`

### Notes / Attachments

- `GET /api/notes`
- `POST /api/notes`
- `POST /api/attachments`
- `GET /api/attachments/:id`

附件不通过 public 直接暴露，必须走鉴权接口。

### Review

- `GET /api/reviews/today`
- `POST /api/reviews/today`

### AI

- `POST /api/ai/discipline`
- `POST /api/ai/daily-review`
- `POST /api/ai/tomorrow-plan`

AI API 只返回建议，不直接修改用户原始数据。
