# 学习计时

## 目标

学习计时用于记录真实学习投入。科目是开始学习前唯一必选项；任务、考纲、知识点、阶段和目标时长均可在学习过程中或收口时补充，学习效果而不是任务完成量是主要事实。

## 状态机

```text
idle -> running -> paused -> running -> closing -> completed

`closing` 是冻结收口状态：进入收口的瞬间记录 `endedAt`，时间不再增长；只有最小产出、下一动作和个人反馈完整提交后才进入 `completed`。低效学习必须记录原因、专注度、精力和后续补充方向。
```

服务端与本地优先队列共同记录：

- `startedAt`
- `pausedAt`
- `endedAt`
- `accumulatedPauseSeconds`
- `effectiveMinutes`
- `closeoutVersion`
- `clientDeviceId` / `clientDeviceLabel` / `lastHeartbeatAt`

开始命令必须携带客户端生成的 `idempotencyKey`。服务端按用户、工作区、启动参数和幂等键保存创建回放：响应丢失时重复提交会返回原 session，不会新增计时；同一键提交不同参数会阻止重放。没有活动时才创建，若其他标签页或设备已经创建活动，则返回已有活动供客户端跳转。

## 专注模式

未开始计时时，`/focus` 直接展示大型数字计时器和指针式秒表视觉。

点击开始后：

- 计时器区域放大。
- 显示当前科目、任务、大纲节点、学习时长。
- 其他信息弱化或收起。
- 提供暂停、继续、结束。

## 结束收口

结束后必须记录：

- 学习质量评分。
- 是否有效学习。
- 理解程度。
- 最小产出。
- 下一步动作。

## 边界

- 同一用户全局只允许一个 `RUNNING`、`PAUSED` 或 `CLOSING` session；多个标签页和设备都回到同一个活动。
- 刷新页面后应恢复 active session。
- 不每秒写数据库。
- 跨午夜按用户时区归属学习日，第一版默认 Asia/Shanghai。
- 开始、暂停、继续、收口和上下文更新先写 IndexedDB（不可用时回退 `localStorage`），联网后按序同步；在线开始请求与离线队列共享同一个启动幂等键，避免响应未知时重复创建；`BroadcastChannel` 将快照传播到其他标签页。
- 活动页和 App Shell 每 15 秒发送设备心跳；心跳不改写命令 CAS 使用的 `updatedAt`，底部共享工具栏据此显示本设备或另一设备状态。
