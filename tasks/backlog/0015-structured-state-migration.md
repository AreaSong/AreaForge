# 0015 结构化学习状态 migration 确认包

状态：已完成。Package B Batch 0、Batch 1、Batch 2、Batch 3、Batch 4、Batch 5 和 Batch 6 均已确认、实施并完成本地验证；后续生产 migration deploy、历史回填、删除旧字段、真实 AI 外呼、任务重排应用或长期报告决策仍需另行确认。

## 目标

把当前依赖文本备注、实时派生和轻量字段的学习状态，升级为结构化、可审计、可统计的数据库模型。

## 范围

- `StudySession` 结构化收口字段：理解程度、最小产出、下一步动作、是否产生笔记/错题、反假学习原因。
- `CheckIn` 每日快照：学习日、最低动作、总/有效时长、任务完成率、复盘完成、连续性辅助字段。
- 任务债务事件账本：补做、延期、放弃、拆小、改复习、完成动作和父子关系；合并、重排采纳记录仍归后续确认。
- 恢复模式状态：触发原因、开始时间、目标分钟、退出条件、用户手动触发记录。
- 掌握证明：条件勾选、证据引用、复测记录。
- 模拟考试和阶段计划所需的基础结构可以作为同批或后续批次，但必须单独列出。

## 建议执行批次

1. Batch 0：`StudySession` 结构化收口字段，继续保留 `note` 双写。
2. Batch 1：`CheckIn` 日快照，新写路径 upsert，旧数据 fallback 派生。
3. Batch 2：`StudyTask.parentTaskId` 与 `TaskDebtEvent`，债务动作双写审计。
4. Batch 3：`RecoveryState`，记录规则触发和手动恢复，不批量改任务。
5. Batch 4：`MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`。
6. Batch 5：`SimulationExam` 与 `SimulationSubjectResult`。
7. Batch 6：`StagePlan` 与 `StageAdjustmentDraft`，建议默认不可自动应用。

## 批次状态

| 批次 | 当前状态 | 说明 |
|---|---|---|
| Batch 0 | 已完成 | `StudySession` 结构化收口字段；只新增字段并保留 `note` 双写；临时库 deploy、API 烟测和首页刷新烟测通过 |
| Batch 1 | 已完成 | `CheckIn` 日快照；新增 additive migration；新写路径 upsert；dashboard/analytics/reports 快照优先并保留缺失日期 fallback |
| Batch 2 | 已完成 | `StudyTask.parentTaskId` 与 `TaskDebtEvent`；债务动作双写 `AuditEvent` 与事件账本；拆小任务写入父子关系 |
| Batch 3 | 已完成 | `RecoveryState`；规则触发和手动触发会创建或复用 active 状态；dashboard/homepage 优先读 active 状态并保留实时规则 fallback；完成/取消只更新恢复状态 |
| Batch 4 | 已完成 | `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`；条件勾选、证据引用和复测记录写入；掌握证明显式记录优先并保留 `_count` fallback |
| Batch 5 | 已完成 | `SimulationExam` 与 `SimulationSubjectResult`；结构化模拟考试主写入和旧任务型模拟只读兼容 |
| Batch 6 | 已完成 | `StagePlan` 与 `StageAdjustmentDraft`；本地规则草稿持久化，用户确认后只更新关联阶段计划和审计 |

## 当前推荐下一步

Package B 分批 migration 主线已完成。后续若要进入生产 migration deploy、历史数据回填、删除旧字段、真实长期 AI、报告决策或任务/阶段应用记录，必须继续走对应 Package D / `0017` / Package E 或单独高风险确认包。

Batch 0 已完成，且只处理 `StudySession` 结束计时收口，不新增其它表：

- 新增理解程度、最小产出、下一步动作、是否产生笔记/错题、低转化原因、补产出要求和收口版本字段。
- `endStudySession` 写入结构化字段，同时继续写 `note = closeout.closeoutText`。
- 历史 session 不解析、不回填，读取时保留旧文本 fallback。
- 完成后为 Batch 1 `CheckIn`、反假学习统计和周期报告提供可靠输入。

Batch 1 已完成：

