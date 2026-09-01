# 统一复习

## 目标

把笔记卡片、错题、资料与考纲节点纳入同一排期模型，用快速复习确认不可变事件，并与任务桥接、CheckIn 演进保持事务一致。

## 当前实现（隔离分支）

- Schema：`ReviewSchedule` / `ReviewEvent`；exactly-one 目标 CHECK、四个 partial unique、ACTIVE/PAUSED 到期日 CHECK；`(scheduleId, idempotencyKey)` unique；correction 单 successor unique。
- API：
  - `/api/review-schedules` 物化/列表/改期
  - `/api/review-schedules/:id/pause|resume`
  - `POST /api/review-schedules/:id/events` 确认
  - `POST /api/review-events/:id/corrections`
  - bridge：`/api/review-schedules/:id/bridge` 与 `/api/study-tasks/:id/bridge-*`
- UI：`/knowledge/reviews/[scheduleId]/run` 单对象快速复习；`/knowledge/reviews` 统一复习列表。
- 队列支持“全部对象/仅错题”和“全部结果/最近未通过/最近部分掌握”筛选；筛选只改变当前视图，不改变服务端排期。活跃队列可用“跳过今天（延期到明天）”或“延期 3 天”快捷操作，操作前显示确认，写入继续复用 `PATCH /api/review-schedules/:id` 的 revision CAS。
- 确认事务：Event →（错题）MistakeAttempt → CAS Schedule →（考纲）Retest/Evidence → CheckIn v2 → Audit。
- 临时库验证：`AREAFORGE_V11_M6_ISOLATED_DB=1 pnpm ops:v11:m6:runtime:selftest`
- 上述能力已进入当前产品；后续源码变化仍须按目标 commit 重做对应 runtime、体验与 Release admission 验证。

## 行为要点

- `ReviewSchedule` 保存当前排期与暂停；`ReviewEvent` 只在确认时创建且不可变。
- 错题目标必须先独立作答再揭示答案；确认时提交作答模式和答案过程，同事务写入一对一 `MistakeAttempt`。相同幂等请求重放不新增记录，变化后的同键请求返回 409。
- 更正事件只追加 `ReviewEvent`，不改写既有 `MistakeAttempt`；重新作答会创建新的作答记录。
- 零时长不能确认；单次时长 1–14400 秒。
- Schedule 暂停时禁止确认；本地草稿挂起不写 Schedule。
- 考纲确认同事务创建 `MasteryRetest`；只有通过才写 `MasteryEvidence`。
- 桥接任务不能在没有已确认 `ReviewEvent.result` 的情况下完成。
- 队列顶部的今日进度按未筛选的全部到期项计算；“预计剩余”随当前筛选变化，避免把筛选视图误当成全局进度。

## 非目标

- 不新增第二结果表或自动把错题连通过判为掌握升级。
- 动机内容库、通知偏好与四类 AI 草稿已开放对应设置或显式入口；统一复习不会自动触发通知或 AI 外呼，也不会把未选择的复习正文发送给 AI。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
