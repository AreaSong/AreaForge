# 第二阶段长期闭环确认设计

## 状态

本文件是 Package D 的实现前确认设计，不代表第二阶段长期闭环已经完成。任何会写入阶段计划、应用任务重排、保存长期 AI 建议、自动应用模拟考试后的阶段调整或改变长期状态口径的实现，都必须等用户明确确认后再做。

## 目标

把当前每日执行闭环升级为长期备考调整闭环，让周/月报告、任务债务、作战地图、遗忘风险、模拟考试、状态主题和阶段调整共同服务下一阶段行动。

Package D 不是单独的数据库包或 AI 包。它负责组合 Package B 的结构化状态和 Package C 的真实 AI 能力，并确保所有长期建议都可解释、可确认、可回滚。

## 当前基础

- 周/月报告已有只读派生入口和 `decisionPreview` 下周期决策预览，不落库，不写审计，不默认调用 AI。
- 任务债务重排已有只读建议，`canAutoApply=false`，`requiresUserConfirmation=true`；D2 应用预览已有 `previewTaskDebtReorderApplication` 纯规则，但确认前不写库、不改任务。
- 作战地图已有分科摘要、状态分布、推荐筛选和优先节点。
- 恢复模式已有最小候选任务规则。
- 模拟考试已有结构化主路径；阶段计划和阶段调整草稿已有持久模型，但长期 AI、报告决策和任务重排应用仍未实现。

这些能力只能算基础版，不能替代结构化长期闭环。

## 依赖边界

- 依赖 Package B：`SimulationExam`、`TaskDebtEvent`、`RecoveryState`、掌握证明和复测记录已完成；`StagePlan`、`StageAdjustmentDraft` 已由 Batch 6 完成。
- 依赖 Package C：真实 provider 第一版已完成，可复用隐私最小化、费用保护、schema 校验和失败回退能力；长期 AI 阶段调整的字段清单、触发入口和费用边界仍需 `0017` / Package D 单独确认。
- Package B 未完成时，Package D 只能提供只读派生建议，不允许写入应用记录。
- 长期阶段 AI 未单独确认时，Package D 只能使用本地规则，不允许外呼生成长期阶段调整。

依赖-允许能力矩阵：

| 依赖状态 | 允许能力 | 禁止能力 |
|---|---|---|
| Package B Batch 2 未完成 | 基于现有任务字段给出只读债务重排建议 | 写入债务事件账本、确认/驳回/应用重排 |
| Package B Batch 4 已完成但 Package D 未确认 | 读取显式掌握证据和复测记录，并与任务、计时、笔记、错题更新时间一起派生遗忘风险 | 写入结构化复习历史、长期决策或应用记录 |
| Package B Batch 5 已完成但 Package D 未确认 | 读取和写入结构化 `SimulationExam` / `SimulationSubjectResult`，旧 `StudyTask.type = "simulation_exam"` 只读兼容 | 自动迁移旧任务型模拟、把模拟结果自动应用到阶段计划 |
| Package B Batch 6 已完成但 Package D 未确认 | 保存阶段计划和本地规则阶段草稿；用户可显式确认草稿更新关联 `StagePlan` 并写审计 | 自动任务重排、报告决策应用、批量改任务、长期 AI 外呼或保存应用记录 |
| 长期阶段 AI 未单独确认 | 使用本地规则，不外呼长期 AI | 发送长期数据、动机档案、复盘正文、附件内容或阶段调整上下文给 provider |
| Package B/C 均完成且 Package D 已确认 | 在用户明确确认后写入决策、应用记录和审计 | 自动应用、批量改任务、静默覆盖阶段计划 |

## 实施范围

- 周审判和月复盘升级为阶段决策入口。
- 完整全真模拟考试和 2026 年 12 月同步自测专题流程。
- 任务债务重排建议的确认、驳回和应用记录。
- 知识点遗忘风险和笔记复习提醒强化。
- 作战地图高级筛选、风险可视化和行动类型筛选。
- 状态主题、阶段称号、动机唤醒和长期压强调节联动。
- 长期阶段调整草稿，来源可以是本地规则或已确认的 AI provider。

## 禁止事项

- 不自动应用任务重排。
- 不自动覆盖阶段计划。
- 不自动删除、延期、放弃或批量修改任务。
- 不在长期阶段 AI 单独确认前发送长期数据给 AI。
- 不把动机档案、完整情绪正文、完整复盘正文、附件内容或文件路径放入长期 AI 上下文。
- 不把风险可视化做成无法追溯原因的压迫式结论。

## 写入规则

- 所有建议必须包含 `canAutoApply=false` 和 `requiresUserConfirmation=true`。
- 用户确认前只保存草稿或只读派生结果，不改任务、阶段计划、复盘或节点状态。
- 用户确认应用时必须写审计记录，记录变更摘要、来源、操作者、应用时间和涉及实体。
- 用户驳回时必须保留驳回状态或审计记录，不静默删除上下文。
- 部分应用失败时必须停止后续写入，返回失败摘要，并保留已完成写入的审计线索；不得继续自动补偿修改其他任务。

