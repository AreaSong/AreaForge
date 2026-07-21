# 数据统计

## 目标

数据统计用于把学习行为转成可检查的趋势，而不是只展示好看的数字。

## 第一版统计

- 每日学习时长。
- 每周学习时长。
- 有效学习时长。
- 科目投入占比。
- 任务完成率。
- 连续打卡天数。
- 断签次数。
- 错题数量。
- 复盘完成率。

## 后续统计

- 阶段目标完成率。
- 预测风险。
- 科目短板提醒。
- 按目标分倒推的投入建议。
- 低转化学习占比。
- 任务债务趋势。
- 知识点遗忘风险。

## 原则

- 数据必须指向行动。
- 每个统计图都要能回答“下一步该做什么”。
- 不为了好看堆图表。

## 当前行为

- `packages/core` 提供 `summarizeSyllabusMap` 纯规则，把考纲节点状态聚合为覆盖率、验证率、推荐筛选和下一步动作。
- `packages/core` 提供 `summarizeAnalyticsRisks` 纯规则，把有效学习不足、任务完成率偏低、复盘缺口、薄弱节点、到期错题和到期笔记压缩成风险项与行动建议。
- `summarizeLongTermRisks` 通过 Web 只读服务和 `GET /api/analytics/long-term-risks`，把周期报告、任务债务、作战地图、复习队列、模拟考试、阶段计划和首页状态主题压缩成统一长期风险 DTO，并保持 `canAutoApply=false`、`requiresUserConfirmation=true`。
- Web 层只负责查库和 DTO 格式转换，不写长期风险状态。

实现进度与批次证据见 [功能追踪矩阵](../development/feature-traceability.md)。
