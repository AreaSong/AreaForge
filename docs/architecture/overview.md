# 架构总览

AreaForge 使用 monorepo 分层：

- `apps/web`：Next.js Web 应用入口，负责页面、路由、登录会话、上传入口和 API 薄封装。
- `packages/core`：平台无关业务规则，如风险等级、任务债务、恢复模式、计时状态和反假学习检查。
- `packages/db`：Prisma Client 与数据库访问边界。
- `packages/ai`：AI 适配、结构化校验和本地回退文案。
- `packages/storage`：附件上传策略、文件类型与大小限制。
- `packages/ui`：可复用 UI token 和组件。
- `prisma`：数据模型与 migrations。
- `infra`：Docker、Nginx 和部署配置。

核心原则：

- 页面不直接写复杂业务规则。
- React 组件不直接访问数据库。
- AI 不直接修改用户数据。
- 上传文件不放在 `public/` 下。
- PostgreSQL 保存结构化状态，附件目录保存文件本体。

