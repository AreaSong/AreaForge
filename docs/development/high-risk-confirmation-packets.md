# 高风险确认包

## 目标

本文件把 AreaForge 从当前进度推进到 docs 100% 时必须先确认的高风险工作集中管理。只有用户明确确认某个确认包后，才能进入对应代码实现、migration、上传落盘、真实 AI 外呼或生产部署。

确认前必须回答：

- 影响：会改变哪些数据、文件、服务或隐私边界。
- 风险：最坏会坏在哪里。
- 验证：用哪些命令、API 烟测、页面烟测或恢复演练证明安全。
- 回滚：失败后如何回到可用状态。

## Package A：附件上传与鉴权访问

对应：

- `tasks/active/0004-mvp-syllabus-notes-upload.md`
- `docs/development/attachment-upload-access-design.md`

影响：

- Web 服务开始写入 `UPLOAD_DIR`。
- `Attachment` metadata 与文件本体共同构成持久化状态。
- `/notes` 将出现附件上传和下载入口。

实施范围：

- `POST /api/notes/:noteId/attachments`
- `GET /api/attachments/:id`
- `apps/web/lib/study/attachments-service.ts`
- `/notes` 附件列表、上传按钮和下载入口。

必须确认：

- 第一版附件只允许绑定 `noteId`。
- 只允许 PDF、PNG、JPEG、WebP。
- 上传目录不在 `public/`，不由 Nginx 静态暴露。
- DB 写入失败要补偿删除本次写入文件。
- 文件写入失败不得创建 metadata。
- 第一版不提供附件删除。

验证：

- `pnpm --filter @areaforge/storage test`
- `pnpm check`
- 未登录上传/下载返回 `401`。
- 上传允许类型成功。
- 超大、伪造 MIME、路径穿越、软链接逃逸失败。
- 下载响应含 `X-Content-Type-Options: nosniff` 和 `Cache-Control: private, no-store`。
- metadata hash 与磁盘文件 hash 一致。

回滚：

- 先禁用上传 API，保留下载。
- 不自动删除已有文件或 metadata。
- 孤儿文件只能先生成只读对账清单，再另行确认清理。

## Package B：结构化学习状态 migration

对应：

- `tasks/backlog/0015-structured-state-migration.md`
- `docs/development/structured-state-migration-design.md`

影响：

- 新增结构化学习状态表和字段。
- 首页、统计、报告、任务债务、恢复模式和掌握证明会逐步改读结构化数据。
- 需要 Prisma migration。

实施范围：

- `StudySession` 结构化收口字段。
- `CheckIn` 日快照。
- `StudyTask.parentTaskId`。
- `TaskDebtEvent`。
- `RecoveryState`。
- `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`。
- 后续批次可加入 `SimulationExam`、`StagePlan`、`StageAdjustmentDraft`。

推荐确认顺序：

1. Batch 0：`StudySession` 结构化收口字段。
2. Batch 1：`CheckIn` 日快照。
3. Batch 2：`StudyTask.parentTaskId` 与 `TaskDebtEvent`。
4. Batch 3：`RecoveryState`。
5. Batch 4：掌握证明条件、证据和复测记录。
6. Batch 5：结构化 `SimulationExam` 与科目结果。
7. Batch 6：`StagePlan` 与 `StageAdjustmentDraft`。

### Batch 0 确认包：`StudySession` 结构化收口字段

Batch 0 是 Package B 的第一步，只把结束计时时已经存在于请求和 core 规则中的收口信息结构化落库，不新增 `CheckIn`、债务事件、恢复状态、掌握证明或模拟考试模型。

建议新增字段：

- `understandingLevel String?`
- `minimalOutput String?`
- `nextAction String?`
- `producedNote Boolean @default(false)`
- `producedMistake Boolean @default(false)`
- `isLowConversion Boolean?`
- `antiFakeReason String?`
- `requiredOutput String?`
- `closeoutVersion Int @default(1)`

代码范围：

- `prisma/schema.prisma` 和对应 additive migration。
- `apps/web/lib/study/service.ts` 的 `endStudySession` 写路径：写入结构化字段，同时继续写 `note = closeout.closeoutText`。
- `apps/web/lib/study/types.ts` 和 `serializeSession`：允许 API 返回结构化收口字段。
- 首页、统计和报告仍可优先兼容旧 `isEffective/note`，不在本批强制切换所有历史口径。
- 文档同步 `docs/architecture/data-model.md`、`docs/architecture/api-surface.md`、`docs/development/docs-100-completion-record.md` 和本任务状态。

