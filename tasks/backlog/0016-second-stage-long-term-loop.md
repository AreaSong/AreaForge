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
- `packages/core` 已新增 `previewTaskDebtReorderApplication` 纯规则，为 D2 确认后的债务重排应用预览固化“只处理所选项、应用前校验、已解决/缺失建议跳过、小批量上限和跳过摘要”；该规则不写库、不修改任务、不代表 D2 已完成。
- `packages/core` 已新增 `summarizePeriodicReportStrategy` 纯规则，可生成周/月报告策略、必须压住的问题、下一步动作和冷静结论，并通过报告 API/UI 透传 `canAutoApply=false` 和 `requiresUserConfirmation=true`；本地复盘草稿也透传同一确认边界。
- `packages/core` 已新增 `choosePeriodicWeakness` 纯规则，可把薄弱节点、欠账集中科目、零有效投入科目和低转化学习压缩成周期报告最大短板，并返回来源、严重度和选择依据；Web 报告服务和 `/reports` 页面只读消费该规则。
- `packages/core` 已新增 `createPeriodicNextCycleDraft` 纯规则，可基于周/月报告策略和最大短板生成下一周期草稿，并固定 `source="local_rule"`、`canAutoApply=false`、`requiresUserConfirmation=true`；该规则尚未接入写 API，不代表报告决策入口已完成。
- `packages/core` 已新增 `createPeriodicReportDecisionSnapshot` 纯规则，可冻结周期范围、聚合指标、最大短板、策略和下一周期草稿，用于后续 D1 只读回放；该快照不包含任务标题列表、完整复盘正文、附件内容或阶段计划应用结果。
- 任务债务重排规则当前位于 `packages/core/src/study-integrity.ts`，不是独立 `packages/core/src/task-debt.ts`；这是审计路径说明，不代表功能缺失。
- `packages/core` 已新增 `summarizeAnalyticsRisks` 纯规则，可把低有效时长、低完成率、复盘缺口、薄弱节点、到期错题和到期笔记压缩成风险项与行动建议。
- `packages/core` 已新增 `summarizeLongTermRisks` 纯规则，可把周期报告、任务债务、作战地图、复习队列、模拟考试、阶段计划和首页状态主题压缩成统一长期风险 DTO，包含来源、时间窗口、科目/考纲节点、证据新鲜度、下一步动作，并固定 `canAutoApply=false`、`requiresUserConfirmation=true`；该规则不接 Prisma、不写库、不代表 D4 已完成。
- `packages/core` 已新增 `rankRecoveryTaskCandidates` 和 `selectRecoveryTaskCandidate` 纯规则，可为恢复模式选择最小可执行候选任务。
- `packages/core` 已新增 `summarizeSyllabusMap` 纯规则，可生成作战地图覆盖率、验证率、风险等级、推荐筛选和优先处理节点。
- 现有只读报告服务已接入 `summarizePeriodicReportStrategy`、`createPeriodicNextCycleDraft` 和 `createPeriodicReportDecisionSnapshot`，并在 `/reports` 只读展示下周期决策预览；统计服务已接入 `summarizeAnalyticsRisks`；首页恢复候选已接入 `rankRecoveryTaskCandidates`；首页任务区和 `GET /api/tasks/debt-reorder` 已接入 `suggestTaskDebtReorder` 只读建议；`/syllabus` API、页面和组件已接入 `summarizeSyllabusMap` 分科摘要、地图状态分布、推荐筛选、行动类型筛选和优先节点展示。
- `pnpm risk:preflight` 已覆盖 Package D 确认前边界：债务重排 API 和阶段调整草稿 API 只能只读 `GET`，报告策略、本地复盘草稿和阶段调整草稿必须透传 `canAutoApply=false` / `requiresUserConfirmation=true`，报告页、模拟页和首页任务区必须展示确认边界。
- 考纲服务已使用已有任务、计时、笔记和错题更新时间派生证据新鲜度，用于作战地图遗忘风险和掌握证明证据过旧风险；结束计时会同步累加关联考纲节点 `actualMinutes`。
- `/notes` 已支持按科目、考纲节点、掌握状态和复习提醒状态筛选；今日任务表单已支持写入已有 `StudyTask.type` 字段。
- 状态主题深度联动已完成：`createDashboardSnapshot` 五态规则已覆盖正常、锻造、警报、恢复和冲刺；恢复态计时器聚焦最小任务且任务区保留完整列表，冲刺态前置 `simulation_exam`、`mistake`、`review` 任务；首页展示状态主题面板、触发信号和行动焦点，并在恢复态弱化欠账预览。
- 结构化模拟考试主路径已由 Package B Batch 5 完成，旧任务型模拟只读兼容。
- 该进展不代表第二阶段长期闭环完成；Package B Batch 2 已提供债务事件账本、Batch 5 已提供结构化模拟考试，Batch 6 已提供阶段计划和阶段调整草稿，但用户确认后的长期应用、报告决策入口、结构化复习历史、结构化长期风险和阶段计划主题信号仍待 Package D 确认后推进。
- `pnpm package-d:preflight` 已作为确认前只读门禁，聚合检查 D1-D5 确认句、completion record 锁定状态、报告/债务/阶段只读 route、未确认持久化禁区、长期 AI 禁区和 core 纯规则前置；该命令不写库、不新增 API、不解锁 Package D。

