# 数据模型

第一版核心实体：

- `User`：单管理员账号。
- `AuthSession`：登录会话，只保存 session token 哈希、过期时间和用户关联。
- `Subject`：数学、英语、政治、408 各子科目。`legacyCode`（可空，原 `code`）保留默认科目兼容；`stableKey` 必填；可空 `workspaceId`/`groupId`；未接管行以 `workspaceId IS NULL` 作为 legacy 只读范围。自定义科目不伪造 enum code。
- `ExamWorkspace` / `SubjectGroup`：考试工作区与 408 分组；同一用户最多一个 ACTIVE 工作区（partial unique）。工作区、科目与分组通过 `/settings/exams` 管理。
- `SyllabusNode`：考纲进度树节点，包含当前掌握状态和掌握等级；掌握证明优先读取显式条件、证据引用和复测记录，缺失显式证据时继续 fallback 到现有任务、计时、笔记和错题 `_count`。
- `KnowledgePoint`：独立知识点核心对象，拥有自己的掌握状态、版本和复测时间；通过 `KnowledgeSyllabusLink`、`StageKnowledgeTarget`、学习安排和多次复测关联考纲与阶段，因此同一知识点可以跨阶段、跨考纲和跨检验重复出现。
- `StudyTask`：每日任务；`parentTaskId` 自关联记录拆小任务的父子关系。旧任务没有父子关系时保持 `null`，不做猜测回填。当前已支持可空 `planMilestoneId`、相关考纲关联表、`StudyTaskStageLink` 多阶段关联和 `StudyTaskKnowledgePoint` 多知识点关联，以及可空 `reviewScheduleId`（复习任务桥接；同一 Schedule 最多一个未完成桥接任务）。拆小任务继承父任务的里程碑、主/相关考纲、阶段和知识点关系；创建与更新会校验工作区、科目、归档状态和重复 ID。
- `StudyTaskKnowledgePoint`：任务与独立知识点的多对多关系表；同一知识点可被多个任务、阶段、考纲和检验复用，关系删除随任务或知识点级联，不复制知识点本体。
- `PlanMilestone` / `TaskDependency` / `PlanInboxItem`：阶段里程碑、软硬依赖与投入草稿。含原子 `convert`，页面入口位于 `/roadmap/stages`、`/roadmap/allocation`、`/roadmap/allocation/drafts` 与 `/roadmap/allocation/tasks/:taskId`。
- `LearningArrangement`：学习投入安排；当前以 `intent=weekly-subject-budget:v1` 复用为每科自然周预算，`startDate/endDate` 固定对应周边界，`PLANNED/CANCELED` 表示已设置或已清空，revision 用于逐科 CAS。预算不是任务，不从考纲 `targetMinutes` 派生。
- `StudySession`：统一活动计时记录；`activityKind` 为 `STUDY/REVIEW/TEST`，`activityMode` 为 `FREE_STUDY/KNOWLEDGE_REVIEW/RETEST/SIMULATION`，并通过 `reviewScheduleId`、`knowledgeRetestId` 或 `simulationExamId` 绑定已配置的特殊活动。自由学习只允许 `STUDY + FREE_STUDY`，专项复测属于 `REVIEW + RETEST`，模拟考试属于 `TEST + SIMULATION`。结构化收口字段包括理解程度、最小产出、下一步动作、是否产生笔记/错题、低转化标记、反假学习原因、补产出要求和收口版本，同时保留旧 `note` 文本可读。当前状态包含 `RUNNING/PAUSED/CLOSING/COMPLETED/CANCELED`，`CLOSING` 冻结结束时刻并要求完整收口。PostgreSQL partial unique index `StudySession_one_active_per_user_idx` 保证全局最多一个活动 session；该索引由 additive SQL migration 管理。`goalMinutes` / `startSource` / `clientDeviceId` / `clientDeviceLabel` / `lastHeartbeatAt` 均可空，设备字段只用于跨标签页、跨设备状态提示，不构成浏览器指纹。
- `DailyReview`：每日复盘；当前已支持可空 `workspaceId`，并以 partial unique 区分 legacy 与 workspace 复合唯一。
- `CheckIn`：每日打卡快照；按学习日唯一，记录最低动作、总/有效时长、有效 session 数、任务完成率、复盘状态、低效标记、低转化次数和来源版本。当前支持 CheckIn v2 字段（`reviewCount`/`reviewSeconds`/结果计数/`minimumActionSource`）；触达日原子升级 `sourceVersion=2`，不批量回填历史。新写路径维护快照，历史无快照日期由读取侧 fallback 派生；同一学习日刷新在事务内先获取 `pg_advisory_xact_lock(1095123785, YYYYMMDD)`，再读取聚合并写入，避免旧快照覆盖新提交。当前已支持可空 `workspaceId` 与 partial unique。
- `TaskDebtEvent`：任务债务事件账本；记录补做、延期、放弃、拆小、改复习和完成动作的前后状态、债务状态、关联任务、原因、metadata 和操作者。旧任务没有事件时继续按 `StudyTask.status/debtStatus/plannedDate` fallback。
- `RecoveryState`：恢复模式状态；记录状态、触发类型、开始/结束时间、目标分钟、聚焦任务数量、原因、退出条件、metadata 和操作者。当前支持 Recovery v2（`userId`/`currentStage`/窗口学习日/`progressionVersion`/`revision`；`(userId, workspaceId)` active partial unique；30/60/90 三阶）。规则触发和手动触发只写恢复状态，不批量修改历史欠账，不隐藏或删除任务。当前已支持可空 `workspaceId`。
- `MasteryConditionRecord`：掌握条件记录；按 `syllabusNodeId + condition` 唯一，保存条件是否勾选、勾选时间和操作者。
- `MasteryEvidence`：掌握证据引用；可引用同一考纲节点下的任务、计时、笔记、错题或已通过复测记录，并记录证据类型、摘要和操作者。
- `MasteryRetest`：专项复测记录；保存复测时间、`passed/failed/partial` 结果、分数、摘要、显式复盘和下次复测时间，并通过 `StudySession.activityMode=RETEST` 关联专用计时。可空唯一 `reviewEventId` 关联统一复习事件。只有 `passed` 计入复测通过证明，失败或部分通过不会自动降低 `SyllabusNode.status/masteryLevel`。
- `SimulationExam`：结构化模拟考试记录；保存考试名称、日期、是否 2026 同步自测、目标/实际用时、目标/实际总分、空题数量、失分原因、心态、总结、用户显式复盘和规则复盘文本，并通过 `StudySession.activityMode=SIMULATION` 关联专用计时。新建模拟考试优先写入该模型。当前已支持可空 `workspaceId`。
- `SimulationSubjectResult`：模拟考试科目结果；按 `simulationExamId + subjectId` 唯一，保存科目目标分、实际分、用时、空题数量、失分原因和总结。同一场同一科再次保存会更新，不新增重复结果。
- `StagePlan`：阶段计划记录；保存阶段名称、开始/结束时间、阶段目标、模式和状态。阶段计划可被模拟考试和周期报告读取，用作长期调整草稿的目标边界。当前已支持可空 `workspaceId`/`stableKey`/`revision`。
- `StageAdjustmentDraft`：阶段调整草稿；保存来源、本地规则模式、风险结论、重点科目、任务强度、建议动作、下一阶段重点和确认状态。草稿固定 `canAutoApply=false`、`requiresUserConfirmation=true`，只有用户显式确认后才会更新关联 `StagePlan` 并写入审计。当前已支持可空 `workspaceId`。
- `PeriodicReportDecision`：周/月报告决策记录；保存确认或驳回状态、冻结 `reportSnapshot`、确认时的 `nextCycleDraft`、`canAutoApply=false`、`requiresUserConfirmation=true`、操作者和决策时间。当前已支持可空 `workspaceId`，并以 partial unique 区分 legacy `(kind, rangeStart, rangeEnd)` 与 workspace 复合唯一。它只用于报告回放和审计，不批量修改任务，不应用阶段计划。
- `Note`：文字笔记和自己的理解；当前已支持六类 `kind`、`studyDate`/`stableKey`/`revision`、相关考纲关联表与可空 `archivedAt`。
- `Attachment`：图片、PDF、拍照笔记等文件 metadata；附件绑定 `noteId`，文件本体写入私有 `UPLOAD_DIR`，数据库只保存原始名、随机存储名、MIME、size、hash 和内部 URI，UI/API 不暴露 `uri`、`storedName` 或上传绝对路径。
- `Mistake`：可反复作答的错题对象；`questionText` 对历史数据可空，新建必填，另保存可选 `correctAnswer`、`causeNote`、正确思路与归档状态。
- `MistakeAttempt`：不可回写的单次错题作答证据，保存文字或纸上/口头模式、答案、自评结果、可选时长与复盘备注；`(mistakeId, idempotencyKey)` 唯一。统一复习产生的作答与 `ReviewEvent` 可选一对一，独立作答不改变 `ReviewSchedule`。
- `NoteMistakeLink` / `StudyResourceMistakeLink`：错题到知识卡片和学习资料的直接关系。文件本体仍只由资料/附件既有鉴权链路承载。
- `MotivationVault`：动机封存内容。
- `AuditEvent`：关键写操作审计；债务任务动作保留 `AuditEvent` 并额外写入 `TaskDebtEvent`；掌握证明、证据引用、复测记录、结构化模拟考试创建与结果保存、阶段计划创建与更新、阶段调整草稿创建/驳回/确认应用、报告确认与驳回都写入审计摘要。不保存完整 prompt、附件内容或生产运维信息。

