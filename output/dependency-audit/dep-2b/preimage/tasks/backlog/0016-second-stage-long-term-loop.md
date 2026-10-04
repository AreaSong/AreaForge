# 0016 第二阶段长期闭环

状态：Package D 已完成。Batch D1 报告决策入口、Batch D2 任务债务重排确认流、Batch D3 长期阶段 AI 草稿、Batch D4 长期风险/主题闭环补强和 Batch D5 收口均已完成。该任务承接 `docs/product/feature-scope.md` 的第二阶段增强，不替代 Package E 生产发布。

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
- `packages/core` 已新增 `previewTaskDebtReorderApplication` 纯规则，为 D2 债务重排应用预览固化“只处理所选项、应用前校验、已解决/缺失建议跳过、小批量上限和跳过摘要”；该规则本身不写库、不修改任务。
- `packages/core` 已新增 `summarizePeriodicReportStrategy` 纯规则，可生成周/月报告策略、必须压住的问题、下一步动作和冷静结论，并通过报告 API/UI 透传 `canAutoApply=false` 和 `requiresUserConfirmation=true`；本地复盘草稿也透传同一确认边界。
- `packages/core` 已新增 `choosePeriodicWeakness` 纯规则，可把薄弱节点、欠账集中科目、零有效投入科目和低转化学习压缩成周期报告最大短板，并返回来源、严重度和选择依据；Web 报告服务和 `/reports` 页面只读消费该规则。
- `packages/core` 已新增 `createPeriodicNextCycleDraft` 纯规则，可基于周/月报告策略和最大短板生成下一周期草稿，并固定 `source="local_rule"`、`canAutoApply=false`、`requiresUserConfirmation=true`；Package D Batch D1 后，确认报告时会把该草稿保存为只读决策草稿。
- `packages/core` 已新增 `createPeriodicReportDecisionSnapshot` 纯规则，可冻结周期范围、聚合指标、最大短板、策略和下一周期草稿；Package D Batch D1 后，报告确认/驳回会把该快照写入 `PeriodicReportDecision` 用于只读回放。该快照不包含任务标题列表、完整复盘正文、附件内容或阶段计划应用结果。
- 任务债务重排规则当前位于 `packages/core/src/study-integrity.ts`，不是独立 `packages/core/src/task-debt.ts`；这是审计路径说明，不代表功能缺失。
- `packages/core` 已新增 `summarizeAnalyticsRisks` 纯规则，可把低有效时长、低完成率、复盘缺口、薄弱节点、到期错题和到期笔记压缩成风险项与行动建议。
- `packages/core` 已新增 `summarizeLongTermRisks` 纯规则，可把周期报告、任务债务、作战地图、复习队列、模拟考试、阶段计划和首页状态主题压缩成统一长期风险 DTO，包含来源、时间窗口、科目/考纲节点、证据新鲜度、下一步动作，并固定 `canAutoApply=false`、`requiresUserConfirmation=true`；Package D Batch D4 后，Web 已新增只读 `long-term-risk-service` 和鉴权 GET-only `/api/analytics/long-term-risks`，并把同一 DTO 接入 `/reports`、`/analytics`、`/syllabus`、`/notes`、`/simulation` 和首页状态主题。
- `packages/core` 已新增 `rankRecoveryTaskCandidates` 和 `selectRecoveryTaskCandidate` 纯规则，可为恢复模式选择最小可执行候选任务。
- `packages/core` 已新增 `summarizeSyllabusMap` 纯规则，可生成作战地图覆盖率、验证率、风险等级、推荐筛选和优先处理节点。
- 报告服务已接入 `summarizePeriodicReportStrategy`、`createPeriodicNextCycleDraft` 和 `createPeriodicReportDecisionSnapshot`，并在 `/reports` 展示下周期决策预览；Package D Batch D1 后已新增 `PeriodicReportDecision` additive 模型、`POST /api/reports/periodic/decisions` 确认/驳回入口、`GET /api/reports/periodic/decisions` 只读列表、冻结快照、确认草稿和审计写入。统计服务已接入 `summarizeAnalyticsRisks`；首页恢复候选已接入 `rankRecoveryTaskCandidates`；首页任务区和 `GET /api/tasks/debt-reorder` 已接入 `suggestTaskDebtReorder` 只读建议；Package D Batch D2 后已新增 `POST /api/tasks/debt-reorder/decisions`、`POST /api/tasks/debt-reorder/applications` 和首页所选项确认/驳回/应用 UI，确认/驳回写 `reorder_suggested`，应用写 `reorder_applied`，均复用审计记录；`/syllabus` API、页面和组件已接入 `summarizeSyllabusMap` 分科摘要、地图状态分布、推荐筛选、行动类型筛选和优先节点展示。
- `pnpm risk:preflight` 已覆盖 Package D 确认前边界：D2 完成前债务重排 API 只能只读 `GET`，D2 完成后仅放行 `decisions` / `applications` 两个所选项写入口；阶段调整草稿 API 仍按确认状态限制；报告策略、本地复盘草稿和阶段调整草稿必须透传 `canAutoApply=false` / `requiresUserConfirmation=true`，报告页、模拟页和首页任务区必须展示确认边界。
- 考纲服务已使用已有任务、计时、笔记和错题更新时间派生证据新鲜度，用于作战地图遗忘风险和掌握证明证据过旧风险；结束计时会同步累加关联考纲节点 `actualMinutes`。
- `/notes` 已支持按科目、考纲节点、掌握状态和复习提醒状态筛选；今日任务表单已支持写入已有 `StudyTask.type` 字段。
- 状态主题深度联动已完成：`createDashboardSnapshot` 五态规则已覆盖正常、锻造、警报、恢复和冲刺；恢复态计时器聚焦最小任务且任务区保留完整列表，冲刺态前置 `simulation_exam`、`mistake`、`review` 任务；首页展示状态主题面板、触发信号和行动焦点，并在恢复态弱化欠账预览。
- 结构化模拟考试主路径已由 Package B Batch 5 完成，旧任务型模拟只读兼容。
- Package D 长期闭环已完成：Package B Batch 2 已提供债务事件账本、Batch 5 已提供结构化模拟考试，Batch 6 已提供阶段计划和阶段调整草稿，Package D Batch D1 已提供报告决策入口，Batch D2 已提供债务重排确认/驳回/所选项应用，Batch D3 已提供长期阶段 AI 草稿显式触发，Batch D4 已提供长期风险只读 DTO/API 和主题闭环展示，Batch D5 已完成证据收口。
- `pnpm package-d:preflight` 已作为 Package D 批次感知门禁，聚合检查 D1-D5 确认句、completion record 锁定状态、报告/债务/阶段 route、未确认持久化禁区、长期 AI 草稿边界、D4 长期风险只读接入、D5 Package D 主状态和 core 纯规则前置；该命令本身不写库、不新增应用写 API、不夹带 Package E 生产部署。D1 只有在完整证据存在时才狭窄放行报告决策入口，D2 只有在完整证据存在时才狭窄放行债务重排所选项写入口，D3 只有在完整证据存在时才狭窄放行长期 AI 草稿显式入口，D4 只有在完整证据存在时才狭窄放行长期风险 GET-only API 和页面同源展示。
- D3 完成前，长期阶段 AI 未确认时保持本地规则草稿；D3 完成后，长期 AI 禁区收窄为：D3 显式入口之外的普通页面、报告 GET、SSR、后台任务、自动阶段应用、调用历史和费用账本仍禁止。

