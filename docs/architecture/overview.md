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

## 能力域

各层承载的能力：

- Web 应用：作战台真实数据库聚合、每日任务 CRUD、专注计时持久化、每晚复盘、考纲树与笔记、错题、掌握证明显式记录、动机封存、情绪标签、阶段称号、基础统计、作战地图筛选、周/月报告、结构化模拟考试和恢复模式。
- 认证与会话：单管理员登录、数据库会话、`HttpOnly` Cookie、登录限速；seed 初始化管理员和基础科目。
- 结构化状态：`CheckIn` 日快照、`TaskDebtEvent` 事件账本、`RecoveryState` 恢复状态、计时收口判断，支撑任务债务、打卡检查、反假学习和恢复模式闭环。
- `packages/core`：结构化收口、近窗打卡历史、轻量任务债务动作、掌握证明、作战地图状态、阶段称号、动机唤醒、模拟准备度、模拟结果复盘和阶段调整草稿等平台无关规则。
- `packages/ai`：本地规则 fallback、结构化 schema、OpenAI-compatible JSON provider、mock/外呼测试和敏感上下文拦截。
- `packages/storage`：附件上传纯规则安全底座；Web 层实现 noteId 绑定附件上传、私有落盘和鉴权下载。
- 发布与运维：GitHub Release 签名发布（SBOM/provenance、checksum、cosign、GHCR digest，stable 签名 fail closed）、服务器侧 updater 受控更新、备份/恢复/回滚流程；Web 版本中心只提交受控请求。

## 暂缓项

AI 自动完整学习计划、复杂 PDF 自动解析、小程序、原生 App、多用户、排名系统、复杂权限系统，以及 Web runtime 直接执行服务器命令的一键运维入口。

功能实现进度以 [功能追踪矩阵](../development/feature-traceability.md) 为准；生产与发布的当前状态、残余风险以 [运营 readiness](../development/operational-readiness.md) 和 [残余风险台账](../development/residual-risk-ledger.md) 为准。
