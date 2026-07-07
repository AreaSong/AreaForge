# 功能追踪矩阵

## 目标

本文件用于把 `docs/product/feature-scope.md` 的完整范围追踪到当前代码状态、版本计划和执行任务，避免把低风险基础版误判为 docs 100% 完成。

状态说明：

- 已完成：已有真实代码、API/UI 或验证记录支撑。
- 基础版：已有低风险入口或派生规则，但还不能替代完整结构化能力。
- 待确认：命中 migration、上传、AI、部署等高风险边界，执行前必须先确认影响、风险、验证和回滚。
- 暂缓：产品文档明确不进入当前版本。

组合状态只用于表达同一功能同时具备低风险入口和高风险缺口，例如“基础版 / 待确认”。不能使用“已完成基础版”这类混合状态；若仍需要第二阶段深度联动，应标为“基础版”。

## 第一版必须项

| 功能项 | 当前状态 | 当前证据 | 后续承接 |
|---|---|---|---|
| 单管理员登录 | 已完成 | `tasks/done/0002-mvp-auth-and-seed.md`；`/api/auth/*` | 仅认证策略变化时重新确认 |
| 今日作战台 | 已完成 | `GET /api/dashboard/today`、`apps/web/app/page.tsx` | `workflow/versions/v0.3-structured-learning-state.md` |
| 双节点倒计时 | 已完成 | 首页和阶段规则使用 2026/2027 节点 | 后续与冲刺模式联动 |
| 每日任务 | 已完成 | `tasks/done/0003-mvp-task-timer-review.md`；`/api/tasks`；今日任务表单支持写入已有 `StudyTask.type` | `tasks/backlog/0015-structured-state-migration.md` |
| 任务债务基础版 | 已完成 | `StudyTask.status/debtStatus`、任务面板、complete/defer/drop/recover/split/convert-review API；Package B Batch 2 已新增 `TaskDebtEvent` 事件账本和 `StudyTask.parentTaskId`，债务动作继续写 `AuditEvent` 并同步写事件账本 | 重排确认、驳回和应用仍由 Package D 承接 |
| 学习计时 | 已完成 | `tasks/done/0003-mvp-task-timer-review.md`；`/api/study-sessions/*`；Package B Batch 0 已追加 `StudySession` 结构化收口字段；Batch 1 已让结束计时刷新 `CheckIn` 日快照；Batch 2 已让有效自动完成任务写入债务事件账本 | 长期阶段联动继续由 Package D 承接 |
| 专注计时模式 | 已完成 | 首页 `FocusTimer` 与 active session 恢复 | 后续 UX 打磨 |
| 打卡 | 已完成 | `evaluateDailyCheckIn`、`CheckIn` 日快照、首页 `dashboard.checkIn`、analytics/reports 逐日快照优先和缺失日期 fallback；不把打开应用算作打卡，active session 时长只实时展示、结束后固化 | 更长期连续性和阶段联动仍由 Package D 承接 |
| 每晚复盘 | 已完成 | `DailyReview`、`/api/reviews/today` | AI 真实建议和结构化统计继续增强 |
| 考纲进度树 | 已完成 | `/syllabus`、`/api/syllabus/*`、Markdown 导入 | 附件和自动状态更新后增强 |
| 知识点掌握状态 | 已完成 | `SyllabusNode.status`、`masteryLevel`、`/syllabus` 状态筛选、节点卡片和最近证据时间；Batch 4 已新增 `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`，显式证据优先并保留 `_count` fallback | 结构化复习历史和长期计划联动仍由 Package D 增强 |
| 知识点掌握证明基础版 | 已完成 | `packages/core/src/mastery-proof.ts`；`/syllabus` 节点可选择目标掌握等级、勾选并保存掌握条件；`PATCH /api/syllabus/nodes/:id` 用显式证据或 `_count` fallback 校验，失败返回 `MASTERY_PROOF_REQUIRED`，成功写入 `SyllabusNode.status/masteryLevel` 和 `AuditEvent`；`POST /api/syllabus/nodes/:id/mastery-evidence` 写入证据引用；`POST /api/syllabus/nodes/:id/mastery-retests` 写入复测记录，`failed/partial` 不自动降级；Package B Batch 4 已完成 | 更复杂证据图谱和复习历史分析后续增强 |
| 笔记与资料上传 | 已完成 | 笔记 API/UI 已有；按科目、节点、掌握状态和复习提醒筛选已有；Package A 已完成 noteId 绑定 PDF/PNG/JPEG/WebP 上传、`UPLOAD_DIR` 私有落盘、metadata/hash/URI 写入、鉴权下载、`/notes` 附件 UI 和补偿/对账烟测 | `tasks/done/0004-mvp-syllabus-notes-upload.md` |
| 情绪与状态记录基础版 | 已完成 | `tasks/done/0010-motivation-emotion-stage.md` | 完整情绪历史表暂不做 |
| 恢复模式基础版 | 已完成 | `createRecoveryPlan`、`rankRecoveryTaskCandidates`、首页 `visibleRecoveryTasks` 和恢复原因；Package B Batch 3 已新增 `RecoveryState`、`POST /api/recovery-states/manual`、完成/取消恢复 API、dashboard active 状态优先和规则触发幂等记录；首页计时器聚焦恢复候选，任务面板保留完整任务列表 | 长期阶段计划主题信号仍随 Package D 增强 |
| 反假学习检查基础版 | 已完成 | 计时结束写 `isEffective`、`isLowConversion`、反假学习原因、补产出要求、最小产出、下一步动作和文本 note；Batch 0 已结构化收口字段；Batch 1 已把低转化次数写入 `CheckIn` 日快照；Batch 2 已把有效自动完成任务写入债务事件账本 | 历史 note 不解析；长期闭环继续由 Package D 承接 |
| 考研作战地图概览版 | 已完成 | `tasks/done/0011-analytics-map.md`、`packages/core/src/syllabus-map.ts` | 高级可视化见 `0016` |
| 动机封存 | 已完成 | `tasks/done/0010-motivation-emotion-stage.md` | AI 默认仍不读取动机档案 |
| 阶段称号基础版 | 已完成 | `packages/core` 阶段规则、首页展示 | 与模拟成绩联动待第二阶段 |
| 鞭策文案 | 基础版 / 待确认 | 本地规则 fallback、首页草稿展示 | 真实 AI provider 待确认 |
| AI 复盘建议 | 基础版 / 待确认 | `/api/ai/daily-review` 当前返回本地规则 | `tasks/backlog/0005-mvp-ai-discipline.md` |
| AI 明日任务建议 | 基础版 / 待确认 | `/api/ai/tomorrow-plan` 当前返回本地规则 | `tasks/backlog/0005-mvp-ai-discipline.md` |
| 基础统计 | 已完成 | `tasks/done/0011-analytics-map.md`、`/analytics` | 结构化快照和长期趋势待后续 |
| 数据持久化 | 已完成 | PostgreSQL + Prisma + migration | 生产备份恢复见 `0014` |