## 确认后实施切入点

以下清单用于 Package D 分批实现。D1-D5 已完成；D5 不新增 API，也没有新增应用写 API、阶段计划应用路径、D3 范围外长期 AI 外呼或任务/阶段应用持久化。

| 批次 | 确认后最小落点 | 主要验证 |
|---|---|---|
| Batch D1 报告决策入口 | 已完成：`PeriodicReportDecision` additive 持久模型、周/月报告确认/驳回写入口、冻结 `reportSnapshot`、下一周期草稿、`AuditEvent`、只读历史回放；不改任务、阶段计划、复盘或考纲节点 | 已覆盖确认周报、驳回月报、重复提交、反向提交、历史回放、确认前后 `StudyTask` / `TaskDebtEvent` / `StagePlan` / `StageAdjustmentDraft` 不变 |
| Batch D2 任务债务重排确认流 | 已完成：保持 `GET /api/tasks/debt-reorder` 只读；新增建议确认、驳回和用户选择后的单项/小批量应用记录；复用 `TaskDebtEvent` 与 `AuditEvent`；应用前重新校验任务当前状态；应用预览沿用 `previewTaskDebtReorderApplication` 的所选项、小批量上限和跳过摘要规则 | 已覆盖确认、驳回、只处理所选项、部分失败停止并返回跳过摘要、不自动延期/删除全部欠账 |
| Batch D3 长期阶段 AI 草稿 | 已完成：增加长期阶段草稿 schema 和显式触发路径；只发送长期 AI 最小字段清单和阶段目标摘要；成功只写 `StageAdjustmentDraft.source="ai"` 结构化草稿和审计摘要；失败回退本地规则 | 已覆盖未登录 401、`AI_ENABLED=false`、mock success、schema invalid fallback、禁止完整正文/标题/prompt/response、`StudyTask` / `TaskDebtEvent` / `StagePlan` 不变、草稿不自动应用 |
| Batch D4 长期风险和主题闭环 | 已完成：统一长期风险 DTO，串联报告、遗忘风险、笔记复习提醒、作战地图、阶段计划和首页状态主题；新增只读 service、鉴权 GET-only API 和同源页面面板；复用现有结构化记录和 fallback | 已覆盖 service/route smoke、未登录 401、登录态 200、业务表不变、`/reports`、`/analytics`、`/syllabus`、`/notes`、`/simulation` 和首页状态主题同源展示 |
| Batch D5 收口 | 已完成：feature-traceability、completion record、validation matrix、task、workflow 同步真实状态；只收口 Package D，不并入 Package E | `pnpm check`、`pnpm package-d:preflight`、`pnpm risk:preflight`、`pnpm docs:readiness` 通过；`pnpm docs:completion` 不再列 Package D 或长期阶段 AI blocker |

