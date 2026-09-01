# 功能追踪矩阵

## 目标

本文件用于把 `docs/product/feature-scope.md` 的完整范围追踪到当前代码状态、版本计划和执行任务，避免把低风险基础版误判为 docs 100% 完成。

状态说明：

- 已完成：已有真实代码、API/UI 或验证记录支撑。
- 基础版：已有低风险入口或派生规则，但还不能替代完整结构化能力。
- 待确认：命中 migration、上传、AI、部署等高风险边界，执行前必须先确认影响、风险、验证和回滚。
- 隔离已实现：代码与隔离环境验收已完成，但尚未进入签名 Release 或生产切换，不等同于生产可用。
- 未实现：已写入下一产品版本规格，但尚未进入业务代码；不计入 docs 100% 完成声明（`docs:completion` 跳过「下一产品版本」节）。
- 暂缓：产品文档明确不进入当前版本。

组合状态只用于表达同一功能同时具备低风险入口和高风险缺口，例如“基础版 / 待确认”。不能使用“已完成基础版”这类混合状态；若仍需要第二阶段深度联动，应标为“基础版”。

## 第一版必须项

| 功能项 | 当前状态 | 当前证据 | 后续承接 |
|---|---|---|---|
| 单管理员登录 | 已完成 | `tasks/done/0002-mvp-auth-and-seed.md`；`/api/auth/*` | 仅认证策略变化时重新确认 |
| 今日作战台 | 已完成 | `GET /api/dashboard/today`、`apps/web/app/page.tsx` | `workflow/versions/v0.3-structured-learning-state.md` |
| 双节点倒计时 | 已完成 | 首页和阶段规则使用 2026/2027 节点 | 后续与冲刺模式联动 |
| 每日任务 | 已完成 | `tasks/done/0003-mvp-task-timer-review.md`；`/api/tasks`；今日任务表单支持写入已有 `StudyTask.type` | `tasks/backlog/0015-structured-state-migration.md` |
| 任务债务基础版 | 已完成 | `StudyTask.status/debtStatus`、任务面板、complete/defer/drop/recover/split/convert-review API；Package B Batch 2 已新增 `TaskDebtEvent` 事件账本和 `StudyTask.parentTaskId`，债务动作继续写 `AuditEvent` 并同步写事件账本；Package D Batch D2 已完成重排建议确认、驳回和所选项应用记录 | 更长期的自动阶段联动或批量应用需单独确认 |
| 学习计时 | 已完成 | `tasks/done/0003-mvp-task-timer-review.md`；`/focus` 默认入口；`/api/study-sessions/*`；科目必选、任务/考纲/目标时长后补、`CLOSING` 冻结收口、结构化低效原因、本地 IndexedDB/`localStorage` 队列、BroadcastChannel 跨标签页、设备心跳和单活动约束均已接入；专注收口内嵌创建知识卡片、错题、复测，并通过 `POST /api/study-sessions/:id/evidence` 校验上下文、幂等回写产出标志与证据回执 | 长期风险/主题只读联动已完成；更深自动应用另行确认 |
| 专注计时模式 | 已完成 | `/focus` 大型数字计时器与指针式秒表视觉、active session 恢复、跨页面/设备状态工具栏 | 后续 UX 打磨 |
| 打卡 | 已完成 | `evaluateDailyCheckIn`、`CheckIn` 日快照、首页 `dashboard.checkIn`、analytics/reports 逐日快照优先和缺失日期 fallback；不把打开应用算作打卡，active session 时长只实时展示、结束后固化 | 连续性已接入长期风险/主题只读联动；未来自动应用另行确认 |
| 每晚复盘 | 已完成 | `DailyReview`、`/roadmap/reviews/daily`、`/api/daily-reviews*`、`/api/reviews/today`；页面展示当天真实时长、任务、低转化、科目和证据摘要，保存后直达原子生成的明日最低行动 Inbox 项，Inbox 转换成功进入正式任务详情 | AI 真实建议和更细粒度历史统计继续增强 |
| 考纲进度树 | 已完成 | `/knowledge/syllabi`、`/api/syllabus/*`、Markdown 导入 | 附件和自动状态更新后增强 |
| 知识点掌握状态 | 已完成 | `SyllabusNode.status`、`masteryLevel`、`/knowledge/syllabi` 状态筛选、节点卡片和最近证据时间；Batch 4 已新增 `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`，显式证据优先并保留 `_count` fallback；Package D Batch D4 已接入长期风险只读 DTO | 更细结构化复习历史或自动计划应用需单独确认 |
| 知识点掌握证明基础版 | 已完成 | `packages/core/src/mastery-proof.ts`；`/knowledge/syllabi` 节点可选择目标掌握等级、勾选并保存掌握条件；`PATCH /api/syllabus/nodes/:id` 用显式证据或 `_count` fallback 校验，失败返回 `MASTERY_PROOF_REQUIRED`，成功写入 `SyllabusNode.status/masteryLevel` 和 `AuditEvent`；`POST /api/syllabus/nodes/:id/mastery-evidence` 写入证据引用；`POST /api/syllabus/nodes/:id/mastery-retests` 写入复测记录，`failed/partial` 不自动降级；Package B Batch 4 已完成 | 更复杂证据图谱和复习历史分析后续增强 |
| 错题 v2 学习证据闭环 | 隔离已实现 | `Mistake.questionText/correctAnswer/causeNote`、`MistakeAttempt`、`NoteMistakeLink`、模拟失分来源关联；`POST /api/mistakes/:id/attempts`、`PATCH /api/mistakes/:id/links`；详情独立作答与历史，`/knowledge/mistakes/practice` 混合排序练习，`/knowledge/reviews` 对象/结果筛选与 CAS 快捷延期；统一复习事务双写，模拟失分预填创建；全新隔离库 36 migrations、M6 runtime 与 owner-isolation runtime 通过 | 尚未执行生产 migration、部署或 Release；OCR、AI 批改、自动判分、账户导出不在范围 |
| 笔记与资料上传（知识卡片） | 已完成 | 知识卡片（底层 Note）API/UI 已有；按科目、节点、掌握状态和复习提醒筛选已有；Package A 已完成 noteId 绑定 PDF/PNG/JPEG/WebP 上传、`UPLOAD_DIR` 私有落盘、metadata/hash/URI 写入、鉴权下载、`/knowledge/cards` 附件 UI 和补偿/对账烟测 | `tasks/done/0004-mvp-syllabus-notes-upload.md` |
| 情绪与状态记录基础版 | 已完成 | `tasks/done/0010-motivation-emotion-stage.md` | 完整情绪历史表暂不做 |
| 恢复模式基础版 | 已完成 | `createRecoveryPlan`、`rankRecoveryTaskCandidates`、首页 `visibleRecoveryTasks` 和恢复原因；Package B Batch 3 已新增 `RecoveryState`、`POST /api/recovery-states/manual`、完成/取消恢复 API、dashboard active 状态优先和规则触发幂等记录；首页计时器聚焦恢复候选，任务面板保留完整任务列表；Package D D4 已把恢复/主题信号纳入长期风险只读闭环 | 未来若自动应用恢复任务或阶段调整，需单独确认 |
| 反假学习检查基础版 | 已完成 | 计时结束写 `isEffective`、`isLowConversion`、反假学习原因、补产出要求、最小产出、下一步动作和文本 note；Batch 0 已结构化收口字段；Batch 1 已把低转化次数写入 `CheckIn` 日快照；Batch 2 已把有效自动完成任务写入债务事件账本 | 历史 note 不解析；长期风险/主题只读闭环已完成，未来自动应用另行确认 |
| 考研作战地图概览版 | 已完成 | `tasks/done/0011-analytics-map.md`、`packages/core/src/syllabus-map.ts` | 高级可视化见 `0016` |
| 动机封存 | 已完成 | `tasks/done/0010-motivation-emotion-stage.md` | AI 默认仍不读取动机档案 |
| 阶段称号基础版 | 已完成 | `packages/core` 阶段规则、首页展示 | 与模拟成绩联动待第二阶段 |
| 鞭策文案 | 已完成 | Package C 已接入 OpenAI-compatible provider；`/api/ai/discipline` 在 `AI_ENABLED=true` 且配置完整时可显式外呼，失败回退本地规则；首页仍展示本地规则以避免普通 SSR 成本 | 长期阶段 AI 草稿显式入口已由 Package D Batch D3 完成；历史保存、费用账本或更大上下文另行确认 |
| AI 复盘建议 | 已完成 | Package C 已接入 `/api/ai/daily-review` 真实 provider 第一版；只发送聚合字段，不发送完整复盘正文、动机档案、完整情绪记录或附件内容；输出 schema 校验失败回退 | `tasks/done/0005-mvp-ai-discipline.md` |
| AI 明日任务建议 | 已完成 | Package C 已接入 `/api/ai/tomorrow-plan` 真实 provider 第一版；任务标题默认脱敏，`task title may contain private content` 不进入外呼；失败回退本地规则 | `tasks/done/0005-mvp-ai-discipline.md` |
| 基础统计 | 已完成 | `tasks/done/0011-analytics-map.md`、`/roadmap/stages/trend`；Package B `CheckIn` 快照和 Package D 长期风险 DTO 已接入 | 更细趋势分析可后续增强 |
| 数据持久化 | 已完成 | PostgreSQL + Prisma + migration；Package E 已完成生产备份、恢复演练、发布和回滚证据 | 未来生产策略或迁移变更另行确认 |

