# 学习计时

## 目标

学习计时用于记录真实学习投入，并把时间和任务、大纲、复盘关联。

## 状态机

```text
idle -> running -> paused -> running -> completed
```

第一版前端计时器只负责显示，后续服务端需要记录：

- `startedAt`
- `pausedAt`
- `endedAt`
- `accumulatedPauseSeconds`
- `effectiveMinutes`

## 专注模式

未开始计时时，首页展示完整信息。

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

- 同一用户第一版只允许一个 active session。
- 刷新页面后应恢复 active session。
- 不每秒写数据库。
- 跨午夜按用户时区归属学习日，第一版默认 Asia/Shanghai。

