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
| 任务债务基础版 | 基础版 | `tasks/backlog/0008-task-debt-checkin-recovery.md`；轻量补做/拆小/改复习 API | `tasks/backlog/0015-structured-state-migration.md` |
| 学习计时 | 已完成 | `tasks/done/0003-mvp-task-timer-review.md`；`/api/study-sessions/*` | 结构化收口字段待 migration |
| 专注计时模式 | 已完成 | 首页 `FocusTimer` 与 active session 恢复 | 后续 UX 打磨 |
| 打卡 | 基础版 | 当前由有效计时和复盘派生 | `CheckIn` migration 后完成 |
| 每晚复盘 | 已完成 | `DailyReview`、`/api/reviews/today` | AI 真实建议和结构化统计继续增强 |
| 考纲进度树 | 已完成 | `/syllabus`、`/api/syllabus/*`、Markdown 导入 | 附件和自动状态更新后增强 |
| 知识点掌握状态 | 基础版 | `SyllabusNode.status`、`masteryLevel`、最近证据时间派生 | 掌握条件/证据表待 migration |
| 知识点掌握证明基础版 | 基础版 | `packages/core/src/mastery-proof.ts`、考纲页面缺口提示、证据过旧风险 | `tasks/backlog/0015-structured-state-migration.md` |
| 笔记与资料上传 | 基础版 / 待确认 | 笔记 API/UI 已有；按科目、节点、掌握状态和复习提醒筛选已有；storage 纯规则已有 | `tasks/active/0004-mvp-syllabus-notes-upload.md` |
| 情绪与状态记录基础版 | 已完成 | `tasks/done/0010-motivation-emotion-stage.md` | 完整情绪历史表暂不做 |
| 恢复模式基础版 | 基础版 | 首页恢复任务裁剪和 core 规则 | 持久化恢复状态待 migration |
| 反假学习检查基础版 | 基础版 | 计时结束写 `isEffective` 和文本 note | 结构化收口字段待 migration |
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
| 全真模拟考试模式完整实现 | 基础版 | `StudyTask.type = "simulation_exam"` 文本化入口 | `tasks/backlog/0013-simulation-stage-adjustment.md`、`0015` |
| 2026 年 12 月同步自测专题流程 | 基础版 | 第一次全真自测阶段日记入口 | `tasks/backlog/0013-simulation-stage-adjustment.md` |
| 周审判报告 | 基础版 | 只读派生报告 `/reports`；`packages/core` 已承载最大短板选择和周期策略纯规则；策略和本地草稿均透传 `canAutoApply=false` / `requiresUserConfirmation=true` | `tasks/backlog/0016-second-stage-long-term-loop.md` |
| 月复盘报告 | 基础版 | 只读派生报告 `/reports`；`packages/core` 已承载最大短板选择和周期策略纯规则；策略和本地草稿均透传 `canAutoApply=false` / `requiresUserConfirmation=true` | `tasks/backlog/0016-second-stage-long-term-loop.md` |
| 任务债务自动重排建议 | 基础版 / 待确认 | `GET /api/tasks/debt-reorder` 和首页任务区已展示只读重排建议；建议透传 `canAutoApply=false` / `requiresUserConfirmation=true`，不可自动应用 | `tasks/backlog/0016-second-stage-long-term-loop.md` |
| 知识点遗忘风险提醒 | 基础版 | 当前用错题集中、最近证据时间、错题记录更新趋势、笔记到期和节点状态派生 | `tasks/backlog/0016-second-stage-long-term-loop.md` |
| 笔记复习提醒 | 基础版 | `Note.nextReviewAt` 和统计提醒 | `tasks/backlog/0016-second-stage-long-term-loop.md` |
| 作战地图高级可视化 | 基础版 / 待确认 | `/syllabus` 已展示分科摘要、地图状态分布、优先节点、地图状态筛选和行动类型筛选；结构化复习历史仍待确认 | `tasks/backlog/0016-second-stage-long-term-loop.md` |
| 状态主题深度联动 | 基础版 | 首页接入 `themeState` 基础信号 | `tasks/backlog/0016-second-stage-long-term-loop.md` |
| 动机唤醒机制 | 基础版 | `tasks/done/0010-motivation-emotion-stage.md`；基础唤醒已可用 | 深度联动见 `0016` |
| AI 根据长期数据生成阶段调整建议 | 基础版 / 待确认 | `draftStageAdjustment` 本地规则草稿 | `tasks/backlog/0017-ai-stage-privacy-cost.md` |

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
