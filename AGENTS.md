# AreaForge Agent Guide

## 定位

- 本仓库是 AreaForge：面向个人长期备考的自我锻造与考研督战系统。
- 当前阶段优先实现私有 Web 应用，后续预留 PWA、桌面端和移动端。
- 对话、说明、提交说明、设计说明默认使用中文；代码标识符、类型名、文件名中的技术标识保持英文。

## 源事实

- 产品定位与功能边界：`AreaForge产品方案.md` 与 `docs/product/**`。
- 工程结构与分层：`AreaForge工程结构方案.md` 与 `docs/architecture/**`。
- 技术决策：`docs/adr/**`。
- 轻量任务：`tasks/**`。
- 版本规划：`workflow/**`。

## 工作原则

- 先读方案、上下文和最近的局部 `AGENTS.md`，再改代码。
- 第一版围绕“计划任务 -> 专注计时 -> 关联大纲 -> 产出笔记/错题 -> 晚间复盘 -> AI 鞭策 -> 明日调整”闭环。
- `packages/core` 放平台无关业务规则，不依赖 Next.js、React、Prisma、浏览器 API 或环境变量。
- `packages/db` 集中数据库访问；页面和组件不直接调用 Prisma。
- `packages/ai` 只生成建议或草稿，不直接覆盖用户记录。
- 上传文件不放入 `public/`，必须通过鉴权接口访问。
- PostgreSQL 是主状态源事实；上传目录保存文件本体，数据库只保存 metadata、hash 和 URI。

## 高风险边界

命中以下任一项时，先说明影响、风险、验证与回滚思路，再等待确认：

- 数据库 migration、数据修复、批量删除、清空记录。
- 删除附件、移动上传目录、修改备份/恢复策略。
- 认证、会话、权限、密钥、AI 调用隐私边界。
- 网页内触发部署、执行服务器命令、一键更新。
- 将动机档案、情绪记录、复盘正文发送给 AI 的默认策略变化。

## 验证要求

- 常规代码改动：运行 `pnpm check`，若耗时或环境不允许，至少运行相关 `typecheck`、`lint`、`db:validate`、`build`。
- `packages/core` 规则改动：补充或运行对应单元测试。
- UI 改动：能启动时用浏览器或截图检查主要页面状态。
- Prisma schema 改动：运行 `pnpm db:validate`。