补充边界：

- 报告决策入口：`/reports` 在周/月报告基础上提供“确认本周期策略”、 “驳回策略”和已处理回放；确认时只保存下一周期草稿，不改任务、阶段计划或复盘。
- 任务债务重排：在 `GET /api/tasks/debt-reorder` 只读建议之后，新增确认/驳回/应用写路径时必须依赖 Package B 的 `TaskDebtEvent` 和审计记录；重复提交、部分失败和应用摘要都要可追溯。
- 阶段调整：复用 Package B Batch 6 的 `StagePlan` 和 `StageAdjustmentDraft`；当前 Package D 已完成显式草稿与确认边界。未来若扩展更深应用流，只能修改用户确认的阶段计划，不批量改任务，不自动覆盖当前 active 计划。
- 模拟考试：已可依赖 Package B Batch 5 的 `SimulationExam` 和 `SimulationSubjectResult`；第二阶段页面优先读结构化考试，旧 `StudyTask.type = "simulation_exam"` 只读兼容。
- 遗忘风险：优先消费 Package B Batch 4 的掌握条件、证据和复测记录；没有显式记录时保留现有任务、计时、笔记、错题派生 fallback。
- 状态主题深度联动：主题只能由真实信号驱动，包括风险状态、恢复状态、阶段计划、模拟考试窗口、断签、低转化和长期压强；主题不得影响可读性，也不得替代明确行动建议。
- 长期 AI 阶段调整：Package C 第一版真实 provider 已完成，Batch 6 草稿模型可用；Package D Batch D3 已确认并完成最小字段清单、显式触发入口、schema 校验和失败回退。长期应用流、历史保存、费用账本或更完整阶段应用仍需后续单独确认。

## 确认后烟测重点

- 周/月报告确认、驳回、重复提交和只读 fallback 均有可追溯结果。
- 债务重排应用只更新用户确认范围内的任务，并写入事件和审计；部分失败时停止后续写入并返回摘要。
- 阶段调整应用保留前后阶段记录，`canAutoApply=false` 和 `requiresUserConfirmation=true` 不被移除。
- `/reports`、`/analytics`、`/syllabus`、`/simulation` 和首页在 Package B/C 缺失时仍能使用本地规则和派生 fallback。
- 长期 AI 关闭时不外呼 provider；D3 显式入口以外的页面打开、报告 GET、SSR 或后台任务不外呼长期 AI。
- 重复提交同一确认动作必须返回已处理状态或幂等摘要，不能重复批量改任务。
- 确认、驳回、部分失败、依赖缺失 fallback 和长期 AI 关闭都需要独立 API 与页面烟测记录。
