# 0012 周审判与月复盘报告

## 目标

生成周报和月报，把学习时长、欠账、低转化学习、错题和短板压缩成下一周期策略。

## 已完成

- 新增只读周期报告服务：`getPeriodicReports()`。
- 新增周期报告 API：`GET /api/reports/periodic`。
- 新增报告页：`/reports`。
- 周审判报告：近 7 个学习日口径，展示学习时长、有效时长、科目投入占比、任务完成率、欠账、低转化、错题新增与错题记录更新。
- 月复盘报告：本月学习日口径，展示同类指标、最大短板、阶段主题和下周期策略。
- 最大短板来自薄弱/需复习/错题集中节点、欠账集中科目、投入缺口或低转化学习。
- 最大短板选择已下沉到 `packages/core` 的 `choosePeriodicWeakness` 纯规则，Web 报告服务只负责把数据库结果映射成平台无关输入；报告页已只读展示短板来源、严重度和选择依据。
- 下周期必须压住的问题、动作建议和本地复盘草稿由本地规则生成，策略 DTO 和 AI 草稿 DTO 均透传 `canAutoApply=false` 和 `requiresUserConfirmation=true`，不自动改计划。
- AI 区域当前明确显示为“本地规则复盘草稿”，默认不调用外部 AI，不发送长期记录、情绪记录或动机档案。
- 首页新增“报告”入口。

## 不包含

- 自动覆盖阶段计划。
- 自动删除或重排任务。
- 对外分享报告。
- 报告快照持久化。
- 默认 AI 复盘建议调用。

## 参考源事实

- `docs/modules/periodic-reports.md`
- `docs/modules/analytics.md`
- `docs/architecture/ai-boundary.md`
- `docs/security/file-ai-safety.md`

## 验证结果

- `pnpm --filter @areaforge/web typecheck` 通过。
- `pnpm --filter @areaforge/web lint` 通过。
- `pnpm --filter @areaforge/core test` 通过。
- 追加验证：`pnpm --filter @areaforge/core test` 覆盖最大短板选择的薄弱节点、欠账集中科目、零有效投入科目、低转化回退分支，以及短板来源、严重度和选择依据字段。
- `pnpm check` 通过。
- `git diff --check` 通过。
- API 烟测通过：
  - 未登录访问 `/api/reports/periodic` 返回 401。
  - 登录本地管理员成功。
  - `GET /api/reports/periodic` 返回周报、月报、科目占比、动作建议和 `local_rule_fallback` 草稿状态。
- 页面烟测通过：
  - 首页出现“报告”入口。
  - `/reports` 渲染周审判报告和月复盘报告。
  - 页面明确显示“即时派生报告，不落库，不默认调用 AI”。

## 风险与后续

- 错题复盘次数没有独立流水表，当前只能显示错题记录更新数与到期提醒，不能宣称精确复盘次数。
- 阶段计划和阶段调整草稿模型已由 Package B Batch 6 补齐；报告决策入口和报告快照持久化已由 Package D Batch D1 完成，报告驱动的阶段/任务应用仍待 Package D 后续批次确认。
- 若后续要扩展报告驱动的任务/阶段应用或长期 AI 周/月报，需要单独确认 migration、应用边界和数据最小化策略。