影响：

- 新结束的学习计时会保存理解程度、最小产出、下一步动作、低转化原因和补产出要求。
- 历史 `StudySession.note` 不解析、不回填，旧记录仍按原文本展示。
- 新增字段会成为后续 `CheckIn`、反假学习统计、周/月报告和长期闭环的结构化输入。

风险：

- migration 或 Prisma Client 生成失败会影响 Web 构建。
- 新旧记录并存期间，历史 session 的结构化字段为空，统计必须保留 fallback。
- 若写路径只写结构化字段而漏写 `note`，旧 UI 和历史展示会退化。

验证：

- `pnpm db:validate`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：开始计时、结束计时、active session、dashboard、analytics、reports。
- 页面烟测：首页结束一次计时后刷新，仍能看到有效/低转化状态和收口文本。

回滚：

- 开发期优先回滚代码；已生成的临时库可直接丢弃。
- 若已部署 additive migration，优先回滚应用镜像，保留新增字段不删除。
- 不清理、不重写历史 `StudySession.note`；任何删除旧字段或回填压缩都另开任务确认。

### Package B 全批次通用确认

以下要求适用于 Package B 的 Batch 0-6。完成单个批次时，只能更新对应批次证据，不得把 Package B 整包标为完成。

`pnpm risk:preflight` 当前包含 Package B 确认前护栏：在用户确认并实施 Batch 0 前，结构化字段和模型必须不存在。Batch 0 获确认并完成后，需要同步调整该脚本，让它允许 Batch 0 已完成字段，同时继续阻止 Batch 1-6 在未确认前越界。

必须确认：

- migration 只做 additive，不删除旧字段。
- 旧文本字段继续可读。
- 历史数据只做可确定的轻量回填，不解析不可靠文本。
- 生产执行前必须备份数据库和上传目录。
- 任何批量删除、压缩历史或清理旧字段都另开任务确认。

验证：

