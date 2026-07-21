# 统一复习（规划，未实现）

## 目标

把笔记卡片、错题、资料与考纲节点纳入同一排期模型，用快速复习确认不可变事件，并与任务桥接、CheckIn 演进保持事务一致。

## 规划行为

- `ReviewSchedule` 保存当前排期与暂停；`ReviewEvent` 只在确认时创建且不可变。
- 零时长不能确认；单次时长 1–14400 秒。
- 本地草稿按用户+schedule 隔离，挂起不写 Schedule；Schedule 暂停时禁止开始新快速复习。
- 错题揭示前必须作答或确认已作答。
- 考纲确认同事务创建 `MasteryRetest`；只有通过才写 `MasteryEvidence`。
- 桥接任务不能在没有已确认 `ReviewEvent.result` 的情况下完成。

## 非目标

- 不新增第二结果表或自动把错题连通过判为掌握升级。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
