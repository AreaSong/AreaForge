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
- `packages/core` 已新增 `summarizeAnalyticsRisks` 纯规则，可把低有效时长、低完成率、复盘缺口、薄弱节点、到期错题和到期笔记压缩成风险项与行动建议。
- `packages/core` 已新增 `rankRecoveryTaskCandidates` 和 `selectRecoveryTaskCandidate` 纯规则，可为恢复模式选择最小可执行候选任务。
- `packages/core` 已新增 `summarizeSyllabusMap` 纯规则，可生成作战地图覆盖率、验证率、风险等级、推荐筛选和优先处理节点。
- 现有只读报告服务已接入 `summarizePeriodicReportStrategy`；统计服务已接入 `summarizeAnalyticsRisks`；首页恢复候选已接入 `rankRecoveryTaskCandidates`；首页任务区和 `GET /api/tasks/debt-reorder` 已接入 `suggestTaskDebtReorder` 只读建议；`/syllabus` API、页面和组件已接入 `summarizeSyllabusMap` 分科摘要、地图状态分布、推荐筛选、行动类型筛选和优先节点展示。
- `pnpm risk:preflight` 已覆盖 Package D 确认前边界：债务重排 API 和阶段调整草稿 API 只能只读 `GET`，报告策略、本地复盘草稿和阶段调整草稿必须透传 `canAutoApply=false` / `requiresUserConfirmation=true`，报告页、模拟页和首页任务区必须展示确认边界。
- 考纲服务已使用已有任务、计时、笔记和错题更新时间派生证据新鲜度，用于作战地图遗忘风险和掌握证明证据过旧风险；结束计时会同步累加关联考纲节点 `actualMinutes`。
- `/notes` 已支持按科目、考纲节点、掌握状态和复习提醒状态筛选；今日任务表单已支持写入已有 `StudyTask.type` 字段。
- 该进展不代表第二阶段长期闭环完成；债务事件账本、用户确认后应用、报告决策入口、结构化复习历史和结构化长期风险仍待 Package B/D 确认后推进。
