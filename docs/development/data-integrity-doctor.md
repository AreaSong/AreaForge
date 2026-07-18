# 数据完整性 Doctor

## 目标

`pnpm ops:data-integrity:doctor` 是 AreaForge 的只读业务数据诊断入口。它只查询聚合计数，并可消费
已通过校验的附件 reconciliation summary；不输出任务标题、对象 ID、附件 URI、文件名、绝对路径、
数据库地址或附件内容，也不修复、删除或迁移数据。

## 检查项

- 全局活跃 `StudySession` 是否不超过 1 条。
- RUNNING / PAUSED / COMPLETED / CANCELED 与 `pausedAt`、`endedAt`、非负计时字段是否一致。
- 活跃 session 是否超过默认 24 小时阈值。
- `StudyTask.status`、`completedAt`、`debtStatus` 和分钟字段是否一致；当前服务可能产生的
  non-DONE + completedAt 作为 warning，不误报成结构性失败。
- 可选附件 summary 是否为 `report_only` 且无 db-only、file-only、hash/size mismatch、invalid URI、
  duplicate reference、unsafe/unexpected entry。

## 使用

```bash
DATABASE_URL=<read-only-url> pnpm ops:data-integrity:doctor > data-integrity-doctor.json
DATABASE_URL=<read-only-url> pnpm ops:data-integrity:doctor -- \
  --attachment-summary <attachment-reconciliation-summary.json> > data-integrity-doctor.json
pnpm ops:data-integrity:validate data-integrity-doctor.json
AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD=<data-integrity-doctor.json> \
  pnpm ops:long-term:snapshot > long-term-evidence-snapshot.json
pnpm ops:long-term:snapshot:validate long-term-evidence-snapshot.json
```

数据库地址只通过环境变量提供，不写入参数、输出或证据文件。附件完整对账仍由
`pnpm attachment:reconciliation` 单独生成私有 CSV 和 metadata-only summary；doctor 只投影 summary
的 status/counts/hash，不读取 CSV、上传目录或附件内容。

退出码：`0` 表示全部检查通过，`1` 表示报告有效但存在 warn/fail/skipped，`2` 表示参数或输入契约
无效，`3` 表示数据库或运行时错误。失败输出只使用静态脱敏类别，不回显 Prisma/runtime 原始错误。
validator 会固定检查项、message、detail keys、source/safety/status/counts 一致性、hash 和敏感 marker；通过只证明
记录契约与自声明一致，不是数据库读取的加密证明，也不证明当前生产健康。
长期快照默认要求记录不超过 24 小时；可通过 `AREAFORGE_LONG_TERM_DATA_INTEGRITY_MAX_AGE_HOURS`
收紧或放宽本地证据窗口。快照同时绑定原始文件 sha256 和内部 `doctorHash`，但仍不把 JSON 自声明升级为来源证明。

## 当前边界

- doctor 是发现和交接工具，不是数据库约束。
- 当前 checkout 已通过 canonical partial unique index、task/session CAS、结束计时事务内单次副作用和 CheckIn advisory lock 修复上述写路径，并在隔离 PostgreSQL 达到 `local_verified`。
- doctor before/after 只证明对应隔离库快照的 session/task 聚合；未提供 attachment summary 时仍保持 `warn/partial`，不会把附件缺证据误算为 OPS-006 失败。
- 线上 `v0.1.7` 尚未包含该 migration/应用实现；匹配签名 Release、生产 migration/deploy、fresh production doctor 和 rollout evidence 仍需独立确认，见 `tasks/active/0020-business-state-concurrency.md` 和 `AF-RISK-OPS-006`。

## 不证明

- 不自动修复或删除数据。
- 不证明快照之后的并发写仍然安全。
- 不以 JSON 自声明证明数据库账号权限或数据库读取来源；真实运行仍需由受控操作记录绑定命令和环境边界。
- 未提供已校验附件 summary 时，不证明附件完整性。
- 不证明生产 health、备份新鲜度、updater apply、migration、rollback 或 residual 已关闭。
