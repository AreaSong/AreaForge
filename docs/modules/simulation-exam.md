# 全真模拟考试

## 目标

用于 2026 年 12 月第一次同步自测，以及后续阶段模拟。

## 能力

- 创建结构化模拟考试，标记是否为 2026 年 12 月同步自测。
- 按考试保存目标总分、实际总分、目标用时、实际用时、空题数量、失分原因、心态和考后总结。
- 按科目保存目标分、实际分、用时、空题数量、失分原因和科目总结。
- 同一场考试同一科目唯一保存；再次提交更新原科目结果，不新增重复行。
- 考后调用本地规则生成复盘文本，写入 `reviewText`，用于展示分差、达成率、时间压力、主要短板和下一步动作。
- 旧 `StudyTask.type = "simulation_exam"` 记录只读展示，不自动迁移、不解析历史文本。
- 旧任务型模拟写 API 保留路由但返回 `LEGACY_SIMULATION_TASK_WRITE_DISABLED`；只读列表用于历史兼容。
- 根据模拟结果生成阶段调整本地草稿；Batch 6 后可持久化为 `StageAdjustmentDraft`，但仍必须用户显式确认后才会更新关联阶段计划。

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
- `StagePlan`：阶段计划，保存阶段目标、时间边界、模式和状态。
- `StageAdjustmentDraft`：阶段调整草稿，保存本地规则建议、风险结论、重点科目、任务强度、建议动作和确认状态。

## 关键场景

2026 年 12 月和 27 考研同步进行第一次全真自测。自测结果不是终点，而是 2027 年重建计划的输入。

## 当前实现状态

- Package B Batch 5 已完成结构化模拟考试模型、API 和 `/simulation` 主写入路径。
- Package B Batch 6 已完成阶段计划、阶段调整草稿 additive migration、API 和 `/simulation` 持久草稿确认边界。
- 新 API：`GET /api/simulation/exams`、`POST /api/simulation/exams`、`POST /api/simulation/exams/:id/results`。
- 阶段计划 API：`GET/POST /api/simulation/stage-plans`、`PATCH /api/simulation/stage-plans/:id`。
- 阶段草稿 API：`GET/POST /api/simulation/stage-adjustment-drafts`、`POST /api/simulation/stage-adjustment-drafts/:id/confirm`、`POST /api/simulation/stage-adjustment-drafts/:id/reject`。
- 页面优先展示结构化考试，再展示旧任务型模拟只读 fallback。
- 当前仍不包含自动任务重排、批量修改任务、真实 AI 长期外呼、旧任务型模拟自动迁移、历史文本解析回填、删除旧字段或生产 migration deploy。报告决策入口已由 Package D Batch D1 完成；任务重排应用、报告驱动的任务/阶段应用和长期 AI 阶段调整仍归 Package D 后续批次 / `0017`。
