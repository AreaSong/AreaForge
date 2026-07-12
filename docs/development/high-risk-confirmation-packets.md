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

明确确认句：

> 确认执行 Package B Batch 0

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
- `GET /api/tasks/debt-reorder` 仍保持只读；Batch 2 当时仅预留 `reorder_suggested`、`reorder_applied` 事件值，Package D Batch D2 已在后续通过独立写入口完成确认、驳回和所选项应用记录。
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
- 长期阶段 AI 未单独确认前，阶段调整只能使用本地规则，不能真实 AI 外呼。
- 文档同步 `docs/architecture/data-model.md`、`docs/architecture/api-surface.md`、`docs/modules/ai-stage-adjustment.md`、`docs/development/docs-100-completion-record.md` 和本任务状态。

影响：

- 周/月报告和模拟考试可以引用明确的阶段计划。
- 阶段调整草稿从临时派生升级为可追溯建议。
- 第二阶段长期闭环具备阶段计划和草稿确认的数据库基础。

风险：

- 若草稿被自动应用，会改变用户长期学习压力和任务节奏。
- 若部分应用失败后继续执行，会造成阶段计划和任务状态不一致。
- 若长期阶段 AI 未单独确认就外呼，会突破隐私和费用边界。

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

`pnpm risk:preflight` 当前已按 Batch 0-6 完成后的边界调整：要求 `StudySession`、`CheckIn`、`TaskDebtEvent`、`RecoveryState`、掌握证明记录、`SimulationExam`、`StagePlan` 和 `StageAdjustmentDraft` 对应 schema/service/API/UI 证据存在，并继续阻止历史回填、删旧字段、批量改任务和未确认自动应用越界。

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

- `tasks/done/0005-mvp-ai-discipline.md`
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
- 长期阶段调整不混入第一版 AI；当前最小化长期阶段 AI 草稿显式入口已由 Package D Batch D3 单独确认并完成。

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

建议分批确认：

- Batch D1：报告决策入口。范围仅限周/月报告确认、驳回、生成下一周期草稿、报告决策审计和只读回放；不批量改任务、不自动改阶段计划、不外呼长期 AI。
- Batch D2：任务债务重排确认流。范围仅限对 `GET /api/tasks/debt-reorder` 的建议做确认、驳回和用户确认后的单项/小批量应用记录，复用 `TaskDebtEvent` 和 `AuditEvent`；不静默延期/删除任务，不自动应用全部建议，不新增 migration。
- Batch D3：长期阶段 AI 草稿。范围仅限使用最小化长期聚合字段生成 `StageAdjustmentDraft.source="ai"` 草稿，结构化校验失败回退本地规则；不发送动机档案、完整情绪记录、完整复盘正文、附件内容，不保存完整 prompt/响应，不自动应用阶段计划。
- Batch D4：长期风险和主题闭环补强。范围仅限把报告、遗忘风险、笔记复习提醒、作战地图筛选、阶段计划和首页状态主题的证据串联到页面/API；不新增生产部署，不引入多人排名或复杂 BI。
- Batch D5：Package D 收口。范围仅限 smoke、文档同步、completion record 和 feature-traceability 收口；不把 Package E 生产发布并入本包。

依赖关系：

- 结构化 `SimulationExam`、`StagePlan` 和 `StageAdjustmentDraft` 模型已由 Package B 的 migration 批次提供；Package D 只负责在确认后组合长期决策、应用记录和审计流程。
- 长期 AI 阶段调整最小草稿外呼已由 Package D Batch D3 确认完成；`tasks/backlog/0017-ai-stage-privacy-cost.md` 继续承接 AI 历史保存、费用账本、更大上下文字段或自动应用等新增边界。
- Package D 负责把这些基础能力组合成第二阶段长期闭环，并保证所有建议用户确认前不应用。

必须确认：

- 所有重排和阶段调整只生成建议。
- 用户确认前不自动改任务、阶段计划或复盘。
- 风险可视化必须能追溯原因，不能只用压迫式文案。
- 建议 DTO 必须保持 `canAutoApply=false` 和 `requiresUserConfirmation=true`。
- Package B 未完成时，重排应用、阶段计划应用和结构化模拟考试写入必须禁用；Package B 已完成后，Package D 仍不得绕过用户确认自动应用任务或阶段调整。
- 除 Package D Batch D3 显式 AI 草稿入口外，阶段调整只能使用本地规则，不能在普通页面、报告 GET、SSR 或后台任务中自动外呼。
- 确认、驳回或应用建议时必须写审计记录；部分应用失败时必须停止后续写入并返回失败摘要。

D1 最小实施契约：

