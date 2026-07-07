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

- `tasks/done/0004-mvp-syllabus-notes-upload.md`
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

明确确认句：

> 确认执行 Package A：附件上传与鉴权访问。范围仅限 noteId 绑定的 PDF/PNG/JPEG/WebP 上传与鉴权下载、metadata/hash/URI 写入、UPLOAD_DIR 私有落盘、DB/文件补偿和 `/notes` UI；不包含附件删除、错题/模拟/阶段附件、AI 解析、生产部署或孤儿文件清理。

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

### Batch 1 确认包：`CheckIn` 日快照

Batch 1 只新增每日打卡快照，用于把当前由 session/task/review 实时派生的连续性、低效天和低转化天记录成可审计状态。它不新增债务事件、恢复状态、掌握证明、模拟考试或阶段计划模型。

建议新增模型：

- `model CheckIn`
- `id String @id @default(cuid())`
- `studyDate DateTime @unique`
- `completedMinimumAction Boolean @default(false)`
- `totalMinutes Int @default(0)`
- `effectiveMinutes Int @default(0)`
- `effectiveSessionCount Int @default(0)`
- `taskCompletionRate Float @default(0)`
- `reviewSubmitted Boolean @default(false)`
- `lowEfficiency Boolean @default(false)`
- `lowConversionCount Int @default(0)`
- `sourceVersion Int @default(1)`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

代码范围：

- `prisma/schema.prisma` 和对应 additive migration。
- `apps/web/lib/study/service.ts`：结束计时、任务状态变化和每日复盘保存后 upsert 当日 `CheckIn`。
- `apps/web/lib/study/analytics-service.ts` 和 `apps/web/lib/study/reports-service.ts`：优先读取 `CheckIn` 快照；没有快照的日期 fallback 到现有 session/task/review 派生逻辑。
- `apps/web/lib/study/types.ts`：必要时暴露 dashboard/check-in DTO 的快照来源字段。
- 文档同步 `docs/architecture/data-model.md`、`docs/architecture/api-surface.md`、`docs/development/docs-100-completion-record.md` 和本任务状态。

影响：

- 新写路径会在同一学习日聚合总时长、有效时长、有效 session 数、任务完成率、复盘状态、低效标记和低转化计数。
- 首页连续打卡、统计连续性和报告低效天可以逐步从 `CheckIn` 获得稳定口径。
- 周/月 `taskCompletionRate` 默认使用逐日快照平均值；如后续需要任务数加权完成率，必须继续读取任务明细或另行确认补充 `taskCount/completedTaskCount`。
- 历史日期没有快照时继续使用当前派生逻辑；本批不推断用户没有实际记录过的打卡状态。

风险：

- upsert 时机遗漏会导致快照滞后，首页、统计和报告看到的连续性口径不一致。
- 若把无快照历史日误判为未打卡，会造成连续性突然下降。
- migration 或 Prisma Client 生成失败会影响 Web 构建。
- 若任务、复盘和计时并发写入同一天快照，必须保证 upsert 可重复且最终聚合一致。

验证：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：结束计时后生成/更新当日 `CheckIn`；保存复盘后 `reviewSubmitted=true`；任务完成率变化后快照更新；dashboard、analytics、reports 读取快照且缺失日期 fallback 正常。
- 页面烟测：首页、`/analytics`、`/reports` 刷新后连续性、低效天和低转化提示保持一致。

回滚：

- 开发期优先回滚代码；临时库可直接丢弃。
- 若已部署 additive migration，优先回滚应用镜像，保留 `CheckIn` 表不删除。
- 不批量删除或重写历史 session/task/review；如需清理错误快照，另开数据修复确认。

明确确认句：

> 确认执行 Package B Batch 1：CheckIn 日快照。范围仅限新增 `CheckIn` additive migration、结束计时/复盘/任务创建、计划日期或状态变化后的当日快照 upsert、dashboard/analytics/reports 优先读快照并保留缺失日期 fallback；不包含 Batch 2-6、生产 migration deploy、历史数据删除或不可靠回填。