## 第二阶段增强

| 功能项 | 当前状态 | 当前证据 | 后续承接 |
|---|---|---|---|
| 全真模拟考试模式完整实现 | 已完成 | Package B Batch 5 已新增 `SimulationExam`、`SimulationSubjectResult`、`/api/simulation/exams`、`/api/simulation/exams/:id/results` 和 `/test/simulations` 结构化主写入路径；旧 `StudyTask.type = "simulation_exam"` 只读兼容；Batch 6 已新增 `StagePlan`、`StageAdjustmentDraft` 和持久草稿确认边界；Package D Batch D3 已完成长期 AI 阶段草稿显式入口 | 报告驱动自动阶段应用不进入当前范围，未来需单独确认 |
| 2026 年 12 月同步自测专题流程 | 已完成 | `/test/simulations` 固定 2026 同步全真自测节点、第一次自测阶段日记、结构化模拟考试 `isFirstSynchronized` 标记、考后本地重校准草稿；Batch 6 后可把本地重校准草稿持久化为需确认的 `StageAdjustmentDraft`；Package D Batch D1 后报告可确认、驳回并只读回放 | 更深自动应用流不进入当前范围，未来需单独确认 |
| 周审判报告 | 已完成 | `/roadmap/reviews` 周报返回时长、有效时长、科目占比、完成率、欠账、低转化、错题复盘、最大短板、下周期问题和 `decisionPreview`；页面区分事实/规则判断/待确认草稿/冻结结果，确认后先接投入草稿，再独立审阅阶段建议；`PeriodicReportDecision` 保留审计和只读回放 | 报告驱动自动改任务或阶段计划不进入当前范围，未来需单独确认 |
| 月复盘报告 | 已完成 | `/roadmap/reviews` 月报展示阶段策略、长期短板、科目投入、低转化和待确认动作；确认/驳回固定 `canAutoApply=false` / `requiresUserConfirmation=true`，历史页只读回放入箱汇总；阶段概览区分生效路线、待确认建议与最近结果 | 月报驱动自动任务重排或阶段应用不进入当前范围，未来需单独确认 |
| 任务债务自动重排建议 | 已完成 | `GET /api/tasks/debt-reorder` 和首页任务区已展示保留、补做、延期、拆小、放弃、改复习建议；建议透传 `canAutoApply=false` / `requiresUserConfirmation=true`；Package D Batch D2 后支持对所选建议确认、驳回和显式应用所选，复用 `TaskDebtEvent` 与 `AuditEvent`，不自动应用全部建议 | 更长期的任务/阶段自动联动需单独确认 |
| 知识点遗忘风险提醒 | 已完成 | `/roadmap/stages/trend`、`/roadmap/reviews` 和 `/knowledge/syllabi` 基于错题集中、最近证据时间、错题记录更新趋势、笔记到期、节点状态和 Batch 4 显式复测记录派生遗忘/复习风险；Package D Batch D4 已把遗忘风险纳入 `GET /api/analytics/long-term-risks` 和同源 `LongTermRiskPanel`，展示来源、窗口、证据新鲜度和下一步动作 | 更细结构化复习历史如未来需要，另走单独确认 |
| 知识卡片复习提醒 | 已完成 | `Note.nextReviewAt`、`/knowledge/cards` 复习提醒筛选、`/roadmap/stages/trend` 到期笔记风险和 `/roadmap/reviews` 到期笔记计数；Package D Batch D4 已把笔记复习提醒接入长期风险 DTO；附件上传已由 Package A 完成 | 后续可继续做更细复习策略 |
| 作战地图高级可视化 | 已完成 | `/knowledge/syllabi` 已展示分科摘要、地图状态分布、优先节点、推荐筛选、地图状态筛选、行动类型筛选和 Batch 4 显式掌握证明记录；Package D Batch D4 后，作战地图风险与报告、统计、笔记、模拟和首页状态主题读取同一长期风险 DTO | 更细结构化复习历史如未来需要，另走单独确认 |
| 状态主题深度联动 | 已完成 | `determineThemeState` 基于冲刺窗口、风险状态和连续性生成主题；首页根据 `themeState` 切换外壳，并展示正常推进、锻造、警报、恢复、冲刺的状态主题面板、触发信号和行动焦点；恢复主题联动最小任务裁剪，冲刺主题前置倒计时与阶段压强；Batch 6 已提供持久阶段计划基础；Package D Batch D4 已把首页状态主题接入长期风险 DTO，任务面板明确状态主题不隐藏完整任务列表、不自动修改任务或阶段计划；Package D Batch D5 已完成证据收口 | 未来若让主题自动应用任务或阶段变更，需单独确认 |
| 动机唤醒机制 | 已完成 | `evaluateMotivationWake` 覆盖未封存、断签、危险期、自测窗口、重大复盘和重情绪；首页只展示唤醒信号，不进入 AI 默认上下文 | 更细粒度历史策略可后续增强 |
| AI 根据长期数据生成阶段调整建议 | 已完成 | Package D Batch D3 已新增显式鉴权 `POST /api/simulation/stage-adjustment-drafts/ai` 和 `/simulation` 的“生成 AI 草稿”入口；长期 AI 上下文只发送周期范围、阶段目标摘要、有效时长、完成率、复盘完成率、低转化次数、科目占比、薄弱节点摘要、模拟考试汇总、阶段计划模式/状态、距阶段结束天数和风险标签；成功只写 `StageAdjustmentDraft.source="ai"` 结构化草稿和 `AI_STAGE_ADJUSTMENT_DRAFT_CREATED` 审计摘要，失败回退本地规则；不发送动机档案、完整情绪记录、完整复盘正文、附件内容或完整任务标题，不保存完整 prompt/raw response，不自动应用阶段计划；Package D Batch D4 后，长期风险 DTO 为阶段草稿提供一致风险原因但不触发 AI 外呼；Package D Batch D5 已完成证据收口 | 报告驱动的自动阶段应用不进入当前范围 |