- 允许新增 additive `PeriodicReportDecision` 持久模型，用单表记录报告类型、周期范围、决策状态、冻结的 `reportSnapshot`、下一周期草稿、确认边界、操作者和决策时间。
- 允许新增报告决策鉴权写入口和只读回放入口；确认和驳回只写 `PeriodicReportDecision` 与 `AuditEvent`，不改任务、阶段计划、复盘或考纲节点。
- 重复确认同一报告周期必须幂等或返回已处理结果；已确认后反向驳回应返回冲突或明确的已处理状态，不能静默覆盖。
- 逐批执行时只登记当前批次证据，不能提前把 Package D 主状态标为完成；当前 D1-D5 已全部完成，生产发布仍由 Package E 独立记录。

验证：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库 `pnpm db:migrate:deploy`
- `pnpm --filter @areaforge/core test`
- `pnpm check`
- 页面烟测：`/reports`、`/analytics`、`/syllabus`、首页。
- API 烟测：周期报告、统计、任务建议、考纲风险。
- 确认前边界烟测：不存在重排应用写 API；长期 AI 外呼关闭；建议均不可自动应用。
- 确认后应用烟测：确认、驳回、重复提交和部分失败都有可追溯结果。
- D1 专项烟测：确认周报生成报告决策、冻结快照、下一周期草稿和审计；驳回月报生成 rejected 决策和审计；确认或驳回前后 `StudyTask`、`TaskDebtEvent`、`StagePlan` 和 `StageAdjustmentDraft` 不变；历史回放读取冻结快照。

回滚：

- 关闭建议应用入口。
- 保留只读报告和基础统计。
- 不自动删除建议、任务或阶段记录。
- 若部分应用失败，不自动批量恢复；先保留审计线索和失败摘要，再由用户确认是否执行单独修复。

明确确认句：

> 确认执行 Package D：第二阶段长期闭环。范围仅限在 Package B/C 已完成的基础上实现周/月报告决策入口、债务重排确认流、遗忘风险、笔记复习提醒、作战地图高级可视化、状态主题和动机唤醒深度联动；所有建议保持用户确认前不应用，并写审计记录；不包含绕过 Package B/C、自动覆盖任务或阶段计划、未确认长期 AI 外呼、生产部署。

若要降低单次风险，也可以按上述 Batch D1-D5 逐批确认。每个批次完成时只更新对应证据，不能提前把 Package D 主状态标为完成。

分批明确确认句：

> 确认执行 Package D Batch D1：报告决策入口。范围仅限周/月报告确认、驳回、生成下一周期草稿、报告决策审计和只读回放；不批量改任务、不自动改阶段计划、不外呼长期 AI、不执行生产部署。

> 确认执行 Package D Batch D2：任务债务重排确认流。范围仅限对 `GET /api/tasks/debt-reorder` 的建议做确认、驳回和用户确认后的单项/小批量应用记录，复用 `TaskDebtEvent` 和 `AuditEvent`；不静默延期或删除任务，不自动应用全部建议，不新增 migration，不修改 `StagePlan` / `StageAdjustmentDraft`，不外呼长期 AI，不执行生产部署。

> 确认执行 Package D Batch D3：长期阶段 AI 草稿。范围仅限使用最小化长期聚合字段生成 `StageAdjustmentDraft.source="ai"` 草稿，结构化校验失败回退本地规则；不发送动机档案、完整情绪记录、完整复盘正文或附件内容，不保存完整 prompt/响应，不自动应用阶段计划，不执行生产部署。

> 确认执行 Package D Batch D4：长期风险和主题闭环补强。范围仅限把报告、遗忘风险、笔记复习提醒、作战地图筛选、阶段计划和首页状态主题的证据串联到页面/API；不新增生产部署，不引入多人排名或复杂 BI，不自动覆盖任务或阶段计划。

> 确认执行 Package D Batch D5：Package D 收口。范围仅限 smoke、文档同步、completion record 和 feature-traceability 收口；不把 Package E 生产发布并入本包，不执行生产部署。

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

建议分批确认：

- Batch E1：生产配置与发布工件预检。范围仅限校验 compose/Nginx/镜像 tag/生产 env 清单、migration deploy 执行载体、生成发布记录草案和中止条件；不执行生产部署、不运行生产 migration、不触碰生产数据库或上传目录。
- Batch E2：发布前备份与恢复演练。范围仅限在确认后的运维环境生成发布前备份、临时库导入、临时上传目录恢复和附件 metadata/hash 只读对账报告；不覆盖生产库，不删除生产备份，不执行应用切换，不自动修复 metadata 或移动上传文件。
- Batch E3：生产发布与 migration deploy。范围仅限在备份点存在后，通过明确的 release 工作目录或一次性 migration job 执行已确认的发布、必要 additive migration deploy、Nginx/compose 切换和发布后烟测；不执行无备份 migration，不公开暴露 PostgreSQL 或上传目录。
- Batch E4：回滚演练与 Package E 收口。范围仅限记录上一镜像 tag、失败回滚步骤、是否需要数据库/上传目录恢复、发布结果、残余风险、文档同步和 completion record；不新增网页内一键更新或服务器命令入口。

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

