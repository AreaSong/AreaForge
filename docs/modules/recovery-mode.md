# 恢复模式

## 目标

连续失守后帮助用户重新启动，而不是直接用高压任务压垮用户。

## 触发条件

- 连续多天未打卡。
- 任务完成率长期过低。
- 学习时长明显低于最低要求。
- 用户主动选择“我需要恢复”。

## 规则

- 计时器优先聚焦最小可执行任务；完整任务列表仍可查看。
- 默认目标为 30 到 90 分钟学习。
- 具体目标由当前风险和欠账规则决定；首页“下一步”、恢复状态和计时器必须显示同一个目标分钟数，不能把 30 分钟文案写死。
- 不强制补完所有欠账。
- 优先恢复行动感和连续性。
- 完成恢复任务后逐步恢复正常计划。

## 文案

- 可以严肃，但不羞辱。
- 重点不是补偿过去，而是今天重新开始。

## 当前行为

`packages/core` 提供 `rankRecoveryTaskCandidates` 和 `selectRecoveryTaskCandidate` 纯规则，用于恢复模式下排除已完成/跳过任务、优先可见欠账、去重，并在同等优先级下选择预计时长更小的任务。

`RecoveryState` 持久状态：

- dashboard 和首页优先读取 active `RecoveryState`。
- 无 active 状态时继续使用 `createRecoveryPlan` 实时规则 fallback。
- 规则触发恢复时幂等创建 `triggerType=rule` 的 active 状态。
- 用户点击“我需要恢复”时创建或复用 `triggerType=manual` 的 active 状态。
- 完成或取消恢复只更新 `RecoveryState.status/endedAt/exitCondition`。
- 恢复状态不会批量修改历史欠账，不隐藏、删除或延期原任务；首页计时器聚焦恢复候选，任务区保留完整任务列表。

实现进度与批次证据见 [功能追踪矩阵](../development/feature-traceability.md)。