## 学习行动中心（已进入生产）

本表能力均以 `workflow/versions/v1.1-learning-action-center.md` 为学习闭环规格源；`v1.2.0` 的体验与发布边界见 `workflow/versions/v1.2-high-density-workbench.md`。`v1.1.0` 已发布并进入生产，`v1.1.1` 已发布并完成受控 production apply，`v1.1.2` 已形成稳定 Release 但未 production apply。当前 checkout 正在准备 `v1.2.0` 候选；候选证据不改变既有生产事实，也不改写 Package A-E 和既有 docs 100% 的历史完成范围。

| 功能项 | 当前状态 | 当前证据 | 后续承接 |
|---|---|---|---|
| 五入口 App Shell 与稳定路由 | 已完成 | `/focus`、`/today`、`/knowledge/*`、`/test/*`、`/roadmap/*`；设置位于侧栏底部工具区，确认中心作为共享工作流入口；旧 `/plan/*`、`/review/*`、`/quick-review/*`、计时详情和重复设置路径已移除并由 canonical-only smoke 断言 404；r38 current-bound browser evidence 覆盖主要工作台路径 | 继续收敛视觉层级和自动应用边界，不改变既有 Release/生产事实 |
| 公共壳层、即时工具、工作窗口、活动槽与 Dock | 已完成 | `GlobalTopBar`、`GlobalCommandPalette`（registry 支持 `$`/`/` 别名）、`GlobalToolProvider` / `GlobalToolLayer`、`PageToolbar`、`GlobalContextStatusBar`、`WindowSystemProvider` / 全局 `WindowLayer`、`WindowDock`、`GlobalActivitySlot`、`GlobalConfirmationCenter`、`GlobalAiAssistant`、`GlobalQuickCreate`、`GlobalRecoveryHelp` 和 `GlobalSessionCloseout`；canonical 路由对 `/focus`、`/today` 和仅作窗口深链协议的 `/confirmations/*` 显式声明 `toolbar: "none"`；确认中心由顶部入口、命令面板或深链直接打开全局工作窗口，AI 默认使用即时工具并可显式升级为窗口，恢复和快捷创建只使用即时工具，Dock 只接收确认中心、AI 与活动收口；确认深链在窗口接管后返回安全业务页，不渲染 L3 占位；工作窗口通过 body Portal 覆盖整个 App Shell，按类型使用响应式固定尺寸，遮罩点击或 `Escape` 最小化；Dock 按真实宽度依次使用完整项、紧凑项和至少两项的批量收纳，移动端固定为“后台 N”；底部时钟以 `HH:mm:ss.SSS` 在绘制帧内独立刷新；窗口持久化、跨标签页合并和布局算法由 `window-system-state.test.ts` 与导航契约覆盖 | 后续只补充跨设备恢复等非本轮公共壳层范围的证据，不改变当前架构契约 |
| 三类活动来源与独立收口 | 已完成 | `/focus` 只承载自由学习；快速复习、专项复测和模拟考试由各自工作台启动；`activity-route.ts` 统一回源；特殊活动不复用 `FocusSessionClient` 收口；快速复习确认失败保留活动和草稿，事件保存且专属收口成功后才完成 | 继续补充真实浏览器的跨页面/跨设备恢复证据 |
| 考试工作区 / 自定义科目 / 408 分组 | 已完成 | `/settings/exams` 与鉴权 API；首次设置按考试目标与科目、已有数据处理两步推进；保留接管、科目/分组编辑、排序、归档、恢复；专项验收已实际创建首个工作区、首科目和 408 四科并刷新复核 | 物理删除、完整账户导出等数据生命周期仍不在范围，不改变既有 Release/生产事实 |
| 今日行动中心与科目快捷计时 | 已完成 | `/today` + `GET /api/action-center/today`；推荐/队列进入任务或复习时保留今日来源，任务详情继续把来源传给 `/focus`；专注完成主接力回到今日下一行动，并保留非今日原页面次操作 | 当前工作树继续收敛视觉层级 |
| PlanInbox / 里程碑 / 任务依赖 | 已完成 | `/roadmap/allocation/drafts*`、`/roadmap/allocation`、`/roadmap/allocation/tasks/[taskId]`、`/roadmap/stages` 与鉴权 API；旧 `/today/*`、`/stage/*` 和旧路线壳已移除并由 canonical-only smoke 断言 404。Inbox 转换、已转换列表、每日复盘任务均携带来源 `returnTo`，任务详情按今日/投入安排/投入草稿/复盘/阶段/知识显示正确返回语义；空状态提供可执行出口 | 继续收敛视觉层级和自动应用边界，不改变既有 Release/生产事实 |
| 学习树 V1 preview / confirm | 已完成 | `/knowledge/imports`；preview、confirm/history/export；`AF-RISK-DATA-001` residual 未关 | 物理删除与完整账户导出仍不在范围 |
| 全局关联画布 | 已完成 | `GET/PUT/DELETE /api/knowledge-canvas*` + `/knowledge/canvas`（`@xyflow/react`）；r38 的 CANVAS-01/02/03 与 24 项无障碍证据已 current-bound | 继续保留节点关系编辑的产品体验打磨，不改变既有 Release/生产事实 |
| StudyResource FILE/LINK | 已完成 | `/knowledge/resources` 与鉴权 CRUD/上传/下载/归档 API | 不支持物理删除 |
| 统一复习 Schedule/Event | 已完成 | `/knowledge` 唯一下一行动与最近证据；`/knowledge/reviews` 单一队列、今日进度和中文状态筛选；`/knowledge/reviews/[scheduleId]/run` 真实对象、确认结果、连续掌握变化、下次日期与继续下一项；任务详情桥接入口支持完成/延期/放弃及同幂等键重放；无下一项时按来源返回今日下一行动或复习队列；排期详情保留对象回链、事件 correction/bridge API | 真实 Provider、生产写入和数据生命周期仍不在本轮范围 |
| CheckIn v2 / 恢复三阶 | 已完成 | 今日摘要、Recovery v2 三阶与「我学不下去了」动机入口 | 不自动改写任务 |
| 动机 / 通知 / 四类 AI 草稿 | 已完成 | `/settings/profile` 按动机封存、当前设备提醒、可展示内容库组织，AI 草稿降为低频显式入口；通知偏好、四类鉴权 POST 草稿、`AI_PAYLOAD_BINDING_SECRET`；专项记录已复核档案、通知、AI、体验设置页面 | 不保存 prompt/raw response/history/token/cost/provider trace；真实 Provider key smoke 未执行 |
| 外部 Provider 当前账户配置、Web 全局开关与浏览器偏好 | 已完成 | `/settings/ai` 支持 Web 全局开关、当前账户 Provider 的更新/删除/合成测试和当前浏览器授权；鉴权 `GET|PATCH /api/ai/runtime`、`GET|PATCH|DELETE /api/ai/provider`、`POST /api/ai/provider/test` 与 `GET|PATCH /api/ai/preferences`；`AiRuntimeSetting` 审计、AES-256-GCM 密文、fingerprint、密钥不回显，八条鉴权 POST route 统一 gate | 当前实现已完成本地代码与迁移验收；真实 Provider key smoke、生产 migration/备份密文生命周期仍未验收；`AI_ENABLED` 保留为服务端硬闸门 |
| 模拟结构化失分 / 报告阶段入箱 | 已完成 | 分科 totals、0.5 分结构化失分、warning、逐项补救入箱、周期高严重度提升；模拟 UI 按“录分 -> 失分分析并确认事实 -> 补救入箱”推进，确认后只读，并回读每条补救的 Inbox 状态以阻止刷新后重复发送；Inbox 显示人类可读来源和考试回链，并接力阶段重评；报告与阶段完成态区分新增、复用和零草稿，报告确认后直达计划收件箱并接力阶段建议，阶段确认后再次把派生动作入箱，所有确认边界均不自动修改现有任务 | 不自动修改现有任务 |
| 完整 minor Release | 已完成 | `v1.1.0`、`v1.1.1`、`v1.1.2` Release 历史保持不变，既有完整 minor Release 证据仍然有效 | `AREAFORGE_AUTO_APPLY=none` 与 residual 状态保持不变；production apply 另行确认 |
| v1.2.0 发布候选 | 已完成 | 第一阶段已统一 package version 为 `1.2.0`，完成 additive migration 隔离验证、完整门禁、本地测试池与浏览器验收；PR #49 经 CI run `33505174259` 成功后 squash 合并为产品代码 commit `c8b5acf241bcaada59c6b469fd562d4fe400d521`，该 commit 的 main push CI run `33506280124` 也已成功，PR #51 随后完成状态文档收口 | tag/Release 仍需在独立确认时 fresh readback 当前 main HEAD；本阶段未执行生产 migration、生产更新、备份恢复或自动应用策略变更 |

