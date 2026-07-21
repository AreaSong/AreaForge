# 打卡与连续性

## 目标

打卡系统用于记录用户是否每天回到学习状态，并为风险判断、恢复模式和鞭策文案提供依据。

## 记录内容

- 学习日期。
- 是否完成最低学习动作。
- 当日总学习时长。
- 当日有效学习时长。
- 当日有效学习 session 数。
- 当日任务完成率。
- 是否完成晚间复盘。
- 当日是否低效。
- 当日低转化学习次数。
- 快照来源版本。

## 连续性指标

- 当前连续打卡天数。
- 历史最长连续打卡天数。
- 断签次数。
- 最近一次断签日期。
- 连续低效学习天数。

## 规则

- 打卡不等于打开应用，必须至少完成一次有效学习动作。
- 第一版可定义为：完成一段计时并提交收口记录。
- 连续断签会提高风险等级。
- 连续断签达到阈值后进入恢复模式。

## 兼容策略

- `CheckIn` 日快照与历史派生逻辑并存；历史无快照日期继续保留派生逻辑。
- 新写路径在结束计时、任务状态变化和保存每日复盘后 upsert 当日快照。
- 首页、统计和报告优先读 `CheckIn`；某日没有快照时 fallback 到 session/task/review 派生逻辑。
- analytics 和 reports 必须按学习日逐日混合：有快照的日期读 `CheckIn`，没有快照的日期继续按旧数据派生，不能把无快照历史日直接当作断签或 0 学习。
- 周/月 `taskCompletionRate` 的默认口径是逐日快照平均值；如后续需要任务数加权完成率，必须继续读取任务明细或在新的确认批次中补充 `taskCount/completedTaskCount` 字段。
- 正在运行的 active session 可以用于首页实时展示，但未结束 session 不能写入 `CheckIn`，只有结束计时后才固化到日快照；若开始计时把关联任务从 `TODO` 改为 `IN_PROGRESS`，只刷新任务计划日快照中的任务状态口径。
- 任务计划日变化时需要刷新旧计划日和新计划日；同一天重复刷新必须幂等。
- 历史日期不推断用户没有实际记录过的打卡状态，也不做不可靠回填。

## 快照演进（CheckIn v2，隔离已实现）

在保留现有日快照与 fallback 的前提下演进；隔离服务/API 已落地：

- CheckIn 归属当前考试工作区，唯一键为工作区 + 上海学习日（partial unique）。
- `sourceVersion=2` 时字段完整（含 `reviewCount`/`reviewSeconds`/结果计数/`minimumActionSource`）；旧 `sourceVersion=1` 在触达该学习日写路径时原子升级，不批量回填历史。
- 最低行动来源可包含已确认复习；当日已确认复习累计至少 300 秒可满足最低行动。
- 复习秒数计入复习指标，不计入有效学习分钟。
- `GET /api/check-ins?from=&to=` 只读；刷新只由 session / review / task / Inbox 事务触发。
- 恢复模式演进为 30/60/90 三阶（`/api/recovery/**`），按用户+工作区最多一个 active 状态；保留既有 `/api/recovery-states/**`。

权威规则见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