## 第二阶段增强

| 功能项 | 当前状态 | 当前证据 | 后续承接 |
|---|---|---|---|
| 全真模拟考试模式完整实现 | 已完成 | Package B Batch 5 已新增 `SimulationExam`、`SimulationSubjectResult`、`/api/simulation/exams`、`/api/simulation/exams/:id/results` 和 `/simulation` 结构化主写入路径；旧 `StudyTask.type = "simulation_exam"` 只读兼容；Batch 6 已新增 `StagePlan`、`StageAdjustmentDraft` 和持久草稿确认边界 | 长期报告决策、任务重排应用和真实 AI 阶段调整仍由 Package C/D 承接 |
| 2026 年 12 月同步自测专题流程 | 已完成 | `/simulation` 固定 2026 同步全真自测节点、第一次自测阶段日记、结构化模拟考试 `isFirstSynchronized` 标记、考后本地重校准草稿；Batch 6 后可把本地重校准草稿持久化为需确认的 `StageAdjustmentDraft` | 更完整的报告决策和长期应用流仍由 Package D 承接 |
| 周审判报告 | 已完成 | `/reports` 周报返回时长、有效时长、科目占比、完成率、欠账、低转化、错题复盘、最大短板、下周期问题和确认边界 | 报告快照持久化和应用流仍由 Package D 承接 |
| 月复盘报告 | 已完成 | `/reports` 月报返回阶段策略、长期短板、科目投入、低转化、是否调整阶段计划的只读建议；Batch 6 后展示最新持久阶段计划和持久草稿边界；`canAutoApply=false` / `requiresUserConfirmation=true` | 报告确认、驳回和应用写入仍由 Package D 承接 |
| 任务债务自动重排建议 | 已完成 | `GET /api/tasks/debt-reorder` 和首页任务区已展示保留、补做、延期、拆小、放弃、改复习建议；建议透传 `canAutoApply=false` / `requiresUserConfirmation=true`，不可自动应用 | 确认、驳回、应用记录仍由 Package D 承接 |
| 知识点遗忘风险提醒 | 已完成 | `/analytics`、`/reports` 和 `/syllabus` 基于错题集中、最近证据时间、错题记录更新趋势、笔记到期、节点状态和 Batch 4 显式复测记录派生遗忘/复习风险 | 长期复习历史和阶段计划联动仍由 Package D 承接 |
| 笔记复习提醒 | 已完成 | `Note.nextReviewAt`、`/notes` 复习提醒筛选、`/analytics` 到期笔记风险和 `/reports` 到期笔记计数；附件上传已由 Package A 完成 | 后续可继续做更细复习策略 |
| 作战地图高级可视化 | 已完成 | `/syllabus` 已展示分科摘要、地图状态分布、优先节点、推荐筛选、地图状态筛选、行动类型筛选和 Batch 4 显式掌握证明记录 | 结构化复习历史仍由 Package D 增强 |
| 状态主题深度联动 | 已完成 | `determineThemeState` 基于冲刺窗口、风险状态和连续性生成主题；首页根据 `themeState` 切换外壳，并展示正常推进、锻造、警报、恢复、冲刺的状态主题面板、触发信号和行动焦点；恢复主题联动最小任务裁剪，冲刺主题前置倒计时与阶段压强；Batch 6 已提供持久阶段计划基础 | 深层主题应用和长期阶段压强调节仍随 Package D 增强 |
| 动机唤醒机制 | 已完成 | `evaluateMotivationWake` 覆盖未封存、断签、危险期、自测窗口、重大复盘和重情绪；首页只展示唤醒信号，不进入 AI 默认上下文 | 更细粒度历史策略可后续增强 |
| AI 根据长期数据生成阶段调整建议 | 基础版 / 待确认 | `draftStageAdjustment` 本地规则草稿；Batch 6 已可把本地规则建议持久化为 `StageAdjustmentDraft`，并要求用户确认后才更新 `StagePlan` | 真实长期 AI 外呼、隐私/费用验证和更完整应用流仍由 `tasks/backlog/0017-ai-stage-privacy-cost.md` 与 Package C/D 承接 |

