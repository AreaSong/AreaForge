# 0013 全真模拟考试与阶段调整

状态：部分完成，待 Package D。结构化模拟考试、阶段计划和本地规则阶段调整草稿已由 Package B Batch 5/6 完成；长期 AI 阶段调整、报告决策和任务重排应用仍待 Package D/0017 确认。

## 目标

支持 2026 年 12 月同步全真自测和后续模拟考试，并把结果作为 2027 长期计划调整依据。

## 范围

- 创建模拟考试。
- 记录科目、考试日期、目标分、实际分、用时、空题数量、失分原因、心态记录和考后总结。
- 考后复盘报告。
- 第一次全真自测后的阶段日记。
- AI 阶段调整建议只产出草稿，用户确认后才应用。

## 不包含

- 自动生成完整长期学习计划。
- AI 自动覆盖阶段计划。
- 多人排名或公开对比。

## 参考源事实

- `docs/modules/simulation-exam.md`
- `docs/modules/ai-stage-adjustment.md`
- `docs/product/roadmap.md`
- `docs/architecture/ai-boundary.md`

## 验收标准

- 可以创建和查看模拟考试记录。
- 可以记录分数、心态、失分原因和总结。
- 2026 年 12 月同步自测能被标记为阶段节点。
- AI 阶段建议必须结构化校验且只作为草稿。
- `pnpm check` 通过。

## 当前进展

- Package B Batch 5 已完成结构化模拟考试主路径：新建考试写入 `SimulationExam`，保存结果写入考试汇总和 `SimulationSubjectResult`，旧 `StudyTask.type = "simulation_exam"` 记录只读兼容。
- 已新增本地规则阶段草稿入口：根据近 7 天统计、薄弱节点、到期错题和第一次全真日记状态生成准备度和下一步动作，不调用外部 AI。
- `packages/core/src/simulation-result.ts` 已提供模拟考试结果纯规则：按目标分、实际分、用时、空题、失分原因、心态和是否第一次同步自测，生成分差、表现等级、时间压力、主要短板、下一步动作、是否需要重校准计划和考后必填字段。
- `packages/core/src/stage-adjustment.ts` 已提供阶段调整纯规则：根据阶段目标、任务完成率、科目投入均衡、错题复盘率、复盘完成率、连续性、断签、低转化、薄弱科目、模拟分数和终局倒计时，生成恢复/强化/冲刺/维持模式、风险结论、重点科目、任务强度和待确认动作；规则明确 `canAutoApply=false` 和 `requiresUserConfirmation=true`。
- 模拟考试保存结果时已接入模拟结果复盘纯规则，并把分差、达成率、时间压力、主要短板、下一步动作、是否需要重校准计划和考后必填项写入结构化 `SimulationExam.reviewText`。
- `/simulation` 阶段调整草稿已接入 `draftStageAdjustment`，展示风险等级、任务强度、重点科目、待确认动作和“只生成建议，不自动应用”边界。
- 已新增第一次全真自测阶段日记保存入口：写入 `MotivationVault.firstSimulationDiary`。
- 结构化模拟考试模型/API/UI 主路径已完成；阶段计划和阶段调整草稿持久化已由 Package B Batch 6 完成；真实 AI 长期阶段调整、报告决策和任务重排应用仍未完成。

## 待高风险确认后推进

- 将结构化模拟结果接入后续报告决策、任务重排应用和长期阶段调整闭环。
- 接入 AI 长期阶段调整建议，并确认数据最小化、结构化校验、失败回退和用户确认后应用边界。
- 长期 AI 阶段调整的隐私、费用、限流和可发送字段清单见 `tasks/backlog/0017-ai-stage-privacy-cost.md`，不能混入普通 AI 鞭策任务中默认实现。

## 高风险包映射

- Package B：`SimulationExam`、`SimulationSubjectResult` 已由 Batch 5 完成；`StagePlan` 和 `StageAdjustmentDraft` 已由 Batch 6 完成。
- Package C：真实 AI provider 和长期阶段调整外呼的隐私、费用、限流、脱敏和 fallback。
- Package D：2026 同步自测、结构化模拟考试、阶段日记、阶段调整草稿和第二阶段长期闭环的组合验收。

## 验证

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/core typecheck`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm check`
- API 烟测：创建模拟考试、保存结果、生成复盘。
- 页面烟测：模拟考试列表、详情、阶段计划和阶段调整草稿。

## 风险

- 阶段计划模型已存在，但自动任务重排、批量改任务、报告决策应用和真实 AI 长期外呼仍需 Package D / `0017` 确认。
- AI 阶段建议涉及长期数据，必须确认隐私和应用边界。