- `packages/core` 已提供 `buildDailyCheckInSnapshot` 纯规则，用于从当日 sessions、tasks 和 `reviewSubmitted` 派生 `CheckIn` 字段。
- 纯规则已覆盖总时长、有效时长、有效 session 数、任务完成率、复盘状态、低效标记、低转化次数和 `sourceVersion=1`。
- 测试已覆盖 Batch 0 的 `isLowConversion` 优先和历史 `isEffective=false` fallback，不依赖 Prisma、Next.js 或数据库。
- 已新增 `CheckIn` schema 和 `20260707010000_add_check_in_snapshots` additive migration。
- 新写路径在结束计时、保存复盘、任务创建、任务计划日变化和任务状态变化后按学习日幂等 upsert 快照；`startStudySession` 只在关联任务 `TODO -> IN_PROGRESS` 时刷新任务计划日，不把 active session 时长写入快照。
- `getTodayDashboard`、`getAnalyticsSummary` 和 `getPeriodicReport` 已改为优先读取 `CheckIn`，缺失日期继续复用 `buildDailyCheckInSnapshot` 从 sessions/tasks/reviews 派生。
- `pnpm risk:preflight` 已按完成台账允许 Batch 5 结构化模拟考试运行时路径；Batch 6 完成后门禁改为要求阶段计划和阶段调整草稿的 migration、schema、service、API、DTO、UI 和确认边界证据存在，并继续阻止越过本批范围的长期应用路径。

Batch 2 已完成：

- 已新增 `StudyTask.parentTaskId`、`TaskTree` 自关联、`TaskDebtEvent` schema 和 `20260707020000_add_task_debt_events` additive migration。
- `completeStudyTask`、`deferStudyTask`、`dropStudyTask`、`recoverStudyTask`、`splitStudyTask`、`convertStudyTaskToReview`、`endStudySession` 的有效自动完成路径，以及模拟考试完成路径，均保留现有 `AuditEvent` 并在同一事务内写入 `TaskDebtEvent`。
- `splitStudyTask` 创建的子任务写入 `parentTaskId`，同时继续保留 `reviewText` 说明。
- `GET /api/tasks/debt-reorder` 仍为只读建议，不写 `reorder_suggested` / `reorder_applied`，不自动应用任务重排。
- 旧任务和旧拆小记录不回填，读取侧继续按 `StudyTask.status/debtStatus/plannedDate` fallback。

Batch 3 已完成：

- 已新增 `RecoveryState` schema 和 `20260707030000_add_recovery_state` additive migration。
- `getTodayDashboard` 会优先读取 active `RecoveryState`；无 active 状态时继续使用 `createRecoveryPlan` 实时规则 fallback。
- 首页和 dashboard API 规则触发恢复时会幂等创建 `triggerType=rule` 的 active 状态；AI 建议等复用 dashboard 数据的路径默认不记录规则触发。
- `POST /api/recovery-states/manual` 创建或复用 `triggerType=manual` 的 active 状态，不复用任务补做 API。
- `POST /api/recovery-states/:id/complete` 和 `POST /api/recovery-states/:id/cancel` 只更新 `RecoveryState.status/endedAt/exitCondition`。
- 首页计时器聚焦恢复候选，任务面板保留完整任务列表；不批量修改历史欠账，不删除、不隐藏、不延期原任务。

Batch 4 已完成：

- 已新增 `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest` schema 和 `20260707040000_add_mastery_records` additive migration。
- `PATCH /api/syllabus/nodes/:id` 会持久化掌握条件记录，并在标记掌握时优先读取显式记录；没有显式证据时保留现有 `_count` fallback。
- `POST /api/syllabus/nodes/:id/mastery-evidence` 写入任务、计时、笔记、错题或复测证据引用，并拒绝跨节点引用。
- `POST /api/syllabus/nodes/:id/mastery-retests` 写入 `passed/failed/partial` 复测记录；只有 `passed` 会追加复测证据并计入复测通过证明。
- `/syllabus` 节点卡片已支持保存条件、写入证据引用、写入复测记录，并展示显式证据和复测历史。
- 本批不解析历史文本生成证据，不删除旧字段，不自动回填旧记录，复测失败或部分通过不自动降低节点状态或掌握等级，不执行生产 migration deploy。

Batch 5 已完成：

- 已新增 `SimulationExam`、`SimulationSubjectResult` schema 和 `20260707050000_add_simulation_exam_records` additive migration。
- `POST /api/simulation/exams` 创建结构化模拟考试，不再通过页面主路径创建旧 `StudyTask.type="simulation_exam"`。
- `POST /api/simulation/exams/:id/results` 保存考试汇总字段，并按 `simulationExamId + subjectId` upsert 科目结果。
- `/simulation` 优先读取结构化考试，旧任务型模拟只读展示，不自动迁移、不删除、不解析历史文本。
- 结构化保存仍调用 `summarizeSimulationResult` 生成规则复盘文本，写入 `SimulationExam.reviewText`。
- 本批不新增 `StagePlan` 或 `StageAdjustmentDraft`，不应用阶段计划，不接真实 AI，不执行生产 migration deploy。

Batch 6 已完成：