PostgreSQL 是主状态源事实。附件本体存储在持久化上传目录，数据库只保存 metadata、hash 和 URI。

## 核心实体（补充）

- `SyllabusNode.stableKey` / `revision` / `archivedAt`：Migration 5；`(subjectId, stableKey)` unique；无键旧节点按兼容规则在首次 confirm/export 补键，不批量回填。
- `LearningTreeImportBatch` / `LearningTreeImportItem`：仅 confirm 成功时创建；规范化 Markdown、hash、`(workspaceId, idempotencyKey)` unique、request fingerprint、软归档；preview 不写领域表。
- `StudyResource`：FILE（READY Attachment）或 LINK（HTTPS）exactly-one；支持 CRUD、上传、重复三选一和归档，页面入口位于 `/knowledge/resources`；不物理删除。
- `ReviewSchedule` / `ReviewEvent`：统一复习排期与不可变确认事件；exactly-one 目标、幂等确认、correction 链、桥接任务；页面入口位于 `/knowledge/reviews` 与 `/knowledge/reviews/[scheduleId]/run`。
- `KnowledgeCanvasLayout` / `KnowledgeCanvasNodeLayout`：每用户每工作区唯一布局；节点仅 x/y/折叠/固定/隐藏；业务边实时派生。隔离验收已开放 `/knowledge/canvas` 与 layout API。
- `MotivationItem` / `MotivationReminderState` / `NotificationPreference` / `AiDraftOperation`：schema + 隔离 API/设置页已落地。
- `AiRuntimeSetting`：全局 AI Web 运行开关单例；保存 enabled、revision 和时间字段。启停由鉴权 Web API 修改并写入 `AuditEvent`；`AI_ENABLED=false` 仍是服务端硬闸门，网页不能绕过。
- `AiProviderCredential`：当前账户 Provider 配置；服务端保存 base URL、model、API Key 密文、fingerprint、revision 和时间字段，API Key 不进入 Web 响应或审计 metadata。
- `SimulationLossItem`：直接归属分科结果，固定原因、可选考纲节点、0.5 分 lostScore、revision 与软归档；可选 `mistakeId` 记录“转为错题”来源，一个失分项最多关联一条错题。

