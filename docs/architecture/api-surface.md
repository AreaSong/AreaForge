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

今日作战台返回真实数据库聚合，并包含最近一次已完成计时 `latestCompletedSession`，用于刷新后继续展示结构化收口、低转化原因和补产出要求。dashboard 优先读取 active `RecoveryState`；无 active 状态时继续按 `createRecoveryPlan` 实时规则 fallback。首页和 dashboard API 在规则触发恢复时会幂等创建一条 active `RecoveryState`，不会修改、隐藏或删除 `StudyTask`。

在行动中心与五工作台落地前，本接口继续作为今日聚合主入口并保持兼容。

### Action Center 与工作区

已在隔离分支落地（**无生产导航入口**）：

- `/api/exam-workspaces/**`：工作区列表/创建、激活切换、接管 preview/apply、科目分组读取、自定义科目创建
- `/api/plan-milestones/**`：里程碑列表/创建/编辑
- `/api/plan-inbox/**`：列表/创建/编辑/dismiss/reopen/**convert**（隔离原子转换；无生产页）
- `/api/tasks/:id/dependencies/**`：依赖列表/创建/改类型/解除
- `/api/learning-tree/templates|export|imports/preview|imports/confirm`、`/api/learning-tree/imports`、`/api/learning-tree/imports/:id`、`/api/learning-tree/imports/:id/export`（隔离；preview 零业务写入；confirm 原子）
- `/api/study-resources/**`：列表/详情/LINK 创建/staging/resolve/整理/关联/归档/恢复/下载；旧附件入资料库（隔离，无生产页）
- `/api/review-schedules/**`：物化/列表/改期/pause/resume/confirm event/bridge（隔离）
- `POST /api/review-events/:id/corrections`：追加最新事件更正（隔离）
- `GET /api/check-ins?from=&to=`：当前 workspace CheckIn v2 只读投影（隔离；无客户端写）
- `/api/recovery/active|start|/:id/cancel|/:id/restart`：Recovery v2 三阶（隔离；保留既有 `/api/recovery-states/**`）
- `/api/study-tasks/:id/bridge-complete|bridge-defer|bridge-abandon`：复习桥接任务完成/延期/放弃（隔离）

仍为规划、未实现：

- 知识画布分层查询与布局 CAS；动机、通知偏好与四类显式 AI 草稿。

已落地（隔离分支可路由；生产一次切换见版本计划完整 minor Release）：

- `GET /api/app-shell/status`：五个桌面状态灯与移动端最高优先级状态。
- `GET /api/action-center/today`：工作区、科目快捷计时、推荐、三队列、活动与 CheckIn 演进投影；无 ACTIVE 工作区时返回 `setupRequired`。
- `GET /api/plan/rolling`：正式任务、欠账与带日期收件箱数量入口（不泄露 Inbox 正文）。
- `GET /api/exam-workspaces/:id/subjects`：工作区科目列表（原仅有 POST）。
- `POST /api/study-sessions/start`：支持 `goalMinutes` / `startSource`（含 `SUBJECT_SHORTCUT`），并校验 ACTIVE 工作区科目。

权威路由与错误契约见 `workflow/versions/v1.1-learning-action-center.md`。旧 `POST /api/syllabus/import-markdown` 在切换前保留 append-only legacy 行为。

### Recovery States

- `POST /api/recovery-states/manual`
- `POST /api/recovery-states/:id/complete`
- `POST /api/recovery-states/:id/cancel`

手动恢复只创建或复用 active `RecoveryState`，不复用任务补做 API，也不改写任务计划日期、状态或债务状态。完成或取消恢复只更新对应 `RecoveryState.status/endedAt/exitCondition`；任务欠账、`StudyTask` 和 `TaskDebtEvent` 不被批量改写。

### Analytics

- `GET /api/analytics/summary`
- `GET /api/analytics/long-term-risks`

统计 API 只读派生，不写统计快照表。第一版从任务、计时、复盘、错题、笔记和考纲节点实时计算近 7 天统计、风险提醒与下一步动作。

`GET /api/analytics/long-term-risks` 是长期风险统一 DTO 的只读鉴权入口，返回风险来源、时间窗口、科目/考纲节点、证据新鲜度、下一步动作、`canAutoApply=false` 和 `requiresUserConfirmation=true`。该 API 不新增长期风险状态、不修改任务或阶段计划、不触发长期 AI。

### Reports

- `GET /api/reports/periodic`
- `GET /api/reports/periodic/decisions`
- `POST /api/reports/periodic/decisions`

`GET /api/reports/periodic` 实时派生周审判和月复盘数据报告、规则策略、本地规则复盘草稿和 `decisionPreview` 下周期决策预览；`decisionPreview` 只包含聚合指标、最大短板摘要、策略、下一周期草稿和确认边界，不包含任务标题列表、完整复盘正文、附件内容或阶段计划应用结果。默认不把长期记录、情绪记录或动机档案发送给 AI。

`POST /api/reports/periodic/decisions` 允许对当前周/月报告做确认或驳回。服务端会重新计算当前报告范围，拒绝过期页面提交；同向重复提交返回已处理，反向提交返回冲突。确认会保存冻结 `reportSnapshot` 和 `nextCycleDraft`，驳回只保存冻结快照；两者都写入 `AuditEvent`，且只记录报告决策，不批量修改任务、不应用阶段计划、不外呼长期 AI。`GET /api/reports/periodic/decisions` 返回最近报告决策用于只读回放。

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

`complete/defer/drop/recover/split/convert-review` 会写现有 `AuditEvent`，并在同一事务内写入 `TaskDebtEvent` 事件账本；`split` 创建的子任务会写入 `parentTaskId`，同时继续保留 `reviewText` 说明。旧任务没有债务事件时，页面和统计仍按 `StudyTask.status/debtStatus/plannedDate` fallback。`GET /api/tasks/debt-reorder` 仍只读返回重排建议，`canAutoApply=false`、`requiresUserConfirmation=true`，不会自动改任务。`POST /api/tasks/debt-reorder/decisions` 只记录用户对所选建议的确认或驳回，写 `TaskDebtEvent.action=reorder_suggested` 和 `AuditEvent`；`POST /api/tasks/debt-reorder/applications` 会重新计算当前建议、复用 `previewTaskDebtReorderApplication` 校验所选项和小批量上限，仅在用户显式提交所选项且无跳过项时应用，并写 `TaskDebtEvent.action=reorder_applied` 和 `AuditEvent`。重排路径不提供自动应用全部建议入口，不修改 `StagePlan` / `StageAdjustmentDraft`，也不外呼长期 AI。

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
- 当前单管理员第一版全局只允许一个 active session；数据库 partial unique index 是最终约束，并发 start 冲突稳定返回 `ACTIVE_SESSION_EXISTS` / 409。
- pause/resume/end 使用 `id + status + updatedAt` CAS；过期或重复状态返回 `SESSION_STATE_CONFLICT` / 409。任务 metadata/action、simulation complete 和 debt reorder application 使用包含 `status/debtStatus/type/plannedDate/updatedAt` 的 CAS，冲突返回 `TASK_STATE_CONFLICT` / 409，失败事务不保留审计、债务事件、子任务或 CheckIn 部分副作用。
- 计时结束会基于收口字段运行反假学习规则，并双写 `StudySession.isEffective`、结构化收口字段和文本化 `note`；历史 `note` 不解析、不回填，统计优先读 `isLowConversion`，缺失时 fallback 到旧 `isEffective === false`。只有 session CAS 胜者可以累加关联任务/考纲分钟、写 `TaskDebtEvent.action=complete`、审计和 CheckIn。

### Syllabus

- `GET /api/syllabus`
- `POST /api/syllabus/nodes`
- `PATCH /api/syllabus/nodes/:id`
- `POST /api/syllabus/nodes/:id/mastery-evidence`
- `POST /api/syllabus/nodes/:id/mastery-retests`
- `POST /api/syllabus/import-markdown`

Markdown 导入只解析标题和列表，创建新的 `SyllabusNode`，不删除、不覆盖、不调用 AI，也不解析 PDF。当前限制行数、层级和标题长度，失败时不写入任何节点。

掌握证明复用 `PATCH /api/syllabus/nodes/:id`：请求可携带 `masteryLevel` 和 `masteryConditions`，服务端会持久化条件记录，并只在任务、计时、笔记、错题或复测证据满足规则时允许写入 `status=mastered` / `masteryLevel`，否则返回 `MASTERY_PROOF_REQUIRED`。成功证明会写入 `AuditEvent` 摘要。

`POST /api/syllabus/nodes/:id/mastery-evidence` 写入显式证据引用，且只允许引用同一考纲节点下的任务、计时、笔记、错题或已通过复测记录；跨节点引用返回错误。`POST /api/syllabus/nodes/:id/mastery-retests` 写入 `passed/failed/partial` 复测记录；只有 `passed` 会自动追加复测证据引用并计入复测通过证明，`failed/partial` 不会自动降低节点状态或掌握等级，也不会覆盖旧节点 `_count` fallback。没有显式证据的旧节点仍按现有 `_count` fallback 证明。

### Notes / Attachments

- `GET /api/notes`
- `POST /api/notes`
- `POST /api/notes/:noteId/attachments`
- `GET /api/attachments/:id`

附件接口实现 noteId 绑定能力：上传只走 `POST /api/notes/:noteId/attachments`，下载只走鉴权 `GET /api/attachments/:id`，UI 使用 `downloadApiPath`，不得把 `Attachment.uri`、`storedName` 或上传绝对路径作为公开 href 或响应字段。文件本体写入私有 `UPLOAD_DIR`，数据库保存 metadata、hash 和 URI；下载前会校验真实路径、size/hash 和响应头。

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
- `POST /api/simulation/stage-adjustment-drafts/ai`
- `POST /api/simulation/stage-adjustment-drafts/:id/confirm`
- `POST /api/simulation/stage-adjustment-drafts/:id/reject`
- `POST /api/simulation/first-diary`

新建模拟考试和保存模拟结果优先写入 `SimulationExam` / `SimulationSubjectResult`。`/simulation` 页面优先读取结构化模拟考试，并只读展示旧 `StudyTask.type = "simulation_exam"` 记录作为 fallback；旧任务型模拟不会被自动迁移、解析或删除。

`GET /api/simulation/tasks` 保留为旧任务型模拟只读兼容面。旧 `POST /api/simulation/tasks` 和 `POST /api/simulation/tasks/:id/complete` 路由保留但返回 `LEGACY_SIMULATION_TASK_WRITE_DISABLED`，不再创建或完成旧任务型模拟。

阶段计划可通过 `stage-plans` API 创建和局部更新；阶段调整草稿通过本地规则持久化，固定 `canAutoApply=false`、`requiresUserConfirmation=true`。`confirm` 只在用户显式确认时更新关联 `StagePlan` 的模式、目标和必要状态，并写入 `AuditEvent`；`reject` 只更新草稿状态。两者都不自动重排任务、不批量修改任务、不删除历史阶段记录。

`POST /api/simulation/stage-adjustment-drafts/ai` 作为唯一长期阶段 AI 草稿显式触发入口。该 route 必须鉴权且 POST-only，只发送最小化长期聚合字段和阶段目标摘要；成功只创建 `StageAdjustmentDraft.source="ai"` 草稿并写审计摘要，失败回退 `local_rule` 草稿。不保存完整 prompt/raw response，不发送动机档案、完整情绪记录、完整复盘正文、附件内容或完整任务标题，不自动确认草稿、不批量修改任务、不执行生产部署。报告驱动的自动阶段应用、长期应用历史扩展或更大 AI 上下文字段清单属于后续增强，必须另行确认。

### AI

- `POST /api/ai/discipline`
- `POST /api/ai/daily-review`
- `POST /api/ai/tomorrow-plan`

AI API 只返回建议，不直接修改用户原始数据。
三条 AI POST route 在 `AI_ENABLED=true` 且配置完整时可创建 OpenAI-compatible provider 并发起显式外呼；`AI_ENABLED=false` 或配置不完整时返回 `local_rule_fallback`。真实外呼只发送聚合字段，不发送动机档案、完整情绪记录、完整复盘正文、附件内容、上传路径或原始任务标题。首页普通 SSR 继续使用本地 fallback，不触发真实 provider 成本。
AI 建议结构使用 `ai_generated`、`ai_invalid_fallback` 和 `ai_error_fallback` 区分成功、校验失败和错误回退；不保存完整 prompt 或完整模型响应。
