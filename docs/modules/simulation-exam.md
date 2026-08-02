# 全真模拟考试

## 目标

用于 2026 年 12 月第一次同步自测，以及后续阶段模拟。

## 能力

- 创建结构化模拟考试，标记是否为 2026 年 12 月同步自测。
- 按考试保存目标总分、实际总分、目标用时、实际用时、空题数量、失分原因、心态和考后总结。
- 按科目保存目标分、实际分、用时、空题数量、失分原因和科目总结。
- 按失分条目保存原因、考纲节点、0.5 分步进的失分值与备注；条目支持独立版本校验、归档和恢复。
- 同一场考试同一科目唯一保存；再次提交更新原科目结果，不新增重复行。
- 考后调用本地规则生成复盘文本，写入 `reviewText`，用于展示分差、达成率、时间压力、主要短板和下一步动作。
- 旧 `StudyTask.type = "simulation_exam"` 记录只读展示，不自动迁移、不解析历史文本。
- 旧任务型模拟写 API 保留路由但返回 `LEGACY_SIMULATION_TASK_WRITE_DISABLED`；只读列表用于历史兼容。
- 根据模拟结果生成阶段调整本地草稿，可持久化为 `StageAdjustmentDraft`，但必须用户显式确认后才会更新关联阶段计划。
- 考试先以 `DRAFT` 保存和核对；显式确认为 `CONFIRMED` 后，成绩与失分只读，补救候选才进入可执行阶段。
- 补救按“科目 + 失分原因 + 考纲节点”聚合，用户选中后写入 `PlanInbox`；系统不直接创建正式任务，也不自动调整阶段计划。
- 已确认考试按补救稳定 `originKey + originVersion` 回读对应 `PlanInboxItem`；已入箱、已忽略和已转任务状态在刷新后继续可见并禁用重复提交。

## 字段

- `SimulationExam.name`：考试名称。
- `SimulationExam.examDate`：考试日期。
- `SimulationExam.isFirstSynchronized`：是否 2026 年 12 月同步自测。
- `SimulationExam.targetDurationMinutes` / `actualDurationMinutes`：目标和实际总用时。
- `SimulationExam.targetScore` / `actualScore`：目标和实际总分。
- `SimulationExam.blankQuestionCount`：整场空题数量。
- `SimulationExam.lossReasons`：整场失分原因列表。
- `SimulationExam.mindset`：心态记录。
- `SimulationExam.summary`：考后总结。
- `SimulationExam.reviewText`：本地规则复盘文本。
- `SimulationSubjectResult.subjectId`：科目。
- `SimulationSubjectResult.targetScore` / `actualScore`：科目目标分和实际分。
- `SimulationSubjectResult.durationMinutes`：科目用时。
- `SimulationSubjectResult.blankQuestionCount`：科目空题数量。
- `SimulationSubjectResult.lossReasons`：科目失分原因。
- `SimulationSubjectResult.summary`：科目总结。
- `SimulationLossItem`：结构化失分事实，保存原因、考纲节点、失分值、备注、版本和归档状态。
- `StagePlan`：阶段计划，保存阶段目标、时间边界、模式和状态。
- `StageAdjustmentDraft`：阶段调整草稿，保存本地规则建议、风险结论、重点科目、任务强度、建议动作和确认状态。

## 关键场景

2026 年 12 月和 27 考研同步进行第一次全真自测。自测结果不是终点，而是 2027 年重建计划的输入。

## API 与页面行为

- 考试 API：`GET /api/simulation/exams`、`POST /api/simulation/exams`、`GET/PATCH /api/simulation-exams/:id`、`POST /api/simulation-exams/:id/confirm`。
- 失分与补救 API：分科失分条目使用 `/api/simulation/subject-results/:subjectResultId/loss-items*`；补救写入使用 `POST /api/simulation/exams/:id/remediations`。
- 阶段计划 API：`GET/POST /api/simulation/stage-plans`、`PATCH /api/simulation/stage-plans/:id`。
- 阶段草稿 API：`GET/POST /api/simulation/stage-adjustment-drafts`、`POST /api/simulation/stage-adjustment-drafts/ai`、`POST /api/simulation/stage-adjustment-drafts/:id/confirm`、`POST /api/simulation/stage-adjustment-drafts/:id/reject`。
- canonical 页面为 `/test/simulations`。列表优先继续最近未完成考试，再展示已确认历史和独立创建区；详情按录分、确认事实、补救入箱三步推进。
- 已确认考试的补救先进入 `/plan/inbox` 补全并显式转为任务；全部补救已入箱、已忽略或已转任务时，详情显示完成态并提供收件箱与阶段重评两个出口，不再显示重复发送命令。两条路径都不自动修改既有任务或阶段计划。
- 长期 AI 阶段草稿只走显式触发，成功只写 `StageAdjustmentDraft.source="ai"`，失败回退本地规则；模拟考试、阶段计划和首页状态主题共用统一长期风险 DTO。

## 不在当前范围

自动任务重排、批量修改任务、旧任务型模拟自动迁移、历史文本解析回填、删除旧字段，以及报告驱动的自动任务/阶段应用。

实现进度与批次证据见 [功能追踪矩阵](../development/feature-traceability.md)。
