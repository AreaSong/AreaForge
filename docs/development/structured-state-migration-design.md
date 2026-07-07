# 结构化学习状态 migration 设计

## 状态

本文件是 `tasks/backlog/0015-structured-state-migration.md` 的分批确认设计。Package B Batch 0 已在明确确认后执行 `StudySession` 结构化收口字段；Batch 1 已在明确确认后执行 `CheckIn` 日快照；Batch 2-6 仍未执行。任何后续 `prisma/schema.prisma`、`prisma/migrations/**` 或数据回填改动，都必须等用户明确确认后再做。

## 目标

把当前文本备注和实时派生的学习状态，升级为结构化、可审计、可统计的状态层，同时保留旧数据可读性。

当前主要缺口：

- 新结束的 `StudySession` 已写入 Batch 0 结构化收口字段；历史 `StudySession.note` 仍可能混合保存理解程度、最小产出、下一步动作和反假学习原因，且不做不可靠解析。
- 打卡连续性已有 `CheckIn` 日快照；新写路径会维护快照，历史无快照日期仍按 sessions/tasks/reviews fallback 派生。
- 任务债务动作依赖 `StudyTask.status/debtStatus/reviewText` 和审计事件，没有债务事件账本和父子任务关系。
- 恢复模式是实时规则裁剪，没有用户手动触发和退出记录。
- 掌握证明依赖证据计数和 core 规则，没有条件勾选、证据引用和复测记录。
- 模拟考试和阶段计划仍复用任务和文本结果，没有结构化模型。

## 分批原则

- 只做 additive migration：新增表、字段、索引和关系，不删除旧字段。
- 新代码先双写或兼容写：保留旧 `note/reviewText` 文本，新增结构化字段。
- 旧数据不强行解析文本回填；只做可确定的轻量快照回填。
- 所有建议和重排都只生成草稿或事件，不自动覆盖用户计划。
- 每批 migration 都必须能在临时库完成 deploy、seed、页面/API 烟测和回滚演练。

## 推荐执行批次

下面批次用于真实实现和确认。每一批都应单独说明影响、风险、验证和回滚；通过验证后再进入下一批。

1. Batch 0：只新增 `StudySession` 结构化收口字段，保留 `note` 双写，不解析历史文本。
2. Batch 1：新增 `CheckIn` 日快照，只在新写路径 upsert；首页和统计先保留旧派生 fallback。已完成。
3. Batch 2：新增 `StudyTask.parentTaskId` 和 `TaskDebtEvent`，债务动作双写 `AuditEvent` 与事件账本。
4. Batch 3：新增 `RecoveryState`，只记录恢复状态，不批量改历史欠账。
5. Batch 4：新增掌握证明条件、证据和复测记录，缺显式证据时 fallback 现有 `_count`。
6. Batch 5：新增结构化模拟考试和科目结果模型，旧任务型模拟只读兼容。
7. Batch 6：新增阶段计划和阶段调整草稿，草稿必须用户确认后才可应用。

## 设计域 A：计时收口、打卡、债务、恢复

### `StudySession` 追加字段

Batch 0 已新增：

- `understandingLevel String?`
- `minimalOutput String?`
- `nextAction String?`
- `producedNote Boolean @default(false)`
- `producedMistake Boolean @default(false)`
- `isLowConversion Boolean?`
- `antiFakeReason String?`
- `requiredOutput String?`
- `closeoutVersion Int @default(1)`

兼容策略：

- 新的结束计时路径写入上述字段，同时继续写 `note = closeoutText`，保证旧 UI 和历史记录仍可读。
- 历史 session 的新增字段保持 `null/default`，读取时继续从旧 `note` 展示文本，不做不可靠解析。
- 统计优先读 `isLowConversion`，历史数据 fallback 到 `isEffective === false`。

### 新增 `CheckIn`

Batch 1 已新增字段：

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

兼容策略：

- 每次结束计时、保存复盘、任务状态变化后 upsert 当日 `CheckIn`。
- 首页、统计和报告优先读 `CheckIn`；若某日没有快照，fallback 到现有 session/task/review 派生逻辑。
- 本批不做历史批量回填；历史无快照日期只在读取时按已有 session/task/review 派生，不推断用户没有填写过的收口字段。

Batch 1 实现契约：

- `packages/core` 的 `buildDailyCheckInSnapshot` 是快照字段来源的纯规则；服务层实现时应复用该函数，不在 Prisma 写路径中重新散落同一套计算口径。
- `studyDate` 必须使用 `getStudyDayRange(targetDate).start`，不要用自然日零点或直接截断 `createdAt`。
- `completedMinimumAction` 来源于当日 `evaluateDailyCheckIn` 的结果；`lowEfficiency` 来源于同一规则的低效判断，不把“打开应用”算作完成。
- `totalMinutes` 统计当日已完成 session 的 `effectiveMinutes` 总和；若首页存在 active session，首页展示可额外叠加实时计时，但不得把未结束 session 写入快照。
- `effectiveMinutes` 和 `effectiveSessionCount` 只统计 `isEffective=true` 的已完成 session。
- `taskCompletionRate` 只按当日 `plannedDate` 落在学习日内的任务计算；任务计划日变化时必须刷新旧学习日和新学习日。
- `reviewSubmitted` 只由当日 `DailyReview` 是否存在决定；保存复盘后必须刷新同日快照。
- `lowConversionCount` 优先使用 Batch 0 的 `isLowConversion`，历史 session fallback 到 `isEffective=false`。
- analytics 和 reports 必须以“逐日”为单位合并：某天有 `CheckIn` 就用快照；某天没有快照就走旧 session/task/review 派生。不能因为区间内部分日期有快照，就把无快照日期当作 0 或断签。
- 本批未做历史批量回填；如后续需要回填，只能另开可重复、只追加、可审计的任务确认。

