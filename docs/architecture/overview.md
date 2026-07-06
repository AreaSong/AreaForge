# 架构总览

## 分层

AreaForge 使用 pnpm workspace monorepo。

```text
apps/web        Next.js Web 应用入口
packages/core   平台无关业务规则
packages/db     Prisma 和数据库访问
packages/ai     AI 适配、校验和回退
packages/config 环境变量校验
packages/storage 附件上传策略
packages/ui     UI token 与共享组件
prisma          数据模型与 migration
infra           Docker、Nginx 和部署配置
docs            产品与架构源事实
```

## 调用方向

```text
apps/web -> packages/core
apps/web -> packages/db
apps/web -> packages/ai
apps/web -> packages/storage
apps/web -> packages/ui

packages/db -> prisma generated client
packages/ai -> Sub2API / OpenAI compatible API
```

`packages/core` 不依赖 Next.js、React、Prisma、浏览器 API 或环境变量。

## 核心原则

- 页面不直接写复杂业务规则。
- React 组件不直接访问数据库。
- API Route / Server Action 只做鉴权、参数校验和服务调用。
- AI 不直接修改用户数据。
- 上传文件不放在 `public/` 下。
- PostgreSQL 保存结构化状态，附件目录保存文件本体。
- 数据库 migration 不通过网页按钮触发。

## 当前工程状态

当前已经完成：

- monorepo 基础。
- Next.js Web 骨架。
- Prisma schema。
- Docker Compose 基础。
- 首页作战台雏形。
- 专注计时器前端状态。

尚未完成：

- 登录鉴权。
- 数据库真实读写。
- 任务和计时持久化。
- 文件上传。
- AI 实际调用。
- 部署自动化。