## 暂缓项

| 功能项 | 当前状态 | 说明 |
|---|---|---|
| AI 自动生成完整学习计划 | 暂缓 | 只能生成建议或草稿，用户确认后应用 |
| AI 自动解析复杂 PDF 大纲 | 暂缓 | 当前仅支持受限 Markdown 导入 |
| 小程序 | 暂缓 | 私有 Web 优先 |
| 原生手机 App | 暂缓 | 后续可考虑 PWA 或独立 App |
| 多用户系统 | 暂缓 | 当前单管理员自用 |
| 排名系统 | 暂缓 | 不符合当前个人备考定位 |
| 网页内一键更新 | 暂缓 / 高风险 | 不允许网页内执行部署或服务器命令 |
| 复杂权限系统 | 暂缓 | 单管理员阶段不引入 RBAC |

## docs 100% 完成判定

只有同时满足以下条件，才能宣称 docs 100%：

- 第一版必须项均达到“已完成”，待确认项都有明确确认记录和验证结果。
- 第二阶段增强均达到“已完成”或被产品文档重新标记为暂缓。
- 高风险项均保留影响、风险、验证和回滚记录。
- `pnpm check`、相关包测试、Prisma validate、Compose config、关键 API 烟测和主要页面验证通过。
- 文档、任务、版本计划和代码实际状态没有漂移。
- 最终证据矩阵见 `docs/development/docs-100-acceptance-evidence.md`，高风险确认门见 `docs/development/high-risk-confirmation-packets.md`。
