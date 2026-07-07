# 任务债务

## 目标

任务债务系统用于管理没有完成的任务，避免任务失败后无声消失。

## 欠账等级

- 可接受欠账：短期不影响阶段计划。
- 需要补：近期需要安排补做。
- 影响阶段：已经影响本周或本阶段目标。
- 计划崩坏：欠账过多，需要重排计划。

## 处理方式

- 补做。
- 延期。
- 拆小。
- 合并。
- 放弃。
- 改成复习任务。

## 第一版规则

- 未完成任务自动进入欠账池。
- 今日作战台显示欠账数量。
- 恢复模式下只选择最小欠账任务。
- 欠账过多时提升风险等级。

## 第二阶段增强

- 根据阶段目标生成哪些欠账必须补的建议。
- 根据剩余时间生成延期、拆分或放弃建议。
- 生成任务债务重排建议，但不自动应用。
- 周审判和月复盘中统计欠账变化。

当前 `packages/core` 已提供 `suggestTaskDebtReorder` 纯规则，可根据欠账任务、阶段压强和可用时间生成补做、延期、拆小、放弃或改复习建议，并明确 `canAutoApply=false`、`requiresUserConfirmation=true`。首页任务区和 `GET /api/tasks/debt-reorder` 已接入只读建议展示。债务动作事件账本已由 Package B Batch 2 落地；应用重排或批量修改任务仍需 Package D 确认。

恢复模式的候选选择已由 `rankRecoveryTaskCandidates` / `selectRecoveryTaskCandidate` 提供纯规则：欠账优先、排除已完成或跳过任务、去重，并优先选择更小的可执行任务。

## 事件账本

Package B Batch 2 已新增 `TaskDebtEvent` 和 `StudyTask.parentTaskId`：

- `complete/defer/drop/recover/split/convert_review` 会继续写 `AuditEvent`，并同步写 `TaskDebtEvent`。
- 计时结束时，若用户勾选完成任务且本次有效，关联任务完成也写 `TaskDebtEvent.action=complete`。
- 模拟考试任务完成复用任务完成语义，写 `TaskDebtEvent.action=complete`。
- 拆小任务写入子任务 `parentTaskId`，父任务事件的 `relatedTaskId` 指向子任务。
- 旧任务没有债务事件时，仍按 `StudyTask.status/debtStatus/plannedDate` 作为欠账 fallback。
- `GET /api/tasks/debt-reorder` 仍是只读建议，不写 `reorder_suggested`，不写 `reorder_applied`，不自动应用任务重排。