分批明确确认句：

> 确认执行 Package E Batch E1：生产配置与发布工件预检。范围仅限校验 compose/Nginx/镜像 tag/生产 env 清单、migration deploy 执行载体、生成发布记录草案和中止条件；不执行生产部署、不运行生产 migration、不触碰生产数据库或上传目录。

> 确认执行 Package E Batch E2：发布前备份与恢复演练。范围仅限在确认后的运维环境生成发布前备份、临时库导入、临时上传目录恢复和附件 metadata/hash 只读对账报告；不覆盖生产库，不删除生产备份，不执行应用切换，不自动修复 metadata 或移动上传文件。

> 确认执行 Package E Batch E3：生产发布与 migration deploy。范围仅限在备份点存在后，通过明确的 release 工作目录或一次性 migration job 执行已确认的发布、必要 additive migration deploy、Nginx/compose 切换和发布后烟测；不执行无备份 migration，不公开暴露 PostgreSQL 或上传目录。

> 确认执行 Package E Batch E4：回滚演练与 Package E 收口。范围仅限记录上一镜像 tag、失败回滚步骤、是否需要数据库/上传目录恢复、发布结果、残余风险、文档同步和 completion record；不新增网页内一键更新或服务器命令入口。

## 生产只读证据导出确认包：`AF-RISK-OPS-001`

本确认包用于在生产服务器上导出 `AF-RISK-OPS-001` 所需 redacted 证据，让生产只读 smoke、update-agent status、operational evidence bundle 和 OPS-001 closure packet 进入可人工复核关闭状态。它只授权一次只读证据导出，不授权生产更新、备份、恢复、migration、rollback、写入型 smoke 或 residual 台账关闭。

源事实：

- `docs/development/operational-readiness.md`
- `docs/development/ops-001-closure-packet-template.md`
- `docs/deployment/operator-onboarding.md`
- `ops/github-release-updater/README.md`
- `ops/update-agent/areaforge-ops001-evidence-export.sh`
- `ops/update-agent/areaforge-ops001-readonly-fallback.sh`
- `docs/development/residual-risk-ledger.md`

影响：

- 需要通过 SSH 登录生产服务器，并在服务器侧以具备读取 updater 配置、ops-state 和 smoke 密码文件权限的操作者执行 helper。
- helper 会读取 updater config、`status.json`、smoke 密码文件 metadata/凭据、生产 Web 只读 API 和本地仓库脚本。
- helper 会在指定输出目录生成 redacted 证据文件，供维护者带回本地校验。
- sudo 密码只允许在终端 TTY 输入，不得发到聊天、commit、issue、release record 或日志中。

实施范围：

- 在确认的生产主机上执行 `areaforge-ops001-evidence-export.sh`；若生产主机缺 Node.js/pnpm，可执行 `areaforge-ops001-readonly-fallback.sh` 导出 redacted 输入后回本地生成记录。
- 指定 updater config、ops-state 和输出目录。
- 生成并校验：
  - `redacted-update-status.json`
  - `prod-readonly-smoke-record.txt`
  - `operational-evidence-bundle.json`
  - `ops-001-closure-packet.txt`
  - `ops001-preflight-before-closure.json`
  - `ops001-preflight-after-closure.json`
  - `summary.txt`
- 将 redacted 证据带回本地后运行对应 validator 和 `pnpm ops:ops-001:preflight`。

推荐服务器命令形态：

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-ops001-evidence-export.sh \
  --config /etc/areaforge/updater.env \
  --state-dir /opt/areaforge/ops-state \
  --output-dir /tmp/areaforge-ops001-$(date -u +%Y%m%d%H%M%S)
