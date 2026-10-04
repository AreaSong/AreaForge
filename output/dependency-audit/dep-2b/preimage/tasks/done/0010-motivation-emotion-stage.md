# 0010 动机封存、情绪状态与阶段称号

## 目标

实现动机、情绪和阶段状态，让系统能在长期备考中识别状态变化，但不滥用敏感内容。

## 已完成

- 动机封存页面：`/motivation`。
- 动机封存 API：`GET /api/motivation-vault`、`POST /api/motivation-vault`。
- 情绪状态记录基础版：晚间复盘使用规范情绪标签，同时兼容历史自由文本情绪值。
- 阶段称号基础规则：按连续打卡、今日有效时长、近期有效时长、任务完成率和大纲进度计算。
- 首页展示阶段称号、状态等级、阶段分和压强。
- 动态主题接入 `themeState` 基础信号。
- 动机唤醒机制：缺少动机档案、连续失守、重大复盘、第一次全真自测前后、危险期和重情绪状态时提示用户查看。
- 动机档案默认不进入 AI 上下文，首页只展示唤醒信号，不展示动机正文。

## 不包含

- 默认把动机档案发送给 AI。
- 默认把完整情绪记录发送给 AI。
- 情绪诊断或医疗建议。
- 情绪历史表或阶段快照表。

## 参考源事实

- `docs/modules/motivation.md`
- `docs/modules/emotion-state.md`
- `docs/modules/stage-levels.md`
- `docs/ux/dynamic-theme.md`
- `docs/security/file-ai-safety.md`

## 验证结果

- `pnpm --filter @areaforge/core test` 通过。
- `pnpm --filter @areaforge/web typecheck` 通过。
- `pnpm --filter @areaforge/web lint` 通过。
- `pnpm check` 通过。
- API 烟测通过：
  - 未登录访问 `/api/motivation-vault` 返回 401。
  - 登录本地管理员成功。
  - `GET /api/motivation-vault` 成功。
  - 空动机档案时 `POST /api/motivation-vault` 保存成功。
  - `GET /api/dashboard/today` 返回阶段称号和动机唤醒信号。
- 页面烟测通过：
  - 登录后首页展示阶段称号、阶段状态和动机唤醒入口。
  - 晚间复盘情绪下拉保留历史情绪值。
  - `/motivation` 渲染动机封存表单并显示已保存内容。

## 风险与后续

- 动机和情绪属于敏感数据；AI 上下文策略变化仍必须单独确认。
- 若后续需要情绪历史、阶段快照或多用户动机隔离，需要单独设计并确认 migration。
