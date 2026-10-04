# 0011 基础统计与作战地图完善

## 目标

让统计和作战地图回答“下一步该做什么”，而不是只展示好看的数字。

## 已完成

- 新增只读统计服务：近 7 天每日/每周学习时长、有效学习时长、科目投入占比、任务完成率、连续打卡、断签推断、复盘完成率。
- 新增统计 API：`GET /api/analytics/summary`。
- 新增统计页面：`/analytics`。
- 统计页展示科目投入占比、每日趋势、风险与提醒、下一步动作。
- 错题数量、到期错题复习提醒和笔记复习提醒可追溯到科目、节点和到期时间。
- 薄弱节点提醒来自 `SyllabusNode.status=WEAK/NEEDS_REVIEW` 或错题集中节点派生提醒，不自动改节点状态。
- 首页新增统计入口和统计复核信号。
- 作战地图增加状态网格和筛选：全部、未开始、学习中、已覆盖、需要复习、掌握、薄弱、暂缓。
- 节点卡片增加下一步动作提示，避免地图只展示状态。

## 不包含

- 复杂 BI 大屏。
- 为视觉效果堆无行动含义的图表。
- AI 长期预测。
- 统计快照表、复习完成历史表或自动写回节点状态。

## 参考源事实

- `docs/modules/analytics.md`
- `docs/modules/dashboard.md`
- `docs/modules/syllabus-map.md`
- `docs/ux/dashboard-states.md`

## 验证结果

- `pnpm --filter @areaforge/web typecheck` 通过。
- `pnpm --filter @areaforge/web lint` 通过。
- `pnpm --filter @areaforge/core test` 通过。
- `pnpm check` 通过。
- `git diff --check` 通过。
- API 烟测通过：
  - 未登录访问 `/api/analytics/summary` 返回 401。
  - 登录本地管理员成功。
  - `GET /api/analytics/summary` 返回 7 天范围、7 个科目、每日趋势、风险提醒和动作建议。
- 页面烟测通过：
  - 首页出现“统计”入口和统计复核信号。
  - `/analytics` 渲染本周投入、任务完成率、连续性、复盘完成率、科目占比、每日趋势、风险提醒和下一步动作。
  - `/syllabus` 渲染状态网格，点击“掌握”筛选后只显示掌握节点。

## 风险与后续

- 断签次数没有独立打卡/日历表，只能按近 7 天有效学习记录推断。
- 遗忘风险没有复习完成历史，当前用 `Note.nextReviewAt`、`Mistake.nextReviewAt`、错题集中和节点状态提醒。
- `SyllabusNode.actualMinutes` 当前不是可靠主事实，地图分钟进度仍需后续用 session 聚合或写回机制加强。
- 如果后续需要长期趋势快照或复习完成状态，需要单独设计并确认 migration。
