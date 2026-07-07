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

今日作战台返回真实数据库聚合，并包含最近一次已完成计时 `latestCompletedSession`，用于刷新后继续展示结构化收口、低转化原因和补产出要求。

### Analytics

- `GET /api/analytics/summary`

统计 API 只读派生，不写统计快照表。第一版从任务、计时、复盘、错题、笔记和考纲节点实时计算近 7 天统计、风险提醒与下一步动作。

### Reports

- `GET /api/reports/periodic`

周期报告 API 只读派生，不写报告快照表。第一版返回周审判和月复盘数据报告、规则策略和本地规则复盘草稿；默认不把长期记录、情绪记录或动机档案发送给 AI。

### Tasks

- `GET /api/tasks`
- `GET /api/tasks/debt-reorder`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/complete`
- `POST /api/tasks/:id/defer`
- `POST /api/tasks/:id/drop`
- `POST /api/tasks/:id/recover`
- `POST /api/tasks/:id/split`
- `POST /api/tasks/:id/convert-review`

当前补做、拆小和改复习任务复用 `StudyTask` 现有字段，只记录轻量备注，不代表完整任务债务事件账本已经落地。`GET /api/tasks/debt-reorder` 只读返回重排建议，`canAutoApply=false`、`requiresUserConfirmation=true`，不会自动改任务。完整父子关系、债务处理历史和重排采纳记录仍需 migration 后推进。

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
- 计时结束会基于收口字段运行反假学习规则，并双写 `StudySession.isEffective`、结构化收口字段和文本化 `note`；历史 `note` 不解析、不回填，统计优先读 `isLowConversion`，缺失时 fallback 到旧 `isEffective === false`。

### Syllabus

- `GET /api/syllabus`
- `POST /api/syllabus/nodes`
- `PATCH /api/syllabus/nodes/:id`
- `POST /api/syllabus/import-markdown`

Markdown 导入只解析标题和列表，创建新的 `SyllabusNode`，不删除、不覆盖、不调用 AI，也不解析 PDF。当前限制行数、层级和标题长度，失败时不写入任何节点。

掌握证明基础版复用 `PATCH /api/syllabus/nodes/:id`：请求可携带 `masteryLevel` 和一次性的 `masteryConditions`，服务端只在现有任务、计时、笔记或错题证据满足规则时允许写入 `status=mastered` / `masteryLevel`，否则返回 `MASTERY_PROOF_REQUIRED`。成功证明会写入 `AuditEvent` 摘要；显式条件表、证据引用表和复测记录仍属于 Package B Batch 4。

### Notes / Attachments

- `GET /api/notes`
- `POST /api/notes`
- `POST /api/notes/:noteId/attachments`
- `GET /api/attachments/:id`

上述附件接口是 Package A 的目标 API，当前仍待确认/未实现。Package A 确认前不得新增上传/下载 route，不得写入 `UPLOAD_DIR`，也不得把 `Attachment.uri` 当作公开 href；`uri` 只是内部 metadata，确认后的下载入口才是鉴权 `GET /api/attachments/:id`。

附件不通过 public 直接暴露，必须走鉴权接口。

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

- `GET /api/simulation/tasks`
- `POST /api/simulation/tasks`
- `POST /api/simulation/tasks/:id/complete`
- `GET /api/simulation/stage`
- `POST /api/simulation/first-diary`

当前模拟考试入口复用 `StudyTask.type = "simulation_exam"` 和 `MotivationVault.firstSimulationDiary`，不代表完整 `SimulationExam` 表已经落地。结构化模拟考试结果、阶段计划应用记录和 AI 阶段调整建议仍需 migration 与 AI 隐私边界确认后推进。

### AI

- `POST /api/ai/discipline`
- `POST /api/ai/daily-review`
- `POST /api/ai/tomorrow-plan`

AI API 只返回建议，不直接修改用户原始数据。
当前 AI API 在 `AI_ENABLED=false` 时只返回 `local_rule_fallback` 本地规则建议，不调用外部 AI，不发送动机档案、完整情绪记录或完整复盘正文。
AI 建议结构已预留 `ai_generated`、`ai_invalid_fallback` 和 `ai_error_fallback` 状态，用于后续真实 provider 接入后的成功、校验失败和错误回退；当前生产路径仍不发起外部请求。