### Batch 2 确认包：`StudyTask.parentTaskId` 与 `TaskDebtEvent`

Batch 2 只新增任务父子关系和债务事件账本，用于把补做、延期、放弃、拆小、合并、改复习等动作从文本说明升级为可审计事件。它不新增 `RecoveryState`、掌握证明、模拟考试或阶段计划模型。

建议新增字段和模型：

- `StudyTask.parentTaskId String?`
- `parent StudyTask? @relation("TaskTree", fields: [parentTaskId], references: [id])`
- `children StudyTask[] @relation("TaskTree")`
- `model TaskDebtEvent`
- `id String @id @default(cuid())`
- `taskId String`
- `actorId String?`
- `action String`：`recover/defer/drop/split/merge/convert_review/complete/reorder_suggested/reorder_applied`
- `fromStatus String?`
- `toStatus String?`
- `fromDebtStatus String?`
- `toDebtStatus String?`
- `relatedTaskId String?`
- `reason String?`
- `metadata Json?`
- `createdAt DateTime @default(now())`
- 索引建议：`StudyTask.parentTaskId`、`TaskDebtEvent.taskId`、`TaskDebtEvent.relatedTaskId`、`TaskDebtEvent.createdAt`。

代码范围：

- `prisma/schema.prisma` 和对应 additive migration。
- 任务债务动作写路径：补做、延期、放弃、拆小、合并、改复习和完成动作写 `TaskDebtEvent`。
- 拆小任务时写 `parentTaskId`，同时继续保留现有 `reviewText` 说明。
- 继续双写或保留现有 `AuditEvent`，不得用债务事件替代审计记录。
- 旧任务没有债务事件时，仍按 `StudyTask.status/debtStatus/plannedDate` 判断欠账。
- `GET /api/tasks/debt-reorder` 仍保持只读；`reorder_suggested`、`reorder_applied` 仅作为后续 Package D 的事件值预留，未确认前不新增重排应用写 API。
- 文档同步 `docs/architecture/data-model.md`、`docs/architecture/api-surface.md`、`docs/modules/task-debt.md`、`docs/development/docs-100-completion-record.md` 和本任务状态。

影响：

- 新任务债务动作会形成可追溯事件流。
- 拆小后的子任务能回到父任务，避免只靠文本说明判断来源。
- 周/月报告和后续长期闭环可以基于事件统计欠账变化。

风险：

- 事件写入遗漏会导致 UI 状态和账本不一致。
- 若旧任务被强行猜测父子关系，会制造错误追溯链。
- 若只写 `TaskDebtEvent` 而漏写现有任务状态或审计记录，当前页面和报告会退化。
- 若只读重排建议产生写副作用，会破坏确认前边界。
- 不自动应用任务重排；任何应用写路径必须另走 Package D 确认。

验证：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：补做、延期、放弃、拆小、改复习和完成动作写入 `TaskDebtEvent`；拆小任务带 `parentTaskId`；`GET /api/tasks/debt-reorder` 仍没有写副作用。
- 页面烟测：首页任务区和任务债务操作后状态、事件和旧展示保持一致。

回滚：

- 开发期优先回滚代码；临时库可直接丢弃。
- 若已部署 additive migration，优先回滚应用镜像，保留新增字段和 `TaskDebtEvent` 表不删除。
- 不批量删除或重写历史任务；如需修复错误事件，另开数据修复确认。

明确确认句：

> 确认执行 Package B Batch 2：新增 `StudyTask.parentTaskId` 与 `TaskDebtEvent` additive migration；债务相关任务动作双写现有 `AuditEvent` 和新事件账本；拆小任务写入父子关系；旧任务保留 fallback，不回填、不删除、不自动应用重排、不执行生产 migration deploy。

### Batch 3 确认包：`RecoveryState`

Batch 3 只新增恢复模式持久化状态，用于记录规则触发、用户手动触发、目标分钟、可见任务限制和退出条件。它不批量修改历史欠账，不新增掌握证明、模拟考试或阶段计划模型。

建议新增模型：

