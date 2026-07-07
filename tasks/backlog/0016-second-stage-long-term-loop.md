# 0016 第二阶段长期闭环

状态：待排期。该任务承接 `docs/product/feature-scope.md` 的第二阶段增强，不替代已有 `0013` 和 `0014`。

## 目标

把 AreaForge 从每日执行闭环推进到长期备考调整闭环，让报告、作战地图、任务债务、遗忘风险和状态主题共同指向下一阶段行动。

## 范围

- 周审判和月复盘升级为阶段决策入口。
- 任务债务重排建议，但不自动应用。
- 知识点遗忘风险提醒。
- 笔记复习提醒强化。
- 作战地图高级筛选和风险可视化。
- 状态主题、阶段称号、动机唤醒和长期压强调节深度联动。
- 与完整模拟考试和阶段调整草稿对齐。

## 不包含

- AI 自动覆盖阶段计划。
- 批量自动延期、放弃或删除任务。
- 公开排名、多人对比或社交分享。
- 复杂 BI 大屏。

## 参考源事实

- `docs/product/feature-scope.md`
- `docs/modules/periodic-reports.md`
- `docs/modules/task-debt.md`
- `docs/modules/syllabus-map.md`
- `docs/modules/analytics.md`
- `docs/modules/notes.md`
- `docs/modules/stage-levels.md`
- `docs/ux/dynamic-theme.md`

## 验收标准

- 周/月报告能输出下周期策略和待确认动作。
- 任务债务重排建议能说明保留、延期、拆分、放弃或改复习的原因。
- 遗忘风险能追溯到复习时间、错题集中、掌握等级或复测状态。
- 笔记复习提醒可按科目、节点、掌握状态或到期时间筛选。
- 作战地图能按风险和行动类型筛选，不只是状态网格。
- 动态主题不会影响可读性，也不会用装饰替代行动建议。
- 所有建议都必须用户确认后才能应用。
- `pnpm check` 和主要页面烟测通过。

## 验证

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- 页面烟测：`/reports`、`/analytics`、`/syllabus`、首页状态。
- API 烟测：周期报告、统计、任务建议、考纲风险。

## 风险

- 自动建议被误认为自动计划。
- 风险可视化过强导致页面压迫感过高。
- 遗忘风险口径若不透明，会削弱用户信任。

## 当前低风险进展

- `packages/core` 已新增 `suggestTaskDebtReorder` 纯规则，可生成任务债务重排建议，并保持 `canAutoApply=false`、`requiresUserConfirmation=true`；首页任务区已直接展示这两个边界。
- `packages/core` 已新增 `summarizePeriodicReportStrategy` 纯规则，可生成周/月报告策略、必须压住的问题、下一步动作和冷静结论，并通过报告 API/UI 透传 `canAutoApply=false` 和 `requiresUserConfirmation=true`；本地复盘草稿也透传同一确认边界。
- `packages/core` 已新增 `choosePeriodicWeakness` 纯规则，可把薄弱节点、欠账集中科目、零有效投入科目和低转化学习压缩成周期报告最大短板，并返回来源、严重度和选择依据；Web 报告服务和 `/reports` 页面只读消费该规则。
- 任务债务重排规则当前位于 `packages/core/src/study-integrity.ts`，不是独立 `packages/core/src/task-debt.ts`；这是审计路径说明，不代表功能缺失。
- `packages/core` 已新增 `summarizeAnalyticsRisks` 纯规则，可把低有效时长、低完成率、复盘缺口、薄弱节点、到期错题和到期笔记压缩成风险项与行动建议。
- `packages/core` 已新增 `rankRecoveryTaskCandidates` 和 `selectRecoveryTaskCandidate` 纯规则，可为恢复模式选择最小可执行候选任务。
- `packages/core` 已新增 `summarizeSyllabusMap` 纯规则，可生成作战地图覆盖率、验证率、风险等级、推荐筛选和优先处理节点。
- 现有只读报告服务已接入 `summarizePeriodicReportStrategy`；统计服务已接入 `summarizeAnalyticsRisks`；首页恢复候选已接入 `rankRecoveryTaskCandidates`；首页任务区和 `GET /api/tasks/debt-reorder` 已接入 `suggestTaskDebtReorder` 只读建议；`/syllabus` API、页面和组件已接入 `summarizeSyllabusMap` 分科摘要、地图状态分布、推荐筛选、行动类型筛选和优先节点展示。
- `pnpm risk:preflight` 已覆盖 Package D 确认前边界：债务重排 API 和阶段调整草稿 API 只能只读 `GET`，报告策略、本地复盘草稿和阶段调整草稿必须透传 `canAutoApply=false` / `requiresUserConfirmation=true`，报告页、模拟页和首页任务区必须展示确认边界。
- 考纲服务已使用已有任务、计时、笔记和错题更新时间派生证据新鲜度，用于作战地图遗忘风险和掌握证明证据过旧风险；结束计时会同步累加关联考纲节点 `actualMinutes`。
- `/notes` 已支持按科目、考纲节点、掌握状态和复习提醒状态筛选；今日任务表单已支持写入已有 `StudyTask.type` 字段。
- 状态主题深度联动已完成：`createDashboardSnapshot` 五态规则已覆盖正常、锻造、警报、恢复和冲刺；恢复态计时器聚焦最小任务且任务区保留完整列表，冲刺态前置 `simulation_exam`、`mistake`、`review` 任务；首页展示状态主题面板、触发信号和行动焦点，并在恢复态弱化欠账预览。
- 结构化模拟考试主路径已由 Package B Batch 5 完成，旧任务型模拟只读兼容。
- 该进展不代表第二阶段长期闭环完成；Package B Batch 2 已提供债务事件账本、Batch 5 已提供结构化模拟考试，但用户确认后应用、报告决策入口、结构化复习历史、结构化长期风险和阶段计划主题信号仍待 Package B Batch 6 / Package D 确认后推进。

