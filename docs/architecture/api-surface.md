# API Surface

## 原则

- 所有写操作必须服务端鉴权。
- Route Handler / Server Action 不写复杂业务规则。
- 参数校验集中使用 schema。
- 返回结构稳定，方便后续桌面端和移动端复用。
- AI、上传、数据库写入都需要失败回退或明确错误。

## 第一版 API 分组

### Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

认证 API 原则：

- `login` 校验 email、password 和基础限速，通过后创建数据库会话并写入 `HttpOnly` Cookie。
- `logout` 删除或失效当前会话，并清除 Cookie。
- `me` 只返回最小用户信息，例如 id 和 email。
- 所有认证 API 都不返回密码哈希、session token 明文或内部错误堆栈。

### Dashboard

- `GET /api/dashboard/today`

今日作战台返回真实数据库聚合，并包含最近一次已完成计时 `latestCompletedSession`，用于刷新后继续展示结构化收口、低转化原因和补产出要求。Batch 3 后，dashboard 会优先读取 active `RecoveryState`；无 active 状态时继续按 `createRecoveryPlan` 实时规则 fallback。首页和 dashboard API 在规则触发恢复时会幂等创建一条 active `RecoveryState`，不会修改、隐藏或删除 `StudyTask`。

### Recovery States

- `POST /api/recovery-states/manual`
- `POST /api/recovery-states/:id/complete`
- `POST /api/recovery-states/:id/cancel`

手动恢复只创建或复用 active `RecoveryState`，不复用任务补做 API，也不改写任务计划日期、状态或债务状态。完成或取消恢复只更新对应 `RecoveryState.status/endedAt/exitCondition`；任务欠账、`StudyTask` 和 `TaskDebtEvent` 不被批量改写。

### Analytics

- `GET /api/analytics/summary`

统计 API 只读派生，不写统计快照表。第一版从任务、计时、复盘、错题、笔记和考纲节点实时计算近 7 天统计、风险提醒与下一步动作。

### Reports

- `GET /api/reports/periodic`
- `GET /api/reports/periodic/decisions`
- `POST /api/reports/periodic/decisions`

`GET /api/reports/periodic` 实时派生周审判和月复盘数据报告、规则策略、本地规则复盘草稿和 `decisionPreview` 下周期决策预览；`decisionPreview` 只包含聚合指标、最大短板摘要、策略、下一周期草稿和确认边界，不包含任务标题列表、完整复盘正文、附件内容或阶段计划应用结果。默认不把长期记录、情绪记录或动机档案发送给 AI。

Package D Batch D1 后，`POST /api/reports/periodic/decisions` 允许对当前周/月报告做确认或驳回。服务端会重新计算当前报告范围，拒绝过期页面提交；同向重复提交返回已处理，反向提交返回冲突。确认会保存冻结 `reportSnapshot` 和 `nextCycleDraft`，驳回只保存冻结快照；两者都写入 `AuditEvent`，且只记录报告决策，不批量修改任务、不应用阶段计划、不外呼长期 AI。`GET /api/reports/periodic/decisions` 返回最近报告决策用于只读回放。

### Tasks