### `StudyTask` 父子关系

建议新增：

- `parentTaskId String?`
- `parent StudyTask? @relation("TaskTree", fields: [parentTaskId], references: [id])`
- `children StudyTask[] @relation("TaskTree")`

兼容策略：

- 拆小任务时写入 `parentTaskId`，同时继续把说明写入 `reviewText`。
- 旧拆小任务没有父子关系，不做猜测回填。

### 新增 `TaskDebtEvent`

建议字段：

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

兼容策略：

- 所有任务债务动作写 `TaskDebtEvent`，同时保留现有 `AuditEvent`。
- 旧任务没有债务事件时，仍用 `StudyTask.status/debtStatus/plannedDate` 判断欠账。
- 第二阶段重排建议只写 `reorder_suggested`，用户确认后才写 `reorder_applied` 和更新任务。

### 新增 `RecoveryState`

建议字段：

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

兼容策略：

- 首页优先读取 active `RecoveryState`；没有 active 状态时使用 `createRecoveryPlan` 实时规则。
- 用户主动“我需要恢复”只创建 active 状态，不删除、不隐藏原任务。
- 完成退出只更新 `RecoveryState.status`，不自动批量改历史欠账。

## 设计域 B：掌握证明、证据引用和复测

### 新增 `MasteryConditionRecord`

建议字段：

- `id String @id @default(cuid())`
- `syllabusNodeId String`
- `condition String`：`course_or_textbook/own_explanation/basic_exercise/comprehensive_exercise/mistake_reviewed/delayed_retest`
- `checked Boolean @default(false)`
- `checkedAt DateTime?`
- `actorId String?`

索引：

- `@@unique([syllabusNodeId, condition])`

### 新增 `MasteryEvidence`

建议字段：

- `id String @id @default(cuid())`
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

兼容策略：

- 考纲页面优先读取显式证据引用；没有引用时 fallback 到现有 `_count` 证据计数。
- 标记 `mastered` 时必须满足 core `evaluateMasteryProof`。

### 新增 `MasteryRetest`

建议字段：

- `id String @id @default(cuid())`
- `syllabusNodeId String`
- `testedAt DateTime`
- `result String`：`passed/failed/partial`
- `score String?`
- `summary String?`
- `nextReviewAt DateTime?`
- `actorId String?`

兼容策略：

- 复测通过后可作为 `delayed_retest` 证据。
- 失败或部分通过不能自动降低节点状态，只给下一步动作建议。

## 设计域 C：模拟考试、阶段计划、阶段调整

### 新增 `SimulationExam`

建议字段：

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

### 新增 `SimulationSubjectResult`

建议字段：

- `id String @id @default(cuid())`
- `simulationExamId String`
- `subjectId String`
- `targetScore Float?`
- `actualScore Float?`
- `durationMinutes Int?`
- `blankQuestionCount Int @default(0)`
- `lossReasons Json?`
- `summary String?`

### 新增 `StagePlan`

建议字段：

- `id String @id @default(cuid())`
- `name String`
- `startDate DateTime`
- `endDate DateTime`
- `goal String`
- `mode String`：`recovery/strengthen/sprint/maintain`
- `status String`：`draft/active/completed/archived`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

### 新增 `StageAdjustmentDraft`

建议字段：

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
- `status String`：`draft/applied/dismissed`
- `createdAt DateTime @default(now())`
- `appliedAt DateTime?`
- `actorId String?`

兼容策略：

- 现有 `/simulation` 可继续展示 `StudyTask.type = "simulation_exam"` 历史数据。
- 新建模拟考试优先写 `SimulationExam`，旧任务型模拟只读展示，不自动迁移。
- 阶段调整草稿永远 `canAutoApply=false`，应用前显示变更摘要并写审计。

## 代码切换顺序

1. 新增 schema 和 migration，生成 Prisma Client。
2. 服务层新增兼容读取函数：优先结构化，缺失时 fallback 旧派生逻辑。
3. 写路径双写：session 收口、任务债务动作、复盘、恢复模式、掌握证明。
4. 页面/API 读取结构化 DTO，但保留旧字段展示。
5. 临时库做最小回填验证，不在主库或生产库直接回填。
6. 文档同步 `data-model.md`、`api-surface.md`、`feature-traceability.md` 和相关 task。

## 验证矩阵

- `pnpm db:validate`
- `pnpm db:migrate:diff:empty`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：dashboard、tasks、study-sessions、reviews、syllabus、mistakes、analytics、reports、simulation。
- 页面烟测：首页、`/syllabus`、`/analytics`、`/reports`、`/simulation`。

## 回滚策略

- 开发期：回滚代码即可；新增表字段不做删除。
- 临时库：直接丢弃临时库。
- 生产前：必须先备份数据库和上传目录。
- 生产后：如果新代码失败，回滚上一镜像；保留新增表字段，后续用兼容代码处理。
- 任何删除旧字段、压缩历史数据或清理回填产物都必须另开高风险任务。