- `model RecoveryState`
- `id String @id @default(cuid())`
- `status String`：`active/completed/canceled`
- `triggerType String`：`rule/manual`
- `startedAt DateTime @default(now())`
- `endedAt DateTime?`
- `targetMinutes Int`
- `visibleTaskLimit Int`
- `reason String`
- `exitCondition String?`
- `metadata Json?`
- `actorId String?`
- 索引建议：`status`、`startedAt`、`endedAt`。

代码范围：

- `prisma/schema.prisma` 和对应 additive migration。
- 首页和 dashboard 优先读取 active `RecoveryState`；没有 active 状态时继续使用 `createRecoveryPlan` 实时规则。
- 用户主动“我需要恢复”只创建 active 状态，不删除、不隐藏原任务。
- 恢复完成、取消或退出只更新 `RecoveryState.status/endedAt/exitCondition`，不自动批量改历史欠账。
- 文档同步 `docs/architecture/data-model.md`、`docs/architecture/api-surface.md`、`docs/modules/recovery-mode.md`、`docs/development/docs-100-completion-record.md` 和本任务状态。

影响：

- 恢复模式从一次性派生建议变成可追踪状态。
- 用户手动触发和退出恢复可以被报告和长期闭环引用。
- 首页恢复任务裁剪会有持久化依据。

风险：

- active 状态没有正确退出会导致首页长期停留在恢复模式。
- 自动创建过多恢复状态会污染长期报告。
- 若恢复模式批量改任务，会把“帮助重新启动”变成不可逆计划改写。

验证：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：创建 active 恢复状态、dashboard 优先读取、完成/取消后退出、无 active 状态 fallback 实时规则。
- 页面烟测：首页恢复模式任务裁剪、手动触发、退出后恢复正常任务展示。

回滚：

- 开发期优先回滚代码；临时库可直接丢弃。
- 若已部署 additive migration，优先回滚应用镜像，保留 `RecoveryState` 表不删除。
- 不批量改回任务状态；错误恢复记录只读保留，清理需另开确认。

明确确认句：

> 确认执行 Package B Batch 3：新增 `RecoveryState` additive migration；记录规则触发和手动触发的恢复状态；首页优先读取 active 恢复状态并保留实时规则 fallback；完成或取消恢复只更新 `RecoveryState`，不批量修改历史欠账、不隐藏或删除任务、不执行生产 migration deploy。

### Batch 4 确认包：掌握证明条件、证据和复测记录

Batch 4 只新增考纲掌握证明的显式记录，用于把条件勾选、证据引用和延迟复测从 `_count` 推断升级为可审计数据。它不新增模拟考试、阶段计划或 AI 阶段调整模型。

建议新增模型：

- `model MasteryConditionRecord`
- `syllabusNodeId String`
- `condition String`：`course_or_textbook/own_explanation/basic_exercise/comprehensive_exercise/mistake_reviewed/delayed_retest`
- `checked Boolean @default(false)`
- `checkedAt DateTime?`
- `actorId String?`
- `@@unique([syllabusNodeId, condition])`
- `model MasteryEvidence`
- `syllabusNodeId String`
- `evidenceType String`：`task/session/note/mistake/retest`
- `taskId String?`
- `sessionId String?`
- `noteId String?`
- `mistakeId String?`
- `retestId String?`
- `summary String?`
- `createdAt DateTime @default(now())`
- `actorId String?`
- `model MasteryRetest`
- `syllabusNodeId String`
- `testedAt DateTime`
- `result String`：`passed/failed/partial`
- `score String?`
- `summary String?`
- `nextReviewAt DateTime?`
- `actorId String?`
- 索引建议：所有外键字段、`MasteryRetest.testedAt`、`MasteryEvidence.createdAt`。

代码范围：

- `prisma/schema.prisma` 和对应 additive migration。
- 考纲页面新增条件勾选、证据引用和复测记录写路径。
- 标记 `mastered` 时优先读取显式记录，并继续调用 `evaluateMasteryProof`。
- 没有显式证据时 fallback 现有 `_count` 证据计数。
- 复测失败或部分通过只生成下一步动作建议，不自动降低节点状态。
- 文档同步 `docs/architecture/data-model.md`、`docs/architecture/api-surface.md`、`docs/modules/mastery-proof.md`、`docs/development/docs-100-completion-record.md` 和本任务状态。

