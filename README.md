# AreaForge

AreaForge 是一个面向个人长期备考的自我锻造与考研督战系统。

第一版目标是私有 Web 应用：用任务、专注计时、考纲进度、笔记资料、复盘、统计和 AI 鞭策，形成每天可执行的学习闭环。

## 技术栈

- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Docker Compose
- Sub2API / OpenAI 兼容 AI 接口

## 本地开发

```bash
pnpm install
pnpm db:generate
pnpm dev
```

Web 应用默认位于 `apps/web`。

## 常用命令

```bash
pnpm typecheck
pnpm lint
pnpm db:validate
pnpm build
pnpm check
```

## 文档入口

- 产品方案：`AreaForge产品方案.md`
- 工程结构：`AreaForge工程结构方案.md`
- 产品文档：`docs/product/**`
- 架构文档：`docs/architecture/**`
- 技术决策：`docs/adr/**`

