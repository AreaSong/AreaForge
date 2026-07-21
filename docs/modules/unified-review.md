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
- UI：`/quick-review/[scheduleId]` 单对象快速复习；统一复习列表/排期管理页尚未开放。
- 确认事务：Event → CAS Schedule →（考纲）Retest/Evidence → CheckIn v2 → Audit。
- 临时库验证：`AREAFORGE_V11_M6_ISOLATED_DB=1 pnpm ops:v11:m6:runtime:selftest`

## 行为要点

- `ReviewSchedule` 保存当前排期与暂停；`ReviewEvent` 只在确认时创建且不可变。
- 零时长不能确认；单次时长 1–14400 秒。
- Schedule 暂停时禁止确认；本地草稿挂起不写 Schedule。
- 考纲确认同事务创建 `MasteryRetest`；只有通过才写 `MasteryEvidence`。
- 桥接任务不能在没有已确认 `ReviewEvent.result` 的情况下完成。

## 非目标

- 不新增第二结果表或自动把错题连通过判为掌握升级。
- 统一复习列表页（`/knowledge/reviews`）尚未开放；当前仅开放 `/quick-review/[scheduleId]`。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