影响：

- 掌握证明可以追溯到任务、计时、笔记、错题和复测。
- 考纲节点从“看起来有证据”升级为“证据是什么”可检查。
- 后续遗忘风险和作战地图可以读取更稳定的证据时间线。

风险：

- 显式证据和旧 `_count` fallback 并存时，掌握状态可能出现口径差异。
- 若复测失败自动降级，会造成用户进度被不可预期改写。
- 若错误关联证据，会污染节点掌握判断。

验证：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：条件勾选、证据引用、复测记录、标记 mastered 的规则拦截、无显式证据 fallback。
- 页面烟测：`/syllabus` 条件、证据、复测和历史 `_count` fallback 展示正常。

回滚：

- 开发期优先回滚代码；临时库可直接丢弃。
- 若已部署 additive migration，优先回滚应用镜像，保留新增表不删除。
- 不批量回填、不删除旧节点字段；错误证据修复另开确认。

明确确认句：

> 确认执行 Package B Batch 4：掌握证明条件、证据和复测记录。范围仅限新增 `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest` additive migration，新增条件勾选、证据引用、复测记录写入，考纲掌握证明优先读显式记录并保留 `_count` fallback；不包含 Batch 5/6、历史文本解析回填、删除旧字段、复测失败自动降级或生产 migration deploy。

### Batch 5 确认包：结构化 `SimulationExam` 与科目结果

Batch 5 只新增结构化模拟考试和科目结果模型，用于替代当前 `StudyTask.type = "simulation_exam"` 的文本化主写入。它不新增 `StagePlan`、`StageAdjustmentDraft`，不应用阶段调整，不接真实 AI。

建议新增模型：

- `model SimulationExam`
- `id String @id @default(cuid())`
- `name String`
- `examDate DateTime`
- `isFirstSynchronized Boolean @default(false)`
- `targetDurationMinutes Int?`
- `actualDurationMinutes Int?`
- `targetScore Float?`
- `actualScore Float?`
- `blankQuestionCount Int @default(0)`
- `lossReasons Json?`
- `mindset String?`
- `summary String?`
- `reviewText String?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`
- `model SimulationSubjectResult`
- `simulationExamId String`
- `subjectId String`
- `targetScore Float?`
- `actualScore Float?`
- `durationMinutes Int?`
- `blankQuestionCount Int @default(0)`
- `lossReasons Json?`
- `summary String?`
- 索引建议：`SimulationExam.examDate`、`SimulationExam.isFirstSynchronized`、`SimulationSubjectResult.simulationExamId`、`SimulationSubjectResult.subjectId`、`@@unique([simulationExamId, subjectId])`。

代码范围：

- `prisma/schema.prisma` 和对应 additive migration。
- 新建模拟考试优先写 `SimulationExam`。
- 保存模拟结果时写考试汇总字段和 `SimulationSubjectResult`。
- `/simulation` 优先读取结构化模拟考试，旧 `StudyTask.type = "simulation_exam"` 只读兼容，不自动迁移。
- 模拟结果继续使用 `summarizeSimulationResult` 生成复盘建议。
- 本批不自动调整阶段计划；模拟结果进入阶段调整需等 Batch 6 和 Package D 确认。
- 文档同步 `docs/architecture/data-model.md`、`docs/architecture/api-surface.md`、`docs/modules/simulation-exam.md`、`docs/development/docs-100-completion-record.md` 和本任务状态。

影响：

- 2026 年 12 月第一次同步自测可以结构化保存。
- 分科目标分、实际分、用时、空题和失分原因可以进入报告与阶段判断。
- 旧任务型模拟仍能展示，但不再作为新模拟考试的主写入模型。

风险：

- 新旧模拟入口并存时可能重复展示同一场考试。
- 科目结果唯一性若缺失，会出现同一场同一科多条结果。
- 若自动迁移旧任务型模拟，可能从文本中错误推断分数和失分原因。

