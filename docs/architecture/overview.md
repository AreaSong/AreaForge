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
- Next.js Web 应用骨架与主要工作页。
- Prisma schema。
- Docker Compose 基础。
- 首页作战台真实数据库聚合。
- 单管理员登录、数据库会话、`HttpOnly` Cookie 和登录限速。
- 数据库 seed 初始化管理员和基础科目。
- 每日任务 CRUD。
- 专注计时持久化。
- 每晚复盘保存。
- 考纲树与笔记基础 API/UI。
- 任务债务、打卡检查、反假学习和恢复模式低风险闭环：规则推导、首页展示、恢复任务裁剪、补做/拆小/改复习轻量流转和计时收口判断。
- `packages/core` 已沉淀结构化收口、近窗打卡历史、轻量任务债务动作、掌握证明、作战地图状态、阶段称号、动机唤醒、模拟准备度、模拟结果复盘和阶段调整草稿等平台无关规则。
- 错题、掌握证据计数、动机封存、情绪标签、阶段称号、基础统计、作战地图筛选、周/月报告和模拟考试基础入口。
- `packages/ai` 已提供本地规则 fallback、结构化 schema、非外呼 provider 抽象、mock 测试和敏感上下文拦截。
- `packages/storage` 已提供附件上传前纯规则安全底座。

尚未完成：

- 附件上传、文件落盘和鉴权下载/预览。
- AI 真实外部 provider 调用。
- 结构化 `CheckIn`、任务债务事件账本、结构化计时收口字段和恢复状态。
- 掌握证明条件、证据引用表和复测记录。
- 完整 `SimulationExam`、阶段计划和 AI 阶段调整。
- 生产部署、备份、恢复和发布闭环。
