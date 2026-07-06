# 0008 任务债务、打卡、反假学习与恢复模式

状态：低风险规则层已收口到可继续推进 migration 前的基线。当前只使用已有任务、计时和复盘数据推导打卡、恢复建议、欠账预览和低转化信号；未新增 migration。

## 目标

把“每天回来学习”的规则闭环补实，让任务欠账、有效打卡、低转化学习和恢复模式形成可执行反馈。

## 范围

- 未完成任务进入任务债务视图或规则池。
- 任务支持补做、延期、拆小、放弃、改成复习任务的基础流转。
- 打卡连续性按有效学习动作计算。
- 计时结束完整收口：学习质量、是否有效学习、理解程度、最小产出、下一步动作、是否产生笔记或错题。
- 计时结束和晚间复盘记录反假学习检查问题。
- 恢复模式下首页只保留最小可执行任务和 30 到 90 分钟目标。
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
- `packages/core/src/study-integrity.ts` 已补充结构化计时收口归一、近窗打卡历史汇总和轻量任务债务动作总结纯函数，用于后续 `CheckIn`、结构化收口字段和债务事件账本 migration 前的规则基线。
- 首页已展示打卡连续性原因、恢复模式建议和欠账预览。
- Dashboard API 已返回 `checkIn`、`recovery`、`debtTasks`、`visibleRecoveryTasks` 和低转化次数。
- 恢复模式已对首页任务入口做低风险裁剪：只把最小可执行任务传给计时器和任务面板，不删除原任务。
- 已新增任务轻量流转 API/UI：补做、拆小、改成复习任务；当前复用 `StudyTask` 现有字段和 `reviewText` 备注，不代表完整债务事件账本。
- 计时结束已接入反假学习规则，结果写入现有 `StudySession.isEffective` 和文本化 `note`。
- 后续仍需结构化反假问题、持久化 `CheckIn`、债务事件账本、恢复模式状态和必要 migration 方案。

## 验证

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/core typecheck`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm check`
- API 烟测：完成、延期、放弃、补做、拆小、改复习和计时收口路径可用。
- 页面烟测：首页正常、断签警报和恢复模式状态可读。

## 风险

- 若新增 `CheckIn`、债务事件或结构化收口字段，需要 migration，高风险确认后再执行。
- 恢复模式规则会影响首页任务优先级，必须避免让用户丢失原任务记录。
