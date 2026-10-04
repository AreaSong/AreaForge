# ADR 0001: 技术栈

## 决策

AreaForge 第一版采用：

- Next.js + React + TypeScript 作为 Web 应用。
- pnpm workspace 作为 monorepo 管理方式。
- PostgreSQL 作为主状态源事实。
- Prisma 作为 ORM 与 migration 工具。
- Docker Compose 作为部署基础。
- Sub2API / OpenAI 兼容接口作为 AI 适配目标。

## 原因

- Web 最符合当前电脑学习场景。
- pnpm workspace 方便后续拆分 Web、桌面、移动和共享业务核心。
- PostgreSQL 适合长期结构化记录、统计和迁移。
- Prisma 能把数据模型、迁移和类型检查串起来。
- Docker Compose 方便部署到已有 Ubuntu + Docker + Nginx 服务器。