验证：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：创建结构化模拟考试、保存科目结果、同一场同一科唯一性、旧任务型模拟只读展示。
- 页面烟测：`/simulation` 列表、结果保存、刷新和第一次同步自测标记。

回滚：

- 开发期优先回滚代码；临时库可直接丢弃。
- 若已部署 additive migration，优先回滚应用镜像，保留新增表不删除。
- 旧任务型模拟只读路径必须仍可用；错误结构化记录清理另开确认。

明确确认句：

> 确认执行 Package B Batch 5：结构化模拟考试和科目结果。范围仅限新增 `SimulationExam`、`SimulationSubjectResult` additive migration，新建/保存模拟考试优先写结构化模型，`/simulation` 优先读结构化记录并只读兼容旧 `StudyTask.type = "simulation_exam"`；不包含 Batch 6、旧模拟任务自动迁移、阶段计划应用、真实 AI 外呼或生产 migration deploy。

### Batch 6 确认包：`StagePlan` 与 `StageAdjustmentDraft`

Batch 6 只新增阶段计划和阶段调整草稿模型，用于把当前本地规则草稿持久化，并保留用户确认边界。它不自动重排任务、不批量修改任务、不接长期 AI 外呼。

建议新增模型：

- `model StagePlan`
- `id String @id @default(cuid())`
- `name String`
- `startDate DateTime`
- `endDate DateTime`
- `goal String`
- `mode String`：`recovery/strengthen/sprint/maintain`
- `status String`：`draft/active/completed/archived`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`
- `model StageAdjustmentDraft`
- `id String @id @default(cuid())`
- `stagePlanId String?`
- `source String`：`local_rule/ai`
- `mode String`
- `risk String`
- `riskConclusion String`
- `focusSubjects Json`
- `taskIntensity String`
- `taskAdjustmentActions Json`
- `nextStageEmphasis String`
- `canAutoApply Boolean @default(false)`
- `requiresUserConfirmation Boolean @default(true)`
- `status String`
- `createdAt DateTime @default(now())`
- `appliedAt DateTime?`
- `actorId String?`
- 索引建议：`StagePlan.status`、`StagePlan.startDate`、`StagePlan.endDate`、`StageAdjustmentDraft.stagePlanId`、`StageAdjustmentDraft.status`、`StageAdjustmentDraft.createdAt`。

代码范围：

- `prisma/schema.prisma` 和对应 additive migration。
- 保存阶段计划。
- 生成并持久化阶段调整草稿，默认 `canAutoApply=false`、`requiresUserConfirmation=true`。
- 用户显式确认前只保存草稿，不改任务、阶段计划、复盘或节点状态。
- 若本批加入草稿应用写路径，必须展示变更摘要、写 `AuditEvent`，并处理重复提交和部分失败；不得自动应用。
- Package C 未确认前，长期阶段调整只能使用本地规则，不能真实 AI 外呼。
- 文档同步 `docs/architecture/data-model.md`、`docs/architecture/api-surface.md`、`docs/modules/ai-stage-adjustment.md`、`docs/development/docs-100-completion-record.md` 和本任务状态。

影响：

- 周/月报告和模拟考试可以引用明确的阶段计划。
- 阶段调整草稿从临时派生升级为可追溯建议。
- 第二阶段长期闭环具备阶段计划和草稿确认的数据库基础。

风险：

- 若草稿被自动应用，会改变用户长期学习压力和任务节奏。
- 若部分应用失败后继续执行，会造成阶段计划和任务状态不一致。
- 若 Package C 未确认就外呼长期 AI，会突破隐私和费用边界。

验证：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：阶段计划创建/更新、草稿生成、驳回、确认应用、重复提交、审计记录、长期 AI 外呼关闭。
- 页面烟测：`/simulation` 和 `/reports` 中阶段计划、草稿边界和确认状态展示一致。

回滚：

- 开发期优先回滚代码；临时库可直接丢弃。
- 若已部署 additive migration，优先回滚应用镜像，保留新增表不删除。
- 禁用草稿应用入口，保留阶段计划、草稿和审计；阶段异常时回到上一 active `StagePlan` 或撤销草稿状态，不删除历史记录。

明确确认句：

> 确认执行 Package B Batch 6：阶段计划和阶段调整草稿。范围仅限新增 `StagePlan`、`StageAdjustmentDraft` additive migration，保存阶段计划，持久化 `canAutoApply=false`、`requiresUserConfirmation=true` 的阶段调整草稿，并在用户显式确认时写入阶段计划变更和审计记录；不包含自动任务重排、批量修改任务、真实 AI 长期外呼、历史阶段删除或生产 migration deploy。

### Package B 全批次通用确认

以下要求适用于 Package B 的 Batch 0-6。完成单个批次时，只能更新对应批次证据，不得把 Package B 整包标为完成。

`pnpm risk:preflight` 当前已按 Batch 0 确认后的边界调整：允许 `StudySession` 结构化收口字段存在；Batch 1-6 则按 `docs/development/docs-100-completion-record.md` 的批次状态识别，未完成批次继续禁止对应 schema token，已完成批次要求对应 schema token 存在，并继续阻止后续未确认批次越界。

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

明确确认句：

> 确认执行 Package C：真实 AI Provider 第一版。范围仅限鞭策文案、每日复盘建议、明日最小任务建议的 OpenAI-compatible provider 接入、env 配置、超时/重试/限流/错误 fallback、日志脱敏和客户端密钥扫描；不包含长期阶段调整 AI、发送动机档案/完整情绪记录/完整复盘正文/附件内容、自动覆盖记录或保存完整 prompt/响应。

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

- 结构化 `SimulationExam`、`StagePlan` 和 `StageAdjustmentDraft` 模型已由 Package B 的 migration 批次提供；Package D 只负责在确认后组合长期决策、应用记录和审计流程。
- 长期 AI 阶段调整外呼仍属于 Package C / `tasks/backlog/0017-ai-stage-privacy-cost.md` 的隐私与费用确认。
- Package D 负责把这些基础能力组合成第二阶段长期闭环，并保证所有建议用户确认前不应用。

必须确认：

- 所有重排和阶段调整只生成建议。
- 用户确认前不自动改任务、阶段计划或复盘。
- 风险可视化必须能追溯原因，不能只用压迫式文案。
- 建议 DTO 必须保持 `canAutoApply=false` 和 `requiresUserConfirmation=true`。
- Package B 未完成时，重排应用、阶段计划应用和结构化模拟考试写入必须禁用；Package B 已完成后，Package D 仍不得绕过用户确认自动应用任务或阶段调整。
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

明确确认句：

> 确认执行 Package D：第二阶段长期闭环。范围仅限在 Package B/C 已完成的基础上实现周/月报告决策入口、债务重排确认流、遗忘风险、笔记复习提醒、作战地图高级可视化、状态主题和动机唤醒深度联动；所有建议保持用户确认前不应用，并写审计记录；不包含绕过 Package B/C、自动覆盖任务或阶段计划、未确认长期 AI 外呼、生产部署。

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
- `docker compose --env-file .env.example -f docker-compose.prod.yml config` 用于确认前结构校验；生产执行时必须使用真实生产 env。
- 临时库恢复演练。
- 上传目录 metadata/文件本体对账。
- 发布后登录、首页、任务、计时、复盘、附件和 AI fallback 烟测。

回滚：

- 回滚上一镜像 tag。
- 如果只做 additive migration，优先只回滚应用镜像。
- 若必须恢复数据库和上传目录，使用发布前备份，并保证 metadata 与文件本体一致。

明确确认句：

> 确认执行 Package E：生产部署、备份与恢复。范围仅限生产 compose/Nginx/镜像 tag 发布、发布前备份、必要 migration deploy、临时库和上传目录恢复演练、发布后烟测与失败回滚记录；不包含网页内触发部署/备份/恢复/服务器命令、无备份 migration、公开暴露 PostgreSQL 或上传目录。
