# 数据模型

第一版核心实体：

- `User`：单管理员账号。
- `AuthSession`：登录会话，只保存 session token 哈希、过期时间和用户关联。
- `Subject`：数学、英语、政治、408 各子科目。
- `SyllabusNode`：考纲进度树节点，包含当前掌握状态和掌握等级；Batch 4 后掌握证明优先读取显式条件、证据引用和复测记录，缺失显式证据时继续 fallback 到现有任务、计时、笔记和错题 `_count`。
- `StudyTask`：每日任务；Batch 2 已追加 `parentTaskId` 自关联，用于记录拆小任务的父子关系。旧任务没有父子关系时保持 `null`，不做猜测回填。
- `StudySession`：学习计时记录；Batch 0 已追加结构化收口字段，包括理解程度、最小产出、下一步动作、是否产生笔记/错题、低转化标记、反假学习原因、补产出要求和收口版本，同时保留旧 `note` 文本可读。OPS-006 使用 PostgreSQL partial unique index `StudySession_one_active_idx` 保证全局最多一个 `RUNNING/PAUSED` session；该索引由 additive SQL migration 管理，不在 Prisma schema 中伪装成 `status` 全值唯一。
- `DailyReview`：每日复盘。
- `CheckIn`：每日打卡快照；Batch 1 已新增学习日唯一快照，记录最低动作、总/有效时长、有效 session 数、任务完成率、复盘状态、低效标记、低转化次数和来源版本。新写路径维护快照，历史无快照日期由读取侧 fallback 派生；同一学习日刷新在事务内先获取 `pg_advisory_xact_lock(1095123785, YYYYMMDD)`，再读取聚合并 upsert，避免旧快照覆盖新提交。
- `TaskDebtEvent`：任务债务事件账本；Batch 2 已新增，用于记录补做、延期、放弃、拆小、改复习和完成动作的前后状态、债务状态、关联任务、原因、metadata 和操作者。旧任务没有事件时继续按 `StudyTask.status/debtStatus/plannedDate` fallback。
- `RecoveryState`：恢复模式状态；Batch 3 已新增，用于记录 `active/completed/canceled` 状态、`rule/manual` 触发类型、开始/结束时间、目标分钟、聚焦任务数量、原因、退出条件、metadata 和操作者。规则触发和手动触发只写恢复状态，不批量修改历史欠账，不隐藏或删除任务。
- `MasteryConditionRecord`：Batch 4 已新增的掌握条件记录；按 `syllabusNodeId + condition` 唯一，保存条件是否勾选、勾选时间和操作者。
- `MasteryEvidence`：Batch 4 已新增的掌握证据引用；可引用同一考纲节点下的任务、计时、笔记、错题或已通过复测记录，并记录证据类型、摘要和操作者。
- `MasteryRetest`：Batch 4 已新增的复测记录；保存复测时间、`passed/failed/partial` 结果、分数、摘要和下次复习时间。只有 `passed` 计入复测通过证明，失败或部分通过不会自动降低 `SyllabusNode.status/masteryLevel`。
- `SimulationExam`：Batch 5 已新增的结构化模拟考试记录；保存考试名称、日期、是否 2026 同步自测、目标/实际用时、目标/实际总分、空题数量、失分原因、心态、总结和规则复盘文本。新建模拟考试优先写入该模型。
- `SimulationSubjectResult`：Batch 5 已新增的模拟考试科目结果；按 `simulationExamId + subjectId` 唯一，保存科目目标分、实际分、用时、空题数量、失分原因和总结。同一场同一科再次保存会更新，不新增重复结果。
- `StagePlan`：Batch 6 已新增的阶段计划记录；保存阶段名称、开始/结束时间、阶段目标、模式和状态。阶段计划可被模拟考试和周期报告读取，用作长期调整草稿的目标边界。
- `StageAdjustmentDraft`：Batch 6 已新增的阶段调整草稿；保存来源、本地规则模式、风险结论、重点科目、任务强度、建议动作、下一阶段重点和确认状态。草稿固定 `canAutoApply=false`、`requiresUserConfirmation=true`，只有用户显式确认后才会更新关联 `StagePlan` 并写入审计。
- `PeriodicReportDecision`：Package D Batch D1 已新增的周/月报告决策记录；按 `kind + rangeStart + rangeEnd` 唯一，保存确认或驳回状态、冻结 `reportSnapshot`、确认时的 `nextCycleDraft`、`canAutoApply=false`、`requiresUserConfirmation=true`、操作者和决策时间。它只用于报告回放和审计，不批量修改任务，不应用阶段计划。
- `Note`：文字笔记和自己的理解。
- `Attachment`：图片、PDF、拍照笔记等文件 metadata；Package A 后第一版已支持 `noteId` 绑定附件，文件本体写入私有 `UPLOAD_DIR`，数据库只保存原始名、随机存储名、MIME、size、hash 和内部 URI，UI/API 不暴露 `uri`、`storedName` 或上传绝对路径。
- `Mistake`：错题与错因。
- `MotivationVault`：动机封存内容。
- `AuditEvent`：关键写操作审计；Batch 2 后债务任务动作继续保留 `AuditEvent`，并额外写入 `TaskDebtEvent`；Batch 4 后掌握证明、证据引用和复测记录写入均保留审计摘要；Batch 5 后结构化模拟考试创建和结果保存也写入审计；Batch 6 后阶段计划创建、更新、阶段调整草稿创建、驳回和确认应用也写入审计；Package D Batch D1 后报告确认和驳回也写入审计摘要。不保存完整 prompt、附件内容或生产运维信息。

PostgreSQL 是主状态源事实。附件本体存储在持久化上传目录，数据库只保存 metadata、hash 和 URI。

## 认证相关约束

- `User.email` 唯一。
- `User.passwordHash` 只保存哈希，不保存明文密码。
- `AuthSession.tokenHash` 唯一。
- `AuthSession` 过期或注销后应删除或标记失效。
- Cookie 中的明文 session token 不落库、不入日志。
