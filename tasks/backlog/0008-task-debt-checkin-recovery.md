# 0008 任务债务、打卡、反假学习与恢复模式

状态：基础闭环已完成；保留在 backlog 作为 Package D/0017 的路径稳定入口。低风险规则层已收口；Package B Batch 0 已结构化计时收口，Batch 1 已新增 `CheckIn` 日快照并接入新写路径，Batch 2 已新增 `TaskDebtEvent` 债务事件账本和 `StudyTask.parentTaskId`，Batch 3 已新增 `RecoveryState` 恢复状态，Batch 4 已新增显式掌握证明记录，Batch 5 已新增结构化模拟考试记录，Batch 6 已新增阶段计划和阶段调整草稿。Package D Batch D1 已完成报告确认/驳回和只读回放；Batch D2 已完成任务债务重排确认/驳回/所选项应用。长期 AI 和更深阶段联动仍需 Package D / `0017` 确认。

## 目标

把“每天回来学习”的规则闭环补实，让任务欠账、有效打卡、低转化学习和恢复模式形成可执行反馈。

## 范围

- 未完成任务进入任务债务视图或规则池。
- 任务支持补做、延期、拆小、放弃、改成复习任务的基础流转。
- 打卡连续性按有效学习动作计算。
- 计时结束完整收口：学习质量、是否有效学习、理解程度、最小产出、下一步动作、是否产生笔记或错题。
- 计时结束和晚间复盘记录反假学习检查问题。
- 恢复模式下计时器聚焦最小可执行任务和 30 到 90 分钟目标，完整任务列表仍可查看。
- 第二阶段提供任务债务重排建议，但不自动覆盖用户计划。

## 不包含

- AI 自动重排任务。
- 未经确认自动应用任务重排。
- 复杂长期阶段计划。
- 多用户隔离改造。

## 参考源事实

- `docs/modules/task-debt.md`
- `docs/modules/check-in.md`
- `docs/modules/anti-fake-study.md`
- `docs/modules/recovery-mode.md`
- `docs/ux/recovery-mode.md`
- `docs/ux/dashboard-states.md`

## 验收标准

- 首页能展示当前欠账、风险和恢复状态。
- 计时收口字段可结构化保存并用于反假学习判断。
- 低转化学习能被计时收口或复盘记录识别。
- 连续打卡和断签指标来自真实学习记录。
- 恢复模式不会要求补完所有历史欠账。
- `pnpm check` 通过。

## 当前进展

- `packages/core` 已补充打卡判断和恢复计划纯函数。
- `packages/core/src/study-integrity.ts` 已补充结构化计时收口归一、近窗打卡历史汇总和轻量任务债务动作总结纯函数，用于结构化收口、`CheckIn` 和债务事件账本的规则基线。
- `CheckIn` 日快照已由 Package B Batch 1 落地：结束计时、保存复盘、任务创建、计划日变化和状态变化后会按学习日 upsert；dashboard、analytics、reports 优先读快照并保留缺失日期 fallback。
- 首页已展示打卡连续性原因、恢复模式建议、手动恢复入口、完成/取消恢复入口和欠账预览。
- Dashboard API 已返回 `checkIn`、`recovery`、`debtTasks`、`visibleRecoveryTasks` 和低转化次数；Batch 3 后 `recovery` 包含 `stateId/source/status/triggerType/startedAt/endedAt/exitCondition`。
- 恢复模式已接入 `RecoveryState`：规则触发和手动触发会创建或复用 active 状态，完成/取消只更新恢复状态；首页计时器聚焦最小可执行任务，任务面板保留完整任务列表，不删除原任务。
- 已新增任务轻量流转 API/UI：补做、拆小、改成复习任务；Package B Batch 2 后这些动作继续复用 `StudyTask` 现有字段和 `reviewText` 备注，并同步写入 `TaskDebtEvent`。
- Package D Batch D2 后，债务重排建议可在首页勾选后确认、驳回或应用所选；确认/驳回不修改任务，只写 `TaskDebtEvent.action=reorder_suggested` 和 `AuditEvent`；应用所选会重新校验当前建议和任务状态，只处理所选小批量，并写 `TaskDebtEvent.action=reorder_applied` 和 `AuditEvent`。
- 计时结束已接入反假学习规则，结果写入现有 `StudySession.isEffective` 和文本化 `note`。
- 历史无快照日期不做不可靠回填，旧任务债务事件不做猜测回填；恢复状态不批量修改历史欠账。

## 验证

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/core typecheck`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm check`
- API 烟测：完成、延期、放弃、补做、拆小、改复习和计时收口路径可用。
- 页面烟测：首页正常、断签警报和恢复模式状态可读。

## 风险

- 阶段计划模型已完成；若新增任务重排应用、报告决策、长期 AI 或批量任务调整，需要继续走高风险确认后再执行。
- 恢复模式规则会影响首页任务优先级，必须避免让用户丢失原任务记录。