## 确认后实施切入点

以下清单只用于获得 Package D 明确确认后的实现，不代表确认前可以新增应用写 API、阶段计划应用路径、长期 AI 外呼、报告快照写入、报告决策写入或任务/阶段应用持久化。

| 批次 | 确认后最小落点 | 主要验证 |
|---|---|---|
| Batch D1 报告决策入口 | `PeriodicReportDecision` additive 持久模型、周/月报告确认/驳回写入口、冻结 `reportSnapshot`、下一周期草稿、`AuditEvent`、只读历史回放；不改任务、阶段计划、复盘或考纲节点 | 确认周报、驳回月报、重复提交、反向提交、历史回放、确认前后 `StudyTask` / `TaskDebtEvent` / `StagePlan` / `StageAdjustmentDraft` 不变 |
| Batch D2 任务债务重排确认流 | 保持 `GET /api/tasks/debt-reorder` 只读；新增建议确认、驳回和用户选择后的单项/小批量应用记录；复用 `TaskDebtEvent` 与 `AuditEvent`；应用前重新校验任务当前状态；应用预览沿用 `previewTaskDebtReorderApplication` 的所选项、小批量上限和跳过摘要规则 | 确认、驳回、只处理所选项、部分失败停止或返回跳过摘要、重复提交幂等、不自动延期/删除全部欠账 |
| Batch D3 长期阶段 AI 草稿 | 增加长期阶段草稿 schema 和显式触发路径；只发送长期 AI 最小字段清单；成功只写 `StageAdjustmentDraft.source="ai"` 结构化草稿和审计摘要；失败回退本地规则 | `AI_ENABLED=false`、配置缺失、mock success、超时、429/5xx、schema invalid、敏感字段拦截、客户端密钥扫描、草稿不自动应用 |
| Batch D4 长期风险和主题闭环 | 统一长期风险 DTO，串联报告、遗忘风险、笔记复习提醒、作战地图、阶段计划和首页状态主题；优先复用现有结构化记录和 fallback；确认前纯规则沿用 `summarizeLongTermRisks` 的来源、窗口、证据新鲜度和确认边界 | `/reports`、`/analytics`、`/syllabus`、`/notes`、`/simulation`、首页状态主题的风险原因一致，正常/恢复/警报/冲刺/稳态页面烟测 |
| Batch D5 收口 | feature-traceability、completion record、validation matrix、task、workflow 同步真实状态；只收口 Package D，不并入 Package E | `pnpm check`、`pnpm package-d:preflight`、`pnpm risk:preflight`、`pnpm docs:readiness` 通过；`pnpm docs:completion` 不再列 Package D 或长期阶段 AI blocker |

补充边界：

- 报告决策入口：`/reports` 在周/月报告基础上提供“确认本周期策略”“驳回策略”“生成下一周期草稿”等动作，但用户确认前不改任务、阶段计划或复盘。
- 任务债务重排：在 `GET /api/tasks/debt-reorder` 只读建议之后，新增确认/驳回/应用写路径时必须依赖 Package B 的 `TaskDebtEvent` 和审计记录；重复提交、部分失败和应用摘要都要可追溯。
- 阶段调整：复用 Package B Batch 6 的 `StagePlan` 和 `StageAdjustmentDraft`；后续 Package D 若扩展应用流，只能修改用户确认的阶段计划，不批量改任务，不自动覆盖当前 active 计划。
- 模拟考试：已可依赖 Package B Batch 5 的 `SimulationExam` 和 `SimulationSubjectResult`；第二阶段页面优先读结构化考试，旧 `StudyTask.type = "simulation_exam"` 只读兼容。
- 遗忘风险：优先消费 Package B Batch 4 的掌握条件、证据和复测记录；没有显式记录时保留现有任务、计时、笔记、错题派生 fallback。
- 状态主题深度联动：主题只能由真实信号驱动，包括风险状态、恢复状态、阶段计划、模拟考试窗口、断签、低转化和长期压强；主题不得影响可读性，也不得替代明确行动建议。
- 长期 AI 阶段调整：Package C 第一版真实 provider 已完成，Batch 6 草稿模型可用；但长期阶段调整字段清单、费用边界和触发入口仍需 Package D / `0017` 单独确认，未确认时保持本地规则草稿。

## 确认后烟测重点

- 周/月报告确认、驳回、重复提交和只读 fallback 均有可追溯结果。
- 债务重排应用只更新用户确认范围内的任务，并写入事件和审计；部分失败时停止后续写入并返回摘要。
- 阶段调整应用保留前后阶段记录，`canAutoApply=false` 和 `requiresUserConfirmation=true` 不被移除。
- `/reports`、`/analytics`、`/syllabus`、`/simulation` 和首页在 Package B/C 缺失时仍能使用本地规则和派生 fallback。
- 长期 AI 关闭时不外呼 provider；长期阶段 AI 未确认时阶段调整只显示本地规则草稿。
- 重复提交同一确认动作必须返回已处理状态或幂等摘要，不能重复批量改任务。
- 确认、驳回、部分失败、依赖缺失 fallback 和长期 AI 关闭都需要独立 API 与页面烟测记录。