## 规划扩展模型

后续实体继续遵循 additive-first；已落地模型见上方与 Prisma schema。完整字段、唯一约束与 migration 顺序见 `workflow/versions/v1.1-learning-action-center.md`。旧数据只读兼容，不批量猜测回填。

## 认证相关约束

- `User.email` 唯一。
- `User.passwordHash` 只保存哈希，不保存明文密码。
- `AuthSession.tokenHash` 唯一。
- `AuthSession` 过期或注销后应删除或标记失效。
- Cookie 中的明文 session token 不落库、不入日志。

## v1.4 身份与 Workspace 归属目标（规划，未授权实施）

v1.4 采用 additive-first，不把现有 `ExamWorkspace.userId` 直接重命名或删除。该字段继续作为兼容 owner 指针；新增 Membership 在功能开关开启后成为成员身份源，二者必须由事务和约束保持一致。进入 v1.5 前，成员关系本身不会自动授予动机、情绪、完整复盘、私有笔记/附件、AI 输入或导出文件的读取权。

### 目标实体

- `User`：新增账户状态、邮箱验证时间、密码修改时间和 `authRevision`。账户冻结、密码重置或撤销全部会话时递增 revision，使旧 session 在下一次请求立即失效。
- `AuthSession`：继续只保存 token hash；新增设备显示名、脱敏 IP/User-Agent hash、最近重新验证时间、撤销原因和创建时的 `authRevision`。设备信息只用于账户安全中心，不构成浏览器指纹或风险画像。
- `AuthActionToken`：承载邮箱验证和密码重置的一次性 token；只保存 purpose-separated hash、用途、过期时间、消费时间和目标用户，不保存明文 token。
- `WorkspaceMembership`：`workspaceId + userId` 唯一，保存 `OWNER/MEMBER` 初始角色、活动/离开/移除状态、revision 和生命周期时间。`ADMIN/COACH/VIEWER` 的授权语义留到 v1.5 RBAC 包；v1.4 不提前开放角色编辑。
- `WorkspaceInvitation`：保存目标邮箱规范值、MEMBER 邀请、token hash、邀请人、过期/接受/撤销状态和 revision；同 Workspace 同邮箱最多一个有效邀请。
- `WorkspaceSelection`：每个用户唯一记录当前选择的 Workspace 和 revision。它只表达导航上下文，不代表授权；每次读取仍需重新校验账户、Workspace 和 Membership。
- `AuthThrottleBucket`：以脱敏的 IP/邮箱组合键保存登录/邀请/重置的窗口计数与锁定时间，替代仅进程内 Map 的限流状态，使多实例重启不会清空防护。