- 已新增 `StagePlan`、`StageAdjustmentDraft` schema 和 `20260707060000_add_stage_plan_records` additive migration。
- `/api/simulation/stage-plans` 可读取和保存阶段计划，`/api/simulation/stage-plans/:id` 可局部更新阶段计划。
- `/api/simulation/stage-adjustment-drafts` 会用本地规则生成持久草稿，固定 `canAutoApply=false`、`requiresUserConfirmation=true`。
- `/api/simulation/stage-adjustment-drafts/:id/confirm` 只在用户显式确认时更新关联 `StagePlan.mode/goal/status`、草稿状态和审计记录；重复确认保持幂等。
- `/api/simulation/stage-adjustment-drafts/:id/reject` 只更新草稿状态和审计记录。
- `/simulation` 已展示阶段计划、持久草稿、确认/驳回状态和不自动应用边界；`/reports` 已展示最新阶段计划和最近持久草稿。
- 本批不自动任务重排、不批量修改任务、不执行真实 AI 长期外呼、不删除历史阶段、不执行生产 migration deploy。

Batch 0 确认细节见 `docs/development/high-risk-confirmation-packets.md` 的 “Batch 0 确认包：`StudySession` 结构化收口字段”。

## Batch 1 确认后实施切入点（已实施）

以下清单记录 Batch 1 已实现范围；Batch 2、Batch 3、Batch 4、Batch 5 和 Batch 6 已在确认后完成，但仍不代表可以执行生产 migration deploy、历史回填、删除旧字段、真实 AI 外呼或 Package D 应用写路径。

写路径需要覆盖：

- `createStudyTask`：任务创建后按计划日期 upsert 对应学习日快照。
- `updateStudyTask`：计划日期变化时需要同时刷新原计划日和新计划日；只改标题、类型、优先级、预计分钟或复盘文本时不应误改无关日期快照。
- `completeStudyTask`、`deferStudyTask`、`dropStudyTask`、`recoverStudyTask`、`splitStudyTask`、`convertStudyTaskToReview`：任务状态、债务状态或计划日期变化后刷新受影响学习日。
- `startStudySession`：若把任务从 `TODO` 改为 `IN_PROGRESS`，应纳入“任务状态变化”口径，避免 dashboard、analytics、reports 对同一天看到不同任务状态。
- `endStudySession`：计时结束、结构化收口和可选任务完成写入同一事务后，刷新该 session 所属学习日快照。
- `saveTodayReview`：每日复盘 upsert 后刷新当日快照，并把 `reviewSubmitted` 固化为 true。

读路径需要覆盖：

- `getTodayDashboard`：优先读取当日 `CheckIn` 的总/有效时长、有效 session 数、任务完成率、复盘状态和低转化次数；若当日没有快照，继续使用现有 session/task/review 派生逻辑。若存在正在运行的 active session，首页当日总时长仍需保留实时计时展示，不应只展示旧快照。
- `getAnalyticsSummary`：近 7 天日点、连续天数、断签天数、复盘完成率和低效提示优先读 `CheckIn`；缺失日期 fallback 到现有派生，不能把无快照历史日直接当作断签。
- `getPeriodicReport`：周/月报告的总时长、有效时长、任务完成率、低转化次数、复盘完成率优先读覆盖范围内的 `CheckIn`；没有快照的日期仍走 session/task/review fallback。

实现契约：

- 新增 helper 应按学习日重算快照，而不是对字段做增量猜测；同一天重复调用必须幂等。
- `studyDate` 使用 `getStudyDayRange(targetDate).start`；所有调用方只传“受影响日期”，由 helper 统一归一化。
- 任务计划日变化时刷新旧计划日和新计划日；任务只改标题、类型、优先级、预计分钟或复盘文本时，可以只刷新原计划日或不刷新无关日期。
- `splitStudyTask` 需要刷新原任务计划日和新拆出任务计划日；若两者同日，helper 重复调用也必须得到同一结果。
- `endStudySession` 应在 session、可选任务完成和 syllabus minutes 写入同一事务后刷新对应学习日；快照可在同事务末尾用 transaction client 重算，避免 dashboard 看到半更新状态。
- analytics/reports 只能逐日混合快照和旧派生：有快照的日期读 `CheckIn`，缺快照的日期按原 sessions/tasks/reviews 重算。禁止把无快照历史日直接算成 0。

Batch 1 烟测至少覆盖：

- 结束一次有效计时后生成/更新当日 `CheckIn`。
- 结束一次低转化计时后 `lowConversionCount` 增加。
- 保存每日复盘后 `reviewSubmitted=true`。
- 创建、完成、延期、放弃、补做、拆小和改复习任务后，相关学习日任务完成率刷新。
- dashboard、analytics、reports 在有快照时优先读快照；在无快照历史日期上 fallback 正常。

