# 业务状态并发一致性

```yaml
status: blocked
phase: awaiting-high-risk-confirmation
evidenceClass: migration_preimage_candidate
preflightContract: OPS-006-PREFLIGHT-CONTRACT-V1
blockers:
  - explicit OPS-006 local implementation confirmation
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm ops:ops-006:preflight:selftest
  - pnpm ops:ops-006:preflight:strict
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

详细事务顺序、CAS 谓词、CheckIn 锁顺序和 PostgreSQL fixture 契约见 `docs/development/ops-006-business-state-concurrency-design.md`。

当前离线 preflight 只绑定当前 schema preimage、候选 migration、只读 doctor、本文、设计文档和高风险确认包的 source hash。它不证明 migration 已获批或应用，不证明业务 CAS 已实现，也不构成本任务的高风险实施确认；因此 `pnpm ops:ops-006:preflight:strict` 在 phase 仍为 `awaiting-high-risk-confirmation` 时必须非零退出。

确认后也不得从 candidate evidence 直接跳到 release/production。生命周期固定为
`implementation_authorized -> local_validation -> local_verified -> release_ready ->
production_confirmation_required`；scope/source hash 漂移时回到 blocked。

## 拟实施范围

- additive migration：PostgreSQL 部分唯一索引保证当前单用户模型全局最多一个 RUNNING/PAUSED session。
- start/pause/resume/end 和 complete/defer/drop/recover/convert 等写路径使用 expected status CAS；冲突返回 409。
- 结束 session 的状态更新、任务/考纲分钟累加和 AuditEvent 在同一事务内只成功一次。
- task action 使用设计文档中的精确来源状态矩阵；CheckIn 使用固定
  `pg_advisory_xact_lock(1095123785, YYYYMMDD)` key 并在聚合读取前取锁。
- 增加真实 PostgreSQL 并发 selftest、doctor before/after fixture 和兼容旧数据的 preflight。

## 禁止范围

- 不自动修复、删除、合并或结束历史 session。
- 不执行生产 migration deploy，不批量修改任务或计时记录。
- 不新增多用户模型，不关闭 residual，不与附件 staging 或 updater phase journal 混批。

## 确认句

> 确认执行 OPS-006 业务状态并发一致性本地实施：范围仅限新增“最多一个活跃 StudySession”的 additive migration、task/session expected-status CAS、结束计时事务内单次副作用、同日 CheckIn 事务锁、409 冲突映射、只读 data-integrity doctor 联动和本地 PostgreSQL 并发 selftest；不执行生产 migration deploy、历史数据修复/删除/合并、批量任务修改、多用户迁移、附件改造、updater 改造、Release/tag、服务器命令、secrets 操作或 residual 台账关闭。