```

若当前服务器临时 helper 位于 `/tmp/areaforge-ops001-evidence-export.sh`，执行前必须确认该文件内容与仓库 `ops/update-agent/areaforge-ops001-evidence-export.sh` 的只读边界一致。若使用 `areaforge-ops001-readonly-fallback.sh`，它只导出 `redacted-update-status.json`、`remote-prerequisites.json`、可选 `prod-readonly-smoke-output.log` 和 `remote-summary.txt`，不生成最终 closure packet，不关闭 residual 台账。

SSH/tmux 执行 fallback 时，先由操作者在 TTY 中完成 `sudo -v`，再运行一次 helper。fallback 输出目录必须使用 `/tmp/areaforge-ops001-fallback-*`，helper 才会把 redacted 目录移交给触发 sudo 的用户并在 `remote-summary.txt` 写入 `redactedHandoffStatus=granted`；若 handoff 未成功，不得用链式 `sudo tar/chown` 规避交互边界，应修正输出目录或重新通过 TTY 导出。

不包含：

- 不执行 updater `check`、`apply`、rollback、Web apply/rollback 请求或自动应用策略变化。
- 不执行生产 backup、restore、migration deploy、Docker/Nginx/compose 切换或上传目录操作。
- 不执行写入型 smoke，不创建/修改/删除任务、计时、附件、AI 记录或数据库数据。
- 不读取、打印、复制或提交生产 `.env`、数据库 URL、smoke 密码、cookie、session secret、备份本体、附件内容、上传目录、原始敏感日志或完整 status 私密字段。
- 不关闭 `AF-RISK-OPS-001` residual 台账；只生成可人工复核证据。

必须确认：

- 目标主机、登录用户、helper 路径、config 路径、state-dir 路径和输出目录。
- `AREAFORGE_EXTRA_SMOKE_COMMAND` 指向 `pnpm smoke:prod-readonly`，且 smoke 密码通过权限收紧的文件读取。
- helper 输出目录只包含 redacted 证据和 summary，不包含生产 env、密码文件、数据库 dump、附件内容或原始日志。
- `AREAFORGE_AUTO_APPLY` 仍为 `none`，除非另有独立确认包。
- 若任何子校验失败，只保留失败摘要和 redacted 输出，不补做生产写入、不执行 updater apply、不关闭 residual。

导出后本地验证：

```bash
pnpm smoke:prod-readonly:validate ./prod-readonly-smoke-record.txt
pnpm update-agent:status:validate ./redacted-update-status.json
pnpm ops:evidence:bundle:validate ./operational-evidence-bundle.json
pnpm ops:ops-001:closure:validate ./ops-001-closure-packet.txt
AREAFORGE_OPS001_SMOKE_RECORD=./prod-readonly-smoke-record.txt \
  AREAFORGE_OPS001_UPDATE_STATUS_RECORD=./redacted-update-status.json \
  AREAFORGE_OPS001_EVIDENCE_BUNDLE=./operational-evidence-bundle.json \
  AREAFORGE_OPS001_CLOSURE_PACKET=./ops-001-closure-packet.txt \
  pnpm ops:ops-001:preflight
```

中止条件：

- SSH、sudo、helper 路径、config、state-dir、status 文件或 smoke 密码文件不可用。
- `pnpm smoke:prod-readonly:config`、`pnpm smoke:prod-readonly`、update-agent status、evidence bundle、closure packet 或 OPS-001 preflight 任一失败。
- 输出包含生产 `.env`、数据库 URL、密码、cookie、session secret、备份本体、附件内容、上传目录、原始敏感日志或用户学习正文。
- helper 试图执行 updater apply、migration、backup、restore、rollback、生产写入或 residual 台账更新。

明确确认句：

> 确认执行 OPS-001 生产只读证据导出：范围仅限通过 SSH 在指定生产主机运行 `areaforge-ops001-evidence-export.sh` 的只读 redacted evidence export，收集 production read-only smoke record、redacted update-agent status、operational evidence bundle、OPS-001 closure packet 和 preflight 输出，并回本地运行对应 validate/preflight；不执行 updater apply、Web apply/rollback 请求、backup/restore、migration、rollback、Docker/Nginx/compose 切换、数据库写入、上传目录写入、写入型 smoke、读取/打印/复制/提交 secrets 或 residual 台账关闭。

> 确认执行 OPS-001 只读 fallback 导出：范围仅限在生产主机使用 sudo 读取 updater 配置、ops-state status 和 smoke 密码文件，通过 curl 执行生产只读 smoke，生成 redacted status 与 smoke output，并复制 redacted 文件回本地用仓库脚本生成/校验 smoke record、operational evidence bundle、OPS-001 closure packet 和 preflight；不安装 Node/pnpm，不执行 updater apply、backup/restore、migration、rollback、Docker/Nginx/compose 切换、数据库写入、上传目录写入、写入型 smoke、读取/打印/复制/提交 secrets 或 residual 台账关闭。

## 生产 smoke 凭据配置确认包：`AF-RISK-OPS-001`

本确认包用于补齐生产只读 smoke 的最小凭据配置，使 `AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly'` 可以在 update-agent/updater 的 root 上下文中读取 smoke 账号、密码文件和 HTTPS base URL。它只授权配置既有 smoke 账号凭据和权限，不授权创建生产账号、写入型 smoke、updater apply、备份、恢复、migration、rollback 或 residual 台账关闭。