## Batch D1 确认后最小契约

Package D 的第一批只能把周/月报告从实时派生视图推进为“可确认、可驳回、可回放”的长期决策事实。D1 不应用报告策略，只记录用户对报告策略的态度和当时的报告快照。

确认后允许的最小落点：

- 新增 additive `PeriodicReportDecision` 持久模型，记录 `kind`、`rangeStart`、`rangeEnd`、`status`、`reportSnapshot`、`nextCycleDraft`、`canAutoApply=false`、`requiresUserConfirmation=true`、`actorId` 和 `decidedAt`；建议对 `kind + rangeStart + rangeEnd` 做唯一约束，避免重复确认。
- 保留 `GET /api/reports/periodic` 的实时报告读取；新增报告决策的鉴权写入口和只读回放入口，确认和驳回都只写报告决策，不修改任务、阶段计划、复盘或考纲节点。
- 报告确认生成下一周期草稿，但草稿仍是只读建议，必须继续携带 `canAutoApply=false` 和 `requiresUserConfirmation=true`。
- 每次确认或驳回写 `AuditEvent`，审计 metadata 至少包含报告类型、周期范围、决策状态、短板来源、策略主题和确认边界。
- `/reports` 页面可以展示确认、驳回、已处理状态、下一周期草稿和历史回放，但文案必须避免让“报告确认”看起来像“阶段计划应用”。

D1 仍必须禁止：

- 不新增债务重排应用写 API，不写任务重排应用记录，不修改 `StudyTask`。
- 不调用长期 AI，不创建 `StageAdjustmentDraft.source="ai"`，不保存完整 prompt 或响应。
- 不确认、应用或覆盖 `StagePlan`，不调用阶段草稿确认流，不批量修改任务。
- 不把 Package D 主状态标为完成；D1 完成后 `pnpm docs:completion` 仍应因 D2-D5 或 Package E 剩余证据而失败。

## Batch D2 确认后最小契约

D2 只能把现有 `GET /api/tasks/debt-reorder` 的只读建议推进为“用户可确认、可驳回、可按选择应用”的债务事实链。D2 不允许静默处理所有欠账，也不允许把建议等同于自动计划。

确认后允许的最小落点：

- 保持 `GET /api/tasks/debt-reorder` 只读；新增鉴权写入口记录用户对建议的确认或驳回，并在用户明确选择应用时只处理所选项。
- 复用 `TaskDebtEvent` 和 `AuditEvent`，为建议确认、建议驳回和应用结果写入可追溯 metadata；若需要新增 action 字符串，只能在服务层白名单中狭窄扩展，不新增破坏性 migration。
- 应用前重新读取任务当前状态并校验建议仍适用；状态已变化、任务不存在或权限不匹配时跳过该项并返回摘要。
- 小批量应用必须有上限；部分失败时停止后续写入或明确返回已跳过清单，不继续做自动补偿；应用预览应沿用 `previewTaskDebtReorderApplication` 的所选项、小批量上限和跳过摘要规则。
- `/reports`、首页任务区和任务债务 API 必须展示“需确认”和“只处理所选项”的边界文案。

D2 仍必须禁止：

- 不自动延期、删除、放弃或拆分全部欠账任务。
- 不覆盖用户当天计划，不批量改阶段计划，不触发长期 AI。
- 不把 D2 的应用记录作为 Package D 完成证据；D2 后仍需 D3-D5 和 Package E。

## Batch D3 确认后最小契约

D3 只能为长期阶段调整生成 `StageAdjustmentDraft.source="ai"` 草稿。草稿仍必须由用户显式确认后才能沿用 Batch 6 的阶段计划确认路径。

确认后允许的最小落点：

- 在 `packages/ai` 增加独立的长期阶段草稿 schema 和 provider 调用路径，不能复用短期鞭策 prompt 偷带长期正文。
- 长期 AI 最小字段清单只允许聚合数据：周期范围、有效时长、完成率、低转化次数、科目占比、薄弱节点摘要、模拟考试汇总、阶段计划模式和风险标签。
- 禁止发送动机档案、完整情绪记录、完整复盘正文、附件内容、附件路径、原始任务标题列表或完整 prompt/响应。
- Web 侧只有用户显式触发且 `AI_ENABLED=true`、配置完整、通过敏感字段扫描时才允许外呼；超时、429、5xx、schema invalid 和配置缺失必须回退本地规则。
- 成功结果只写 `StageAdjustmentDraft` 的结构化字段、`source="ai"`、确认边界和审计摘要；不保存完整 prompt、raw response、token 明细或费用账本。

D3 仍必须禁止：

- 不自动确认阶段草稿，不批量修改任务，不覆盖 active `StagePlan`。
- 不把长期 AI 接入首页 SSR、报告普通 GET 或后台定时任务。
- 不把生产真实 key 烟测当作必需前置；真实 key 只在受控环境用最小测试数据验证。