- `GET /api/tasks`
- `GET /api/tasks/debt-reorder`
- `POST /api/tasks/debt-reorder/decisions`
- `POST /api/tasks/debt-reorder/applications`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/complete`
- `POST /api/tasks/:id/defer`
- `POST /api/tasks/:id/drop`
- `POST /api/tasks/:id/recover`
- `POST /api/tasks/:id/split`
- `POST /api/tasks/:id/convert-review`

Batch 2 后，`complete/defer/drop/recover/split/convert-review` 会继续写现有 `AuditEvent`，并在同一事务内写入 `TaskDebtEvent` 事件账本；`split` 创建的子任务会写入 `parentTaskId`，同时继续保留 `reviewText` 说明。旧任务没有债务事件时，页面和统计仍按 `StudyTask.status/debtStatus/plannedDate` fallback。`GET /api/tasks/debt-reorder` 仍只读返回重排建议，`canAutoApply=false`、`requiresUserConfirmation=true`，不会自动改任务。Package D Batch D2 后，`POST /api/tasks/debt-reorder/decisions` 只记录用户对所选建议的确认或驳回，写 `TaskDebtEvent.action=reorder_suggested` 和 `AuditEvent`；`POST /api/tasks/debt-reorder/applications` 会重新计算当前建议、复用 `previewTaskDebtReorderApplication` 校验所选项和小批量上限，仅在用户显式提交所选项且无跳过项时应用，并写 `TaskDebtEvent.action=reorder_applied` 和 `AuditEvent`。D2 不提供自动应用全部建议入口，不新增 migration，不修改 `StagePlan` / `StageAdjustmentDraft`，也不外呼长期 AI。

### Timer

- `GET /api/study-sessions/active`
- `POST /api/study-sessions/start`
- `POST /api/study-sessions/:id/pause`
- `POST /api/study-sessions/:id/resume`
- `POST /api/study-sessions/:id/end`

计时写入原则：

- 不每秒写数据库。
- 状态变化时写入。
- 支持刷新页面后恢复 active session。
- 同一用户第一版只允许一个 active session。
- 计时结束会基于收口字段运行反假学习规则，并双写 `StudySession.isEffective`、结构化收口字段和文本化 `note`；历史 `note` 不解析、不回填，统计优先读 `isLowConversion`，缺失时 fallback 到旧 `isEffective === false`。若用户勾选完成任务且本次有效，关联任务会更新为 `DONE/NONE`，并同步写入 `TaskDebtEvent.action=complete` 和现有审计记录。

### Syllabus

- `GET /api/syllabus`
- `POST /api/syllabus/nodes`
- `PATCH /api/syllabus/nodes/:id`
- `POST /api/syllabus/nodes/:id/mastery-evidence`
- `POST /api/syllabus/nodes/:id/mastery-retests`
- `POST /api/syllabus/import-markdown`

Markdown 导入只解析标题和列表，创建新的 `SyllabusNode`，不删除、不覆盖、不调用 AI，也不解析 PDF。当前限制行数、层级和标题长度，失败时不写入任何节点。

掌握证明复用 `PATCH /api/syllabus/nodes/:id`：请求可携带 `masteryLevel` 和 `masteryConditions`，服务端会持久化条件记录，并只在任务、计时、笔记、错题或复测证据满足规则时允许写入 `status=mastered` / `masteryLevel`，否则返回 `MASTERY_PROOF_REQUIRED`。成功证明会写入 `AuditEvent` 摘要。

Batch 4 后，`POST /api/syllabus/nodes/:id/mastery-evidence` 写入显式证据引用，且只允许引用同一考纲节点下的任务、计时、笔记、错题或已通过复测记录；跨节点引用返回错误。`POST /api/syllabus/nodes/:id/mastery-retests` 写入 `passed/failed/partial` 复测记录；只有 `passed` 会自动追加复测证据引用并计入复测通过证明，`failed/partial` 不会自动降低节点状态或掌握等级，也不会覆盖旧节点 `_count` fallback。没有显式证据的旧节点仍按现有 `_count` fallback 证明。

### Notes / Attachments

- `GET /api/notes`
- `POST /api/notes`
- `POST /api/notes/:noteId/attachments`
- `GET /api/attachments/:id`

Package A 后，附件接口已实现第一版 noteId 绑定能力：上传只走 `POST /api/notes/:noteId/attachments`，下载只走鉴权 `GET /api/attachments/:id`，UI 使用 `downloadApiPath`，不得把 `Attachment.uri`、`storedName` 或上传绝对路径作为公开 href 或响应字段。文件本体写入私有 `UPLOAD_DIR`，数据库保存 metadata、hash 和 URI；下载前会校验真实路径、size/hash 和响应头。

附件不通过 public 直接暴露，必须走鉴权接口。第一版不包含附件删除、错题/模拟/阶段附件、AI 解析、生产部署或孤儿文件清理。

### Mistakes

- `GET /api/mistakes`
- `POST /api/mistakes`
- `PATCH /api/mistakes/:id`

错题用于记录错因、正确思路和下次复习时间，可关联科目和考纲节点。第一版不提供默认删除入口。

### Review

- `GET /api/reviews/today`
- `POST /api/reviews/today`

### Motivation / Stage

- `GET /api/motivation-vault`
- `POST /api/motivation-vault`

动机档案只用于用户主动查看和关键节点唤醒。默认不进入 AI 上下文，首页只展示唤醒信号，不展示动机正文。

### Simulation

- `GET /api/simulation/exams`
- `POST /api/simulation/exams`
- `POST /api/simulation/exams/:id/results`
- `GET /api/simulation/tasks`
- `POST /api/simulation/tasks`
- `POST /api/simulation/tasks/:id/complete`
- `GET /api/simulation/stage`
- `GET /api/simulation/stage-plans`
- `POST /api/simulation/stage-plans`
- `PATCH /api/simulation/stage-plans/:id`
- `GET /api/simulation/stage-adjustment-drafts`
- `POST /api/simulation/stage-adjustment-drafts`
- `POST /api/simulation/stage-adjustment-drafts/:id/confirm`
- `POST /api/simulation/stage-adjustment-drafts/:id/reject`
- `POST /api/simulation/first-diary`

Batch 5 后，新建模拟考试和保存模拟结果优先写入 `SimulationExam` / `SimulationSubjectResult`。`/simulation` 页面优先读取结构化模拟考试，并只读展示旧 `StudyTask.type = "simulation_exam"` 记录作为 fallback；旧任务型模拟不会被自动迁移、解析或删除。

`GET /api/simulation/tasks` 保留为旧任务型模拟只读兼容面。旧 `POST /api/simulation/tasks` 和 `POST /api/simulation/tasks/:id/complete` 路由保留但返回 `LEGACY_SIMULATION_TASK_WRITE_DISABLED`，不再创建或完成旧任务型模拟。

Batch 6 后，阶段计划可通过 `stage-plans` API 创建和局部更新；阶段调整草稿通过本地规则持久化，固定 `canAutoApply=false`、`requiresUserConfirmation=true`。`confirm` 只在用户显式确认时更新关联 `StagePlan` 的模式、目标和必要状态，并写入 `AuditEvent`；`reject` 只更新草稿状态。两者都不自动重排任务、不批量修改任务、不外呼真实 AI、不删除历史阶段记录。Package D Batch D1 已完成报告决策入口；长期 AI 阶段调整仍需 Package D / `0017`，任务重排应用、报告驱动的任务/阶段应用和长期应用记录仍需 Package D 后续批次。

### AI

- `POST /api/ai/discipline`
- `POST /api/ai/daily-review`
- `POST /api/ai/tomorrow-plan`

AI API 只返回建议，不直接修改用户原始数据。
Package C 后，三条 AI POST route 在 `AI_ENABLED=true` 且配置完整时可创建 OpenAI-compatible provider 并发起显式外呼；`AI_ENABLED=false` 或配置不完整时返回 `local_rule_fallback`。真实外呼只发送聚合字段，不发送动机档案、完整情绪记录、完整复盘正文、附件内容、上传路径或原始任务标题。首页普通 SSR 继续使用本地 fallback，不触发真实 provider 成本。
AI 建议结构使用 `ai_generated`、`ai_invalid_fallback` 和 `ai_error_fallback` 区分成功、校验失败和错误回退；不保存完整 prompt 或完整模型响应。