源事实：

- `docs/development/ops-001-production-readonly-attempt-20260711.md`
- `docs/development/production-readonly-smoke-record-template.md`
- `docs/deployment/github-release-updater.md`
- `ops/github-release-updater/areaforge-updater.env.example`
- `ops/update-agent/areaforge-ops001-evidence-export.sh`
- `ops/update-agent/areaforge-ops001-readonly-fallback.sh`
- `docs/development/residual-risk-ledger.md`

影响：

- 需要通过 SSH/sudo 修改 `/etc/areaforge/updater.env` 中的 non-secret smoke 配置项。
- 需要在 root-only 或同等权限目录创建 smoke 密码文件，并设置为非 group/world readable。
- smoke 密码只能在服务器 TTY 或受控 secret 输入路径中写入；不得发到聊天、commit、issue、release record 或日志中。
- 配置后可以执行 `pnpm smoke:prod-readonly:config`、OPS-001 read-only export 或 curl fallback export，但仍不自动关闭 `AF-RISK-OPS-001`。

实施范围：

- 设置或确认：
  - `AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly'`
  - `AREAFORGE_SMOKE_BASE_URL=https://forge.areasong.top`
  - `AREAFORGE_SMOKE_EMAIL=<existing smoke account email>`
  - `AREAFORGE_SMOKE_PASSWORD_FILE=<root-only password file path>`
  - `AREAFORGE_SMOKE_EXPECTED_VERSION=<current production version>`
  - `AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none`
- 创建或更新 smoke 密码文件，权限必须为 `600` 或更严格。
- 只输出 redacted 配置摘要，例如 `email configured`、`password file configured`、`mode 600`，不得输出真实邮箱以外的敏感值；密码值永不输出。
- 配置后运行只读配置预检、OPS-001 只读证据导出或 fallback helper；若使用 fallback helper，仍需回本地生成并校验 smoke record、evidence bundle 和 closure packet。

不包含：

- 不创建、修改或删除生产用户；如果 smoke account 不存在，另走账号创建确认。
- 不执行写入型 smoke，不创建/修改/删除任务、计时、附件、AI 记录或数据库数据。
- 不执行 updater `check/apply`、Web apply/rollback 请求、自动应用策略变化、backup、restore、migration deploy、Docker/Nginx/compose 切换、rollback 或上传目录操作。
- 不读取、打印、复制或提交生产 `.env`、数据库 URL、session secret、GitHub token、cosign 私钥、smoke 密码、cookie、备份本体、附件内容、上传目录、原始敏感日志或用户学习正文。
- 不关闭 `AF-RISK-OPS-001` residual 台账；只允许补齐后续只读证据采集的凭据前置条件。

必须确认：

- smoke account 已存在，且只用于只读 smoke 或明确可接受只读登录检查。
- `AREAFORGE_SMOKE_PASSWORD_FILE` 路径不在 Git 工作区、public 目录、上传目录或备份导出临时目录中。
- 密码文件权限不允许 group/world read。
- `AREAFORGE_AUTO_APPLY` 仍为 `none`，除非另有独立确认包。
- 配置完成后只运行 `pnpm smoke:prod-readonly:config`、`pnpm smoke:prod-readonly` 或 OPS-001 read-only export；失败时不得补做生产写入。

配置后验证：

```bash
pnpm smoke:prod-readonly:config
pnpm smoke:prod-readonly
pnpm smoke:prod-readonly:record <prod-readonly-smoke-output.log> > <prod-readonly-smoke-record.txt>
pnpm smoke:prod-readonly:validate <prod-readonly-smoke-record.txt>
pnpm update-agent:status:validate <redacted-update-status.json>
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
AREAFORGE_OPS001_SMOKE_RECORD=<prod-readonly-smoke-record.txt> \
  AREAFORGE_OPS001_UPDATE_STATUS_RECORD=<redacted-update-status.json> \
  AREAFORGE_OPS001_EVIDENCE_BUNDLE=<operational-evidence-bundle.json> \
  AREAFORGE_OPS001_CLOSURE_PACKET=<ops-001-closure-packet.txt> \
  pnpm ops:ops-001:preflight
```

中止条件：

- smoke account 不存在或无法确认只读登录用途。
- 密码文件路径、权限或写入方式不满足 secret 边界。
- 任何命令输出包含 smoke 密码、cookie、session secret、数据库 URL、生产 `.env` 或用户学习内容。
- 配置动作试图触发 updater apply、backup、restore、migration、rollback、Docker/Nginx/compose 切换、生产写入或 residual 台账更新。

明确确认句：