## 不包含

- 删除旧字段。
- 批量清空或重写历史任务、计时、复盘、错题、笔记。
- 自动应用任务重排或阶段调整。
- 生产 migration deploy。

## 参考源事实

- `docs/development/implementation-order.md`
- `docs/architecture/data-model.md`
- `docs/modules/check-in.md`
- `docs/modules/task-debt.md`
- `docs/modules/anti-fake-study.md`
- `docs/modules/recovery-mode.md`
- `docs/modules/mastery-proof.md`
- `docs/modules/simulation-exam.md`
- `docs/development/structured-state-migration-design.md`

## 确认前必须说明

- 每个新增模型、字段、索引和关系。
- 旧数据如何兼容读取，哪些字段只从新数据开始准确。
- 是否需要回填；若需要，只允许非破坏性、可重复、可审计回填。
- 新旧口径并存期如何显示和验证。
- 本地、临时库、生产环境的迁移顺序。
- 失败时如何回滚代码、保留数据和恢复备份。

## Batch 0 验收标准

- migration 采用 additive 策略，只新增 `StudySession` 收口字段，不新增其它表。
- `endStudySession` 写入结构化字段，同时继续写 `note = closeout.closeoutText`。
- 历史 `StudySession.note` 不解析、不回填，旧记录仍能展示。
- 首页结束一次计时后刷新，仍能看到有效/低转化状态和收口文本。
- `pnpm db:validate`、临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`、`pnpm --filter @areaforge/core test`、Web typecheck/lint 和 `pnpm check` 通过。
- Batch 0 完成时只更新 Package B Batch 0 证据；当前 Batch 0-6 已全部完成，Package B 主状态已在完成记录中标为完成。

## Batch 1-6 验收摘要

每个批次都必须先获得用户明确确认，再进入 schema、migration 和代码实现。Batch 0-6 已全部完成后，Package B 主状态可以在完成记录中标为完成；生产 deploy 和后续长期应用仍另走确认。

| 批次 | 验收重点 | 排除项 |
|---|---|---|
| Batch 1 | `CheckIn` 当日快照 upsert；dashboard、analytics、reports 优先读快照并保留缺失日期 fallback | 不新增债务事件、恢复状态、掌握证明、模拟考试或阶段计划 |
| Batch 2 | `StudyTask.parentTaskId` 和 `TaskDebtEvent`；债务动作双写 `AuditEvent` 和事件账本；旧任务保留状态字段 fallback | 不自动应用债务重排；不回填旧拆小任务父子关系 |
| Batch 3 | `RecoveryState` 记录规则触发和手动触发；首页优先读 active 状态，无 active 时 fallback 实时规则 | 不批量修改历史欠账；不删除、隐藏或延期原任务 |
| Batch 4 | `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`；掌握证明优先显式证据并保留 `_count` fallback | 不解析历史文本生成证据；复测失败不自动降低节点状态 |
| Batch 5 | `SimulationExam` 和 `SimulationSubjectResult`；`/simulation` 优先结构化记录并只读兼容旧任务型模拟 | 不自动迁移旧模拟任务；不自动调整阶段计划；不外呼 AI |
| Batch 6 | `StagePlan` 和 `StageAdjustmentDraft`；草稿保持 `canAutoApply=false`、`requiresUserConfirmation=true`，用户确认后才可应用 | 不自动任务重排；不批量修改任务；不真实 AI 长期外呼 |

## Package B 总体验收标准

- migration 采用 additive 策略，不删除旧字段。
- `pnpm db:validate` 通过。
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy` 通过。
- 旧数据仍能打开首页、任务、计时、复盘、考纲、错题和报告。
- 新结构能支撑打卡、债务、恢复、反假学习和掌握证明的主读取路径。
- `pnpm check` 通过。

## 验证

- `pnpm db:validate`
- `pnpm db:migrate:diff:empty`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`。
- 相关 API 烟测：dashboard、tasks、study-sessions、reviews、syllabus、mistakes、analytics、reports。
- 页面烟测：首页、`/syllabus`、`/analytics`、`/reports`。

## 风险

- migration 失败导致应用启动失败。
- 旧数据无法映射到新结构，造成统计口径变化。
- 新旧口径并存期间用户看到不一致数据。
- 生产执行前若没有备份，无法安全回滚。

## 回滚

- 开发期优先回滚代码，不删除已新增字段或表。
- 生产环境执行前必须有数据库备份点。
- 若 migration 已部署，回滚到上一镜像后保留新增表字段，后续用兼容代码处理。
- 任何删除或压缩历史数据的清理任务都必须另开任务并再次确认。