- `pnpm db:validate`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`
- `pnpm --filter @areaforge/core test`
- `pnpm check`
- API 烟测：dashboard、tasks、study-sessions、reviews、syllabus、mistakes、analytics、reports、simulation。
- 页面烟测：首页、`/syllabus`、`/analytics`、`/reports`、`/simulation`。

回滚：

- 开发期优先回滚代码，不删除新增表字段。
- 临时库直接丢弃。
- 生产环境优先回滚镜像；如需恢复数据库，必须使用发布前备份。

## Package C：真实 AI Provider

对应：

- `tasks/backlog/0005-mvp-ai-discipline.md`
- `tasks/backlog/0017-ai-stage-privacy-cost.md`
- `docs/development/ai-provider-integration-design.md`

影响：

- `AI_ENABLED=true` 时会向 Sub2API / OpenAI-compatible provider 外呼。
- 可能产生费用和隐私泄露风险。
- AI 建议会影响用户每日复盘和明日任务判断，但不能自动覆盖记录。

实施范围：

- `packages/ai` OpenAI-compatible JSON provider。
- Web 层 env 驱动 provider 创建。
- 超时、重试、错误映射、限流、日志脱敏。
- 第一版仅接入鞭策、每日复盘建议、明日最小任务建议。

必须确认：

- 默认不发送动机档案。
- 默认不发送完整情绪记录。
- 默认不发送完整复盘正文。
- 不发送附件内容、PDF、图片内容。
- 不保存完整 prompt 或完整模型响应。
- 首页当前会在服务端取建议，真实外呼前必须避免打开首页即产生无意识成本，或保留首页本地 fallback。
- 长期阶段调整另行确认，不混入第一版 AI。

验证：

- `pnpm --filter @areaforge/ai test`
- `pnpm check`
- `AI_ENABLED=false` 三个 AI API 均本地 fallback。
- 配置缺失时不外呼并 fallback。
- mock provider 成功返回 `ai_generated`。
- provider 失败、非法 JSON、schema 不符时 fallback。
- 客户端 bundle 搜不到 `AI_API_KEY`。

回滚：

- 设置 `AI_ENABLED=false` 立即回到本地规则。
- 不需要数据回滚。
- 若发现隐私字段进入外呼，立即关闭 AI，保留脱敏日志摘要，审计字段来源。

## Package D：第二阶段长期闭环

对应：

- `tasks/backlog/0013-simulation-stage-adjustment.md`
- `tasks/backlog/0016-second-stage-long-term-loop.md`
- `docs/development/second-stage-long-term-loop-design.md`
- `workflow/versions/v0.4-second-stage-long-term-loop.md`

影响：

- 周审判、月复盘、任务债务、作战地图、遗忘风险和状态主题开始影响长期阶段判断。
- 可能改变用户下一阶段学习压力和任务排序。

实施范围：

- 结构化模拟考试、2026 年 12 月同步自测、阶段日记和阶段调整草稿的产品闭环。
- 周/月报告升级为阶段决策入口。
- 任务债务自动重排建议。
- 知识点遗忘风险和笔记复习提醒强化。
- 作战地图高级筛选和风险可视化。
- 状态主题、阶段称号、动机唤醒深度联动。

依赖关系：

- 结构化 `SimulationExam`、`StagePlan` 和 `StageAdjustmentDraft` 模型仍属于 Package B 的 migration 批次。
- 长期 AI 阶段调整外呼仍属于 Package C / `tasks/backlog/0017-ai-stage-privacy-cost.md` 的隐私与费用确认。
- Package D 负责把这些基础能力组合成第二阶段长期闭环，并保证所有建议用户确认前不应用。

必须确认：

- 所有重排和阶段调整只生成建议。
- 用户确认前不自动改任务、阶段计划或复盘。
- 风险可视化必须能追溯原因，不能只用压迫式文案。
- 建议 DTO 必须保持 `canAutoApply=false` 和 `requiresUserConfirmation=true`。
- Package B 未完成时，重排应用、阶段计划应用和结构化模拟考试写入必须禁用。
- Package C 未完成时，长期阶段调整只能使用本地规则，不能外呼。
- 确认、驳回或应用建议时必须写审计记录；部分应用失败时必须停止后续写入并返回失败摘要。

验证：

- `pnpm --filter @areaforge/core test`
- `pnpm check`
- 页面烟测：`/reports`、`/analytics`、`/syllabus`、首页。
- API 烟测：周期报告、统计、任务建议、考纲风险。
- 确认前边界烟测：不存在重排应用写 API；长期 AI 外呼关闭；建议均不可自动应用。
- 确认后应用烟测：确认、驳回、重复提交和部分失败都有可追溯结果。

回滚：

- 关闭建议应用入口。
- 保留只读报告和基础统计。
- 不自动删除建议、任务或阶段记录。
- 若部分应用失败，不自动批量恢复；先保留审计线索和失败摘要，再由用户确认是否执行单独修复。

## Package E：生产部署、备份与恢复

对应：

- `tasks/backlog/0014-deployment-backup-release.md`
- `docs/development/production-release-runbook.md`
- `workflow/versions/v1.0-prod-release.md`

影响：

- 应用进入生产环境。
- Prisma migration deploy、数据库、上传目录、生产 `.env`、镜像 tag 都成为发布状态的一部分。

实施范围：

- 生产 `docker-compose.prod.yml`。
- Next.js standalone Docker 镜像。
- Nginx HTTPS 反代。
- 发布前备份。
- 临时库和临时上传目录恢复演练。
- 发布后烟测和失败回滚。

必须确认：

- 生产 PostgreSQL 不暴露公网端口。
- Web 只绑定本机端口供 Nginx 反代。
- 发布前备份数据库、上传目录、生产 `.env`、当前镜像 tag。
- migration deploy 前必须有备份点。
- 不通过网页按钮触发部署、备份、恢复、migration 或服务器命令。

验证：

- `pnpm check`
- `docker compose config`
- `docker compose -f docker-compose.prod.yml config`
- 临时库恢复演练。
- 上传目录 metadata/文件本体对账。
- 发布后登录、首页、任务、计时、复盘、附件和 AI fallback 烟测。

回滚：

- 回滚上一镜像 tag。
- 如果只做 additive migration，优先只回滚应用镜像。
- 若必须恢复数据库和上传目录，使用发布前备份，并保证 metadata 与文件本体一致。
