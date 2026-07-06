# 0003 任务、计时与复盘真实闭环

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
- `pnpm check` 通过。