## 暂缓项

| 功能项 | 当前状态 | 说明 |
|---|---|---|
| AI 自动生成完整学习计划 | 暂缓 | 只能生成建议或草稿，用户确认后应用 |
| AI 自动解析复杂 PDF 大纲 | 暂缓 | 当前仅支持受限 Markdown 导入 |
| 小程序 | 暂缓 | 私有 Web 优先 |
| 原生手机 App | 暂缓 | 后续可考虑 PWA 或独立 App |
| 多用户系统 | 暂缓 | 当前单管理员自用 |
| 排名系统 | 暂缓 | 不符合当前个人备考定位 |
| Web runtime 直接执行服务器命令的一键更新 | 暂缓 / 高风险 | 不允许 Web runtime 直接执行部署、备份、恢复、migration 或 Docker 命令；当前已完成的是版本中心提交受控更新请求，由 `areaforge-update-agent.timer` 触发服务器侧 root agent 执行签名校验更新 |
| 复杂权限系统 | 暂缓 | 单管理员阶段不引入 RBAC |

## docs 100% 完成判定

只有同时满足以下条件，才能宣称 docs 100%：

- 第一版必须项均达到“已完成”，待确认项都有明确确认记录和验证结果。
- 第二阶段增强均达到“已完成”或被产品文档重新标记为暂缓。
- 高风险项均保留影响、风险、验证和回滚记录。
- `pnpm check`、相关包测试、Prisma validate、Compose config、关键 API 烟测和主要页面验证通过。
- 文档、任务、版本计划和代码实际状态没有漂移。
- 最终证据矩阵见 `docs/development/docs-100-acceptance-evidence.md`，高风险确认门见 `docs/development/high-risk-confirmation-packets.md`。