## 确认后实施切入点

以下清单只用于获得 Package D 明确确认后的实现，不代表确认前可以新增应用写 API、阶段计划应用路径、长期 AI 外呼、报告快照写入、报告决策写入或任务/阶段应用持久化。

- 报告决策入口：`/reports` 在周/月报告基础上提供“确认本周期策略”“驳回策略”“生成下一周期草稿”等动作，但用户确认前不改任务、阶段计划或复盘。
- 任务债务重排：在 `GET /api/tasks/debt-reorder` 只读建议之后，新增确认/驳回/应用写路径时必须依赖 Package B 的 `TaskDebtEvent` 和审计记录；重复提交、部分失败和应用摘要都要可追溯。
- 阶段调整：依赖 Package B Batch 6 的 `StagePlan` 和 `StageAdjustmentDraft`；应用草稿时只修改用户确认的阶段计划，不批量改任务，不自动覆盖当前 active 计划。
- 模拟考试：已可依赖 Package B Batch 5 的 `SimulationExam` 和 `SimulationSubjectResult`；第二阶段页面优先读结构化考试，旧 `StudyTask.type = "simulation_exam"` 只读兼容。
- 遗忘风险：优先消费 Package B Batch 4 的掌握条件、证据和复测记录；没有显式记录时保留现有任务、计时、笔记、错题派生 fallback。
- 状态主题深度联动：主题只能由真实信号驱动，包括风险状态、恢复状态、阶段计划、模拟考试窗口、断签、低转化和长期压强；主题不得影响可读性，也不得替代明确行动建议。
- 长期 AI 阶段调整：只有 Package C 已确认真实 provider 且 Package B Batch 6 已具备草稿模型后才能外呼；未确认时保持本地规则草稿。

## 确认后烟测重点

- 周/月报告确认、驳回、重复提交和只读 fallback 均有可追溯结果。
- 债务重排应用只更新用户确认范围内的任务，并写入事件和审计；部分失败时停止后续写入并返回摘要。
- 阶段调整应用保留前后阶段记录，`canAutoApply=false` 和 `requiresUserConfirmation=true` 不被移除。
- `/reports`、`/analytics`、`/syllabus`、`/simulation` 和首页在 Package B/C 缺失时仍能使用本地规则和派生 fallback。
- 长期 AI 关闭时不外呼 provider；Package C 未完成时阶段调整只显示本地规则草稿。
- 重复提交同一确认动作必须返回已处理状态或幂等摘要，不能重复批量改任务。
- 确认、驳回、部分失败、依赖缺失 fallback 和长期 AI 关闭都需要独立 API 与页面烟测记录。
