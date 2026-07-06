# 0003 任务、计时与复盘真实闭环

状态：已完成。首页已从 mock 作战台推进到真实数据库闭环。

## 目标

打通第一条真实学习闭环：创建任务、开始计时、结束计时、保存记录、提交晚间复盘、首页展示真实统计。

## 范围

- 今日任务 CRUD。
- 计时开始、暂停、继续、结束。
- 计时记录持久化到数据库。
- 首页统计读取数据库。
- 晚间复盘保存。

## 不包含

- 文件上传。
- AI 实际调用。
- 复杂考纲树编辑。

## 参考源事实

- `docs/modules/tasks.md`
- `docs/modules/timer.md`
- `docs/modules/review.md`
- `docs/modules/dashboard.md`
- `docs/development/implementation-order.md`

## 验收标准

- 可以完成一次 `任务 -> 计时 -> 复盘 -> 统计刷新`。
- 刷新页面后计时记录和统计不丢失。
- 同一用户同一时间只能有一个运行中的计时。
- 未登录访问任务、计时、复盘相关 API 返回 `401`。
- `pnpm check` 通过。

## 验证

- `DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge AUTH_SESSION_SECRET=local-development-secret-change-me pnpm --filter @areaforge/web typecheck`
- `DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge AUTH_SESSION_SECRET=local-development-secret-change-me pnpm check`
- `git diff --check`
- API 烟测通过：未登录访问 `/api/tasks` 返回 `401`。
- API 烟测通过：`POST /api/tasks` 创建任务，`PATCH /api/tasks/:id` 修改任务。
- API 烟测通过：`POST /api/tasks/:id/complete`、`defer`、`drop` 分别完成、延期、放弃任务。
- API 烟测通过：`POST /api/study-sessions/start` 开始计时；重复开始返回 `409 ACTIVE_SESSION_EXISTS`。
- API 烟测通过：`GET /api/study-sessions/active` 可恢复 active session。
- API 烟测通过：`pause`、`resume`、`end` 均可持久化；结束后 active session 返回 `null`。
- API 烟测通过：`POST /api/reviews/today` 可 upsert 今日复盘，`GET /api/reviews/today` 可读取。
- 页面烟测通过：登录后首页展示真实任务、今日复盘、倒计时、连续打卡、任务欠账和考纲概览。
- Playwright 生产预览烟测通过：点击“开始”后计时器进入“专注中”，关联任务变为“进行中”，active session API 返回 `running`；随后通过 API 收口并确认 active session 为 `null`。

## 处理结果

- 新增学习闭环服务层：今日作战台聚合、任务操作、计时状态机、复盘保存。
- 新增 Dashboard、Subjects、Tasks、Study Sessions、Reviews API。
- 首页不再使用 mock 数据，改为服务端读取数据库聚合结果。
- 专注计时器改为 Client Component + API 持久化，刷新后可从 active session 恢复。
- 新增任务面板和晚间复盘表单。
- `next.config.ts` 增加 `allowedDevOrigins: ["127.0.0.1"]`，减少本地浏览器验证时的 dev HMR 噪声。

## 后续注意

- 当前仍按单管理员自用实现，业务记录暂不新增 `userId`；若后续扩展多用户，需要单独设计 migration、隔离策略和回滚方案。
- 快速烟测产生的本地测试任务和复盘仅存在本地数据库，不属于仓库内容。
