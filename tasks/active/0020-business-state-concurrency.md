# 业务状态并发一致性

```yaml
status: awaiting-high-risk-confirmation
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm ops:data-integrity:selftest
  - pnpm db:validate
  - temporary PostgreSQL migration and concurrency selftest
  - pnpm check
residualRiskIds:
  - AF-RISK-OPS-006
releaseRequired: true
```

## 目标

消除多标签页或并发请求下重复活跃计时、重复结束计时和任务状态 last-write-wins。

## 拟实施范围

- additive migration：PostgreSQL 部分唯一索引保证当前单用户模型全局最多一个 RUNNING/PAUSED session。
- start/pause/resume/end 和 complete/defer/drop/recover/convert 等写路径使用 expected status CAS；冲突返回 409。
- 结束 session 的状态更新、任务/考纲分钟累加和 AuditEvent 在同一事务内只成功一次。
- 增加真实 PostgreSQL 并发 selftest、doctor before/after fixture 和兼容旧数据的 preflight。

## 禁止范围

- 不自动修复、删除、合并或结束历史 session。
- 不执行生产 migration deploy，不批量修改任务或计时记录。
- 不新增多用户模型，不关闭 residual，不与附件 staging 或 updater phase journal 混批。

## 确认句

> 确认执行 OPS-006 业务状态并发一致性本地实施：范围仅限新增“最多一个活跃 StudySession”的 additive migration、task/session expected-status CAS、结束计时事务内单次副作用、409 冲突映射、只读 data-integrity doctor 联动和本地 PostgreSQL 并发 selftest；不执行生产 migration deploy、历史数据修复/删除/合并、批量任务修改、多用户迁移、附件改造、updater 改造、Release/tag、服务器命令、secrets 操作或 residual 台账关闭。