> 确认执行 OPS-001 生产 smoke 凭据配置：范围仅限在指定生产主机通过 SSH/sudo 为既有 smoke 账号配置 `AREAFORGE_EXTRA_SMOKE_COMMAND`、`AREAFORGE_SMOKE_BASE_URL`、`AREAFORGE_SMOKE_EMAIL`、权限收紧的 `AREAFORGE_SMOKE_PASSWORD_FILE`、期望版本和 `AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none`，随后只运行只读 config/smoke/OPS-001 evidence export 和本地 validate/preflight；不创建生产账号、不执行写入型 smoke、updater apply、Web apply/rollback、backup/restore、migration、rollback、Docker/Nginx/compose 切换、数据库写入、上传目录写入、读取/打印/复制/提交 secrets 或 residual 台账关闭。

## 后续签名 Release 证据闭环确认包：`AF-RISK-SC-001`

本确认包用于后续某一次签名 GitHub Release 生成 SBOM/provenance、checksum、signature 和供应链记录，从而让 `AF-RISK-SC-001` 进入可人工复核关闭状态。`v0.1.7` 已作为 `v0.1.5` 之后的第一个补丁发布完成并生产应用；下一次使用本包时必须选择新的具体版本号，并在确认句中写明。

源事实：

- `docs/development/release-train.md`
- `docs/development/release-supply-chain-record-template.md`
- `docs/development/release-record-template.md`
- `docs/development/residual-risk-ledger.md`
- `.github/workflows/release.yml`

影响：

- 创建并推送新的 Git tag，会触发 GitHub Release workflow。
- GitHub Release workflow 会构建并发布 GHCR Web/migration 镜像和 Release assets。
- 该 Release 可作为后续服务器 updater 的候选版本。
- 若后续继续执行生产更新，还会进入服务器侧备份、migration、切换、smoke 和 rollback 证据链；这些不包含在本确认包内。

实施范围：

- 将所有 AreaForge workspace package version bump 到确认版本 `X.Y.Z`，并确保 tag `vX.Y.Z` 与根 `package.json` 一致。
- 在干净工作区完成发布前本地门禁。
- 创建并推送 `vX.Y.Z` tag，tag 必须指向已验证 commit。
- 等待 GitHub Release workflow 成功，并确认 stable signing 不是 unsigned placeholder。
- 下载或准备 Release assets 目录，至少包含 `areaforge-release-manifest.json`、`areaforge-sbom.spdx.json`、`areaforge-provenance.json`、`docker-compose.prod.yml`、`SHA256SUMS` 和 `SHA256SUMS.sig`。
- 生成并校验 `docs/development/release-supply-chain-vX.Y.Z.md`。
- 生成或更新 `docs/development/release-vX.Y.Z-record.md` 中的供应链摘要字段。

不包含：

- 不执行服务器 updater `apply`、Web 版本中心 apply/rollback 请求或生产切换。
- 不执行生产 backup、restore、migration deploy、rollback、Nginx/compose 改动或上传目录操作。
- 不启用 `AREAFORGE_AUTO_APPLY=patch` 或更强自动应用策略。
- 不关闭 `AF-RISK-SC-001` / `AF-RISK-SC-002` residual 台账；只生成可人工复核证据。
- 不读取、打印、提交 cosign 私钥、GitHub token、生产 `.env`、数据库 URL、smoke 密码、备份本体、附件内容或 AI prompt/raw response。
- 不把 CI-only 记录当成 `AF-RISK-SC-001` 的签名 Release 证据。

必须确认：

- 版本号、tag 和 package version 完全一致。
- Release workflow validate job 必须先通过；stable signing 缺 key 必须失败而不是发布 unsigned placeholder。
- Release assets 必须包含 manifest、SBOM、provenance、compose、`SHA256SUMS` 和 `SHA256SUMS.sig`。
- `SHA256SUMS` 必须覆盖 manifest/SBOM/provenance/compose。
- Web/migration image 必须使用不可变 digest。
- 任何生产更新、backup/restore、migration、rollback 或自动应用策略变化都另行确认。

发布前验证：

```bash
pnpm enterprise:operability:preflight
pnpm release:train:preflight
pnpm docs:readiness
pnpm docs:completion
pnpm risk:preflight
pnpm governance:preflight
pnpm github-release-updater:preflight
pnpm shellcheck:updater
pnpm release:supply-chain:selftest
pnpm release:supply-chain:record:selftest
pnpm ci:supply-chain:selftest
pnpm sc:sc-002:preflight:selftest
pnpm audit:prod
pnpm check
git diff --check
```

Release 资产生成后验证：

