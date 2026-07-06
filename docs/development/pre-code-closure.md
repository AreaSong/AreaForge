# 开发前闭环清单

## 目标

在进入真实业务代码开发前，先确认产品、架构、模块、版本和任务拆分已经对齐，避免后续一边写代码一边反复重定方向。

## 当前阶段结论

AreaForge 当前处于“开发前闭环已基本建立，业务 MVP 尚未实现”阶段。前期治理、任务路线和 MVP 前工程准备可以闭环，但不能宣称学习业务流程已经闭环。

## 必须闭环

- 文档入口：`docs/README.md` 覆盖所有文档目录。
- 产品范围：`docs/product/feature-scope.md` 明确第一版、第二阶段和暂缓项。
- 路线图：`docs/product/roadmap.md` 明确双节点计划和工程阶段。
- 工程结构：`docs/architecture/project-structure.md` 明确目录职责。
- 模块设计：`docs/modules/**` 覆盖第一版核心模块和第二阶段入口。
- UX 状态：`docs/ux/**` 覆盖作战台、专注计时、恢复模式和动态主题。
- 开发顺序：`docs/development/implementation-order.md` 明确真实 MVP 顺序。
- 工程准备：数据库迁移、环境变量、Docker、包边界和验证脚本有对应任务。
- 轻量规范：Codex 工作流、文档同步、验证矩阵、文件与 AI 安全边界有明确入口。
- 执行任务：`tasks/**` 拆出当前可执行事项。
- 版本计划：`workflow/versions/**` 明确 v0.1 的范围和验收标准。

## 暂不进入代码实现的事项

- 登录、任务、计时、打卡、复盘真实实现。
- 后续业务 schema migration 和 seed。
- 文件上传与鉴权下载。
- AI 实际调用。
- GitHub Release 自动部署。

这些事项必须在前期闭环完成后，按 `docs/development/implementation-order.md` 和 `workflow/versions/v0.1-mvp.md` 逐步推进；其中认证、业务 migration、上传和 AI 边界变化仍属于高风险任务。

## 开发前验收门禁

- 旧顶层方案文件无残留引用。
- `docs/README.md`、`README.md`、`AGENTS.md` 的入口路径一致。
- `tasks/active` 有当前任务。
- `tasks/backlog` 有后续任务。
- `workflow/versions` 有第一版计划。
- 第一版范围和暂缓项没有冲突。
- 高风险边界在 `AGENTS.md` 和 `docs/security/threat-model.md` 中都有提示。
- 文档同步、验证矩阵、文件与 AI 安全边界有独立文档入口。
- 工程准备断点已进入 backlog，不在后续开发中口头处理。

## 已处理的工程准备项

- 已建立初始 Prisma migration：`prisma/migrations/20260706000000_init/migration.sql`。
- `.env.example`、根脚本和本地 `docker-compose.yml` 默认数据库连接已统一。
- 已拆分本地 `docker-compose.yml` 和生产 `docker-compose.prod.yml`，生产不暴露 PostgreSQL 端口。
- `apps/web` 已声明 `packages/db/ai/storage/config/ui/core` 依赖，并同步 `transpilePackages`。
- 已移除未接入脚本的 `turbo.json`，当前使用 pnpm workspace 直接编排。
- `packages/core` 已通过独立 TS 配置移除 DOM lib 和 ambient types。
- `.dockerignore` 已补齐 generated、tsbuildinfo、dist/build/out 等本地生成物。
- 已将 `packageManager` 对齐到 pnpm 11.7.0，并在 `pnpm-workspace.yaml` 声明 `onlyBuiltDependencies` 与 `allowBuilds`。

## 后续仍需单独确认

- 认证、会话和登录限速实现。
- 新增或修改业务 schema 的 migration。
- seed 写入策略。
- 附件上传、删除和上传目录迁移。
- AI 默认上下文和敏感数据发送策略。

## 轻量规范入口

- `docs/development/codex-workflow.md`：协作方式、任务分级、子代理和收尾报告。
- `docs/development/doc-sync-checklist.md`：源事实同步和旧引用检查。
- `docs/development/validation-matrix.md`：最小充分验证集合。
- `docs/security/file-ai-safety.md`：上传、附件、AI 和备份恢复安全边界。
