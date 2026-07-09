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

当前 `packages/core` 已提供 `suggestTaskDebtReorder` 纯规则，可根据欠账任务、阶段压强和可用时间生成补做、延期、拆小、放弃或改复习建议，并明确 `canAutoApply=false`、`requiresUserConfirmation=true`。`previewTaskDebtReorderApplication` 固定“只处理所选项、应用前校验、小批量上限和跳过摘要”；它本身不写库、不修改任务。首页任务区和 `GET /api/tasks/debt-reorder` 已接入只读建议展示。Package D Batch D2 后，首页任务区支持勾选当前展示的建议并执行确认、驳回或应用所选；服务端会重新计算当前建议，确认/驳回写 `reorder_suggested` 事件和审计，应用所选写 `reorder_applied` 事件和审计。D2 不自动应用全部建议，不新增 migration，不修改阶段计划，不外呼长期 AI。

恢复模式的候选选择已由 `rankRecoveryTaskCandidates` / `selectRecoveryTaskCandidate` 提供纯规则：欠账优先、排除已完成或跳过任务、去重，并优先选择更小的可执行任务。

## 事件账本

Package B Batch 2 已新增 `TaskDebtEvent` 和 `StudyTask.parentTaskId`：

- `complete/defer/drop/recover/split/convert_review` 会继续写 `AuditEvent`，并同步写 `TaskDebtEvent`。
- 计时结束时，若用户勾选完成任务且本次有效，关联任务完成也写 `TaskDebtEvent.action=complete`。
- 模拟考试任务完成复用任务完成语义，写 `TaskDebtEvent.action=complete`。
- 拆小任务写入子任务 `parentTaskId`，父任务事件的 `relatedTaskId` 指向子任务。
- 旧任务没有债务事件时，仍按 `StudyTask.status/debtStatus/plannedDate` 作为欠账 fallback。
- `GET /api/tasks/debt-reorder` 只读，仍只返回建议；确认/驳回/应用必须通过 Package D Batch D2 的 POST-only 写入口，并且只处理用户所选项。
- `POST /api/tasks/debt-reorder/decisions` 写 `TaskDebtEvent.action=reorder_suggested` 与 `AuditEvent`，不修改任务。
- `POST /api/tasks/debt-reorder/applications` 写 `TaskDebtEvent.action=reorder_applied` 与 `AuditEvent`，应用前重新校验任务状态和当前建议；有跳过项时按 `shouldStopOnFirstFailure` 停止写入并返回摘要。