```bash
sha256sum -c SHA256SUMS
cosign verify-blob --key docs/deployment/keys/areaforge-cosign.pub --bundle SHA256SUMS.sig SHA256SUMS
AREAFORGE_SC002_RELEASE_RECORD=docs/development/release-supply-chain-vX.Y.Z.md pnpm sc:sc-002:preflight
pnpm release:supply-chain:validate docs/development/release-supply-chain-vX.Y.Z.md /path/to/release-assets
pnpm release:evidence:validate docs/development/release-vX.Y.Z-record.md
```

中止条件：

- 本地验证、CI validate job、Release workflow、`pnpm audit:prod`、Actions pinning、checksum 或 signature 任一失败。
- tag 与 `package.json` version 不一致，或 tag 不指向 workflow commit。
- Release asset 缺 manifest、SBOM、provenance、compose、`SHA256SUMS` 或 `SHA256SUMS.sig`。
- stable Release 仍出现 unsigned placeholder。
- 记录中出现密钥、生产 `.env`、数据库 URL、备份本体、附件内容、完整 prompt/raw response 或真实学习内容。
- 无法生成可通过 `pnpm release:supply-chain:validate` 的签名 Release 供应链记录。

明确确认句：

> 确认执行下一次签名 Release 证据闭环 v0.1.7：范围仅限将当前已验证 commit 的所有 AreaForge workspace package version bump 到 0.1.7，创建并推送 `v0.1.7` tag，等待 GitHub Release workflow 生成签名 Release assets、GHCR digest、SBOM/provenance、`SHA256SUMS` 和 `SHA256SUMS.sig`，并生成/校验 `release-supply-chain-v0.1.7` 与 `release-v0.1.7` 记录；不执行服务器 updater apply、Web apply/rollback 请求、生产 backup/restore、production migration、Nginx/compose 切换、自动应用策略变更、residual 台账关闭或任何密钥读取/打印/提交。

## 生产 updater apply 确认包：`v0.1.7`

状态：已执行。2026-07-12 用户明确确认后，服务器侧 updater 将生产从 `0.1.5` 更新到 `v0.1.7`，公网 health 返回 `0.1.7`，内置 health smoke 和只读 extra smoke 通过；未执行 Web runtime 服务器命令、数据库/上传目录 restore、自动应用策略变更、写入型 smoke、secrets 读取/打印/复制/提交或 residual 台账关闭。本节保留为本次高风险确认审计记录，不作为下一次生产更新的可复用确认。

本确认包用于把已经生成并校验签名 Release 证据的 `v0.1.7` 应用到生产 `https://forge.areasong.top/`。它是 R4 高风险生产操作；不能从“可以全部都来”或“长期运营目标继续推进”推定授权，必须由用户再次明确确认。

源事实：

- `docs/development/release-v0.1.7-record.md`
- `docs/development/release-supply-chain-v0.1.7.md`
- `docs/development/production-release-runbook.md`
- `docs/deployment/github-release-updater.md`
- `docs/development/operational-readiness.md`
- `docs/development/residual-risk-ledger.md`

目标不可变身份：

- 执行前生产基线：`0.1.5` / `v0.1.5`
- 目标 tag：`v0.1.7`
- Web image：`ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd`
- Migration image：`ghcr.io/areasong/areaforge-migration:v0.1.7@sha256:c2c27da7ed85be0796d4f6535557d3759bc14975a0238b725b99c1c0e232e654`
- 应用回滚目标：`0.1.5` Web digest `sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9`

影响：

- 服务器侧 updater 会下载 `v0.1.7` Release assets，并校验 manifest、SBOM、provenance、`SHA256SUMS` 和 `SHA256SUMS.sig`。
- updater 会备份 PostgreSQL、uploads、生产 env、compose、Nginx 和 release assets。
- updater 会拉取 Web/migration 镜像，通过一次性 migration image 执行 `pnpm db:migrate:deploy`，再切换 Web 镜像和 `APP_VERSION=0.1.7`。
- updater 会执行 `/api/health` 和已配置的只读 extra smoke，并写入 update record / update-agent status。

实施范围：

- 通过确认的生产主机和 `/etc/areaforge/updater.env` 执行：

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh apply --yes \
  --tag v0.1.7 \
  --config /etc/areaforge/updater.env
```

- 成功后采集并回本地校验 redacted 证据：
  - 公网 `GET https://forge.areasong.top/api/health` 返回 `0.1.7`。
  - redacted update-agent status：`currentVersion=0.1.7`、`autoApply=none`、`signatureRequired=true`、timer active、`blocker=null`。
  - `v0.1.7` production readonly smoke record。
  - `v0.1.7` operational evidence bundle。
  - `release-v0.1.7-record.md` 更新为真实生产 apply、备份、migration、smoke、rollback target 和 evidence hash。