## Batch D4 确认后最小契约

D4 负责把长期风险证据串起来，让报告、遗忘风险、笔记复习提醒、作战地图、阶段计划和首页状态主题看到同一组可解释信号。D4 以页面/API 证据链为主，不新增生产部署，也不引入复杂 BI。

确认后允许的最小落点：

- 统一长期风险 DTO，标明每个风险的来源、时间窗口、关联科目或考纲节点、证据新鲜度和下一步动作；确认前已有 `summarizeLongTermRisks` 纯规则固化 DTO 口径，但不接 Prisma、不接 API、不写状态。
- 优先复用 `StudySession`、`CheckIn`、`MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`、`Note`、`MistakeReview`、`SimulationExam`、`StagePlan` 和 `StageAdjustmentDraft`；如果后续确需新增复习历史持久模型，必须另走 additive migration 确认。
- `/reports`、`/analytics`、`/syllabus`、`/notes`、`/simulation` 和首页状态主题必须展示一致的风险原因，不能各自生成互相矛盾的结论。
- 状态主题只能改变优先级、提示和视觉状态，不得隐藏完整任务列表，不得替代明确行动建议。
- 页面烟测必须覆盖正常、恢复、警报、冲刺和低风险稳态。

D4 仍必须禁止：

- 不新增多人排名、社交分享或复杂 BI。
- 不自动应用阶段计划，不静默修改任务。
- 不把风险文案做成不可追溯原因的压迫式结论。

## Batch D5 收口契约

D5 只做 Package D 完成证据收口。D5 不新增业务能力，不把 Package E 生产发布并入 Package D。

D5 必须完成：

- `docs/development/feature-traceability.md` 不再出现 Package D 负责的“基础版 / 待确认”第二阶段项；如有延期项，必须由源事实明确标记为暂缓。
- `docs/development/docs-100-completion-record.md` 的 Package D 行写入 D1-D4 的验证命令、API/页面烟测、文档同步和残余风险。
- `docs/development/validation-matrix.md`、`tasks/backlog/0016-second-stage-long-term-loop.md` 和 `workflow/versions/v0.4-second-stage-long-term-loop.md` 同步真实状态。
- `pnpm check`、`pnpm risk:preflight`、`pnpm docs:readiness` 通过；`pnpm docs:completion` 不再列 Package D 或长期阶段 AI blocker，但仍可因 Package E 未完成而失败。

## 确认前禁用项

- 任务债务重排的“应用”按钮或写 API。
- 阶段调整草稿的“应用到阶段计划”写路径。
- 周/月报告的确认、驳回或应用写 API。
- 长期 AI 阶段调整外呼。
- 结构化模拟考试后的阶段计划自动应用路径。
- 报告快照、报告决策、任务重排应用记录或阶段计划应用记录持久化。

## 验证

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：周期报告、统计、任务建议、考纲风险、模拟考试、阶段草稿。
- 页面烟测：首页、`/reports`、`/analytics`、`/syllabus`、`/simulation`。
- 确认前边界烟测：不存在重排应用写 API；长期 AI 外呼关闭；建议 DTO 均为 `canAutoApply=false` 和 `requiresUserConfirmation=true`。
- 确认前扫描：`apps/web/app/api` 下不得出现报告、债务、阶段或模拟考试的 `apply/confirm/reject` 写路由；`prisma/schema.prisma` 和 Web 服务不得出现 `ReportSnapshot`、`ReportDecision`、`TaskReorderApplication`、`StagePlanApplication` 或长期 AI 持久化模型。
- 确认后应用烟测：确认、驳回、部分失败和重复提交都有可追溯结果。
- Batch D1 验证：确认周报创建 1 条报告决策和 1 条审计；驳回月报创建 rejected 决策和审计；重复提交不重复创建；反向提交返回已处理或冲突结果；确认/驳回前后 `StudyTask`、`TaskDebtEvent`、`StagePlan` 和 `StageAdjustmentDraft` 不变；历史回放使用 `reportSnapshot`，不随实时报告重新派生而漂移。

## 回滚

- 未确认前：关闭或隐藏建议应用入口，保留只读报告和基础统计。
- 确认后若应用入口异常：先禁用应用 API，保留草稿和审计记录。
- 任务重排部分失败：不自动批量恢复，先展示失败摘要和已应用记录，再由用户确认是否执行单独修复。
- 阶段调整异常：回滚到上一 active `StagePlan` 或保留当前计划并撤销草稿状态；不得删除历史阶段记录。
- AI 长期建议异常：设置 `AI_ENABLED=false` 回到本地规则，不需要数据回滚。

## 完成判定

- 第二阶段增强项在 `docs/development/feature-traceability.md` 中均达到“已完成”或被源事实重新标记为暂缓。
- Package B/C 依赖项已经完成并有验证记录。
- 所有长期建议都有用户确认边界、审计记录、失败处理和回滚说明。
- `pnpm docs:completion` 不再因 Package D 或第二阶段增强项失败。
