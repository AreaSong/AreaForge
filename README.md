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
docker compose up -d postgres
pnpm db:generate
pnpm dev
```

Web 应用默认位于 `apps/web`。

默认开发数据库连接为 `postgresql://areaforge:areaforge@127.0.0.1:54329/areaforge`，与 `.env.example`、根脚本和本地 `docker-compose.yml` 保持一致。

## 常用命令

```bash
pnpm typecheck
pnpm lint
pnpm db:validate
pnpm build
pnpm check
```

## 文档入口

- 文档总览与源事实入口：`docs/README.md`
- 产品入口：`docs/product/charter.md`
- PRD：`docs/product/prd.md`
- 功能范围：`docs/product/feature-scope.md`
- 路线图：`docs/product/roadmap.md`
- 架构总览：`docs/architecture/overview.md`
- 工程结构：`docs/architecture/project-structure.md`
- 模块设计：`docs/modules/**`
- UX 状态：`docs/ux/**`
- 开发顺序：`docs/development/implementation-order.md`
- 开发前闭环：`docs/development/pre-code-closure.md`
- 协作工作流：`docs/development/codex-workflow.md`
- 验证矩阵：`docs/development/validation-matrix.md`
- 部署与备份：`docs/deployment/**`
- 安全模型：`docs/security/threat-model.md`
- 文件与 AI 安全：`docs/security/file-ai-safety.md`
- 技术决策：`docs/adr/**`
- 轻量任务：`tasks/**`
- 版本规划：`workflow/**`