不包含：

- 不修改 `AREAFORGE_AUTO_APPLY`，不启用 `patch` / `minor` / `all` 自动应用。
- 不通过 Web runtime 执行服务器命令，不挂载 Docker socket，不执行 Web apply/rollback 请求。
- 不执行生产数据库 restore、uploads restore、备份删除、上传目录移动或历史数据修复。
- 不执行写入型生产 smoke，不创建/修改/删除任务、计时、附件、AI 记录或生产业务数据。
- 不读取、打印、复制或提交生产 `.env`、数据库 URL、smoke 密码、cookie、session secret、GitHub token、cosign 私钥、备份本体、附件内容、上传目录、原始敏感日志或完整 AI prompt/raw response。
- 不关闭 `AF-RISK-OPS-001`、`AF-RISK-SC-001`、`AF-RISK-OPS-004` 或其他 residual 台账；只生成生产更新和可人工复核证据。

必须确认：

- 执行前生产 health 返回 `0.1.5`，且 rollback target 可定位。
- `v0.1.7` Release assets 已通过 `sha256sum -c` 和 cosign `Verified OK`。
- updater config 使用 `AREAFORGE_AUTO_APPLY=none`、`AREAFORGE_REQUIRE_SIGNATURE=true` 和官方 cosign public key。
- 生产只读 extra smoke 已配置为 `pnpm smoke:prod-readonly` 或等价 fallback，并通过权限收紧的 password file 读取 smoke 密码。
- 失败时只自动回滚应用镜像和 `APP_VERSION`；任何数据库或上传目录 restore 必须暂停并另走恢复确认包。

本地/只读前置验证：

```bash
pnpm release:evidence:validate docs/development/release-v0.1.7-record.md
AREAFORGE_SC002_RELEASE_RECORD=docs/development/release-supply-chain-v0.1.7.md pnpm sc:sc-002:preflight
pnpm release:supply-chain:validate docs/development/release-supply-chain-v0.1.7.md /tmp/areaforge-release-v0.1.7-assets
pnpm github-release-updater:preflight
pnpm shellcheck:updater
pnpm ops:handoff --summary
pnpm ops:status --summary
git diff --check
```

成功后本地/redacted 证据验证：

```bash
pnpm update-agent:status:validate <redacted-update-agent-status-v0.1.7.json>
pnpm smoke:prod-readonly:validate <prod-readonly-smoke-record-v0.1.7.txt>
pnpm ops:evidence:bundle:validate <operational-evidence-bundle-v0.1.7.json>
pnpm release:evidence:validate docs/development/release-v0.1.7-record.md
AREAFORGE_OPS001_SMOKE_RECORD=<prod-readonly-smoke-record-v0.1.7.txt> \
AREAFORGE_OPS001_UPDATE_STATUS_RECORD=<redacted-update-agent-status-v0.1.7.json> \
AREAFORGE_OPS001_EVIDENCE_BUNDLE=<operational-evidence-bundle-v0.1.7.json> \
pnpm ops:ops-001:preflight
```

生产 update 后还必须重采或复核：

- `AF-RISK-OPS-001`：生产只读 smoke、redacted update-agent status、operational evidence bundle 和 OPS-001 preflight。
- `AF-RISK-UX-001`：desktop/mobile 真实体验复核；旧本地 UX 记录不能证明新生产版本体验健康。
- `AF-RISK-OPS-004`：至少重跑 alert preview；若要关闭或声称完整生产健康，保留 matching alert drill/preflight。

中止条件：

- 用户没有给出本确认包的明确确认句。
- 执行前生产不是预期 `0.1.5`，或 rollback target 缺失。
- Release asset、image digest、checksum、cosign signature 任一失败。
- 备份缺失、hash 不可记录或备份目录不可写。
- migration image 执行失败。
- health 或只读 smoke 失败。
- update-agent `blocker` 非空或 timer/signature 状态异常。
- 日志或记录出现数据库 URL、密钥、cookie、完整 prompt、附件路径、上传目录或真实学习正文。
- 附件 metadata/hash mismatch。

明确确认句：

> 确认在生产主机通过服务器侧 updater 将 AreaForge 从 `0.1.5` 更新到 `v0.1.7`，仅执行 `apply --yes --tag v0.1.7 --config /etc/areaforge/updater.env` 及其内置签名校验、备份、migration image、切换、只读 smoke 和记录；失败时仅回滚应用镜像和 `APP_VERSION` 到 `0.1.5`；不执行数据库/上传目录 restore、自动应用策略变更、写入型 smoke、Web runtime 服务器命令、读取/打印/复制/提交 secrets 或 residual 台账关闭。