### 数据归属分类

| 分类 | 当前对象 | v1.4 规则 |
|---|---|---|
| 账户私有 | `AuthSession`、`MotivationItem`、`MotivationReminderState`、`NotificationPreference`、`AiProviderCredential` | 仅账户本人；Membership 不扩大读取 |
| 用户在 Workspace 内的私有状态 | `KnowledgeCanvasLayout`、个人 session/复盘/CheckIn/恢复状态及后续个人偏好 | 同一 Workspace 的其他成员默认不可见；需要的 owner 字段按 nullable + 精确回填逐批增加 |
| Workspace 结构 | `ExamWorkspace`、`SubjectGroup`、`Subject`、阶段/考纲结构和成员目录 | v1.4 只开放最小成员目录与 Workspace 摘要；业务读写 capability 在 v1.5 policy service 落地后开放 |
| 作者/审计归属 | `actorId`、导入/导出 grant、审计事件、建议草稿 | `actorId` 只表示谁执行，不单独构成访问权；查询必须同时带 Workspace scope 和 capability |
| 高敏正文与文件 | 动机、情绪、完整复盘、笔记/错题正文、附件、AI 输入、导出包 | 默认仅所有者；角色不自动可见，v1.5 只能通过显式、可撤销 grant 开放 |

### 迁移与兼容顺序

1. 只新增 enum、nullable 字段、Membership/Invitation/Selection/ActionToken/Throttle 表和索引，不删除旧列。
2. 在隔离 PostgreSQL 中为每个现有 `ExamWorkspace.userId` 写入唯一 `OWNER` Membership，并为每个现有用户选择其当前 ACTIVE Workspace；回填前后数量和 owner 映射必须完全一致。
3. `User.authRevision`、账户状态和现有 `AuthSession.authRevision` 使用确定性默认值；现有 session 不因本地 migration 被意外注销。
4. 先双读旧 owner 与 Membership 并比较，再通过功能开关切换；任何差异都 fail closed，不猜测 owner。
5. Workspace 选择与生命周期分离后，创建/切换不再通过归档另一个 Workspace 实现；旧 owner 兼容路径仍可在关闭多人入口后访问当前选择的个人 Workspace。
6. 首批双读与 Selection fixture 稳定后，在同一 AUTH 确认范围的后续 migration 中移除旧单 ACTIVE partial unique；从这一刻起 rollback floor 必须是理解 WorkspaceSelection 的 v1.4 compatibility build，不能直接回滚到 v1.3 二进制。
7. 删除旧 owner 字段、清理 compatibility read 或 destructive 数据收口不属于 v1.4 AUTH 包，必须在已有多人数据证明稳定后另行确认。
