# 业务状态并发一致性

```yaml
status: in-progress
phase: local-verified
evidenceClass: local_concurrency_verified
preflightContract: OPS-006-PREFLIGHT-CONTRACT-V2
blockers:
  - matching signed Release
  - independent production migration/deploy confirmation
  - fresh production doctor and rollout evidence
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm ops:ops-006:preflight:selftest
  - pnpm ops:ops-006:preflight:strict
  - pnpm ops:ops-006:runtime:validate:selftest
  - pnpm ops:ops-006:runtime:validate output/ops006/concurrency-runtime-20260718.json
  - pnpm ops:ops-006:evidence:selftest
  - pnpm ops:ops-006:production:preflight:selftest
  - pnpm ops:data-integrity:selftest
  - pnpm ops:data-integrity:validate output/ops006/data-integrity-before-20260718.json
  - pnpm ops:data-integrity:validate output/ops006/data-integrity-after-20260718.json
  - pnpm db:validate
  - isolated PostgreSQL migration and concurrency selftest
  - pnpm check
residualRiskIds:
  - AF-RISK-OPS-006
releaseRequired: true
```

## 目标

消除多标签页或并发请求下重复活跃计时、重复结束计时和任务状态 last-write-wins。

详细事务顺序、CAS 谓词、CheckIn 锁顺序和 PostgreSQL fixture 契约见 `docs/development/ops-006-business-state-concurrency-design.md`。

当前 V2 preflight 绑定 canonical migration、只读 doctor、隔离 PostgreSQL runtime record、当前实现文件以及本文、设计文档和高风险确认包 source hash。带当前 after-doctor 和 runtime record 运行 strict 可达到 `local_verified`；这只证明同一 checkout 的本地实现与隔离数据库验证，不证明签名 Release 或生产迁移。

独立 production evidence contract 见 `docs/development/ops-006-production-evidence-template.md`。`pnpm ops:ops-006:evidence:validate` 和 `pnpm ops:ops-006:production:preflight` 只有在 strict signed Release、Release source-at-commit、经独立确认的 production rollout、另行确认的 controlled synthetic probe、before/after doctor、通用 Release evidence 与 rollback target 全部绑定后，才可投影 `ready_for_ops006_human_review`；它仍不自动关闭 residual。

确认后也不得从 candidate evidence 直接跳到 release/production。生命周期固定为
`implementation_authorized -> local_validation -> local_verified -> release_ready ->
production_confirmation_required`；scope/source hash 漂移时回到 blocked。

## 本地实施结果

- additive migration 已在隔离 PostgreSQL 应用，部分唯一索引保证当前单用户模型全局最多一个 RUNNING/PAUSED session。
- start/pause/resume/end、metadata patch、complete/defer/drop/recover/split/convert、simulation complete 和 debt reorder application 已使用 expected-state CAS；冲突稳定返回 `ACTIVE_SESSION_EXISTS`、`SESSION_STATE_CONFLICT` 或 `TASK_STATE_CONFLICT` / 409。
- 结束 session 的状态更新、任务/考纲分钟、债务事件、AuditEvent 和 CheckIn 在同一事务内只由 CAS 胜者写一次。
- CheckIn 使用固定
  `pg_advisory_xact_lock(1095123785, YYYYMMDD)` key 并在聚合读取前取锁。
- `output/ops006/concurrency-runtime-20260718.json` 已覆盖 migration 正负 fixture、start/pause/resume/end、7 类 task 命令、simulation、debt reorder 和同日 CheckIn 并发聚合；before/after doctor 的 session/task 检查均通过，附件未提供所以 doctor overall 保持 `warn/partial`。
- 本地阶段进入 `local_verified`；下一状态固定为签名 Release 后的 `production_confirmation_required`，不得从本地 pass 直接执行生产 migration。

## 禁止范围

- 不自动修复、删除、合并或结束历史 session。
- 不执行生产 migration deploy，不批量修改任务或计时记录。
- 不新增多用户模型，不关闭 residual，不与附件 staging 或 updater phase journal 混批。

## 确认句

> 确认执行 OPS-006 业务状态并发一致性本地实施：范围仅限新增“最多一个活跃 StudySession”的 additive migration、task/session expected-status CAS、结束计时事务内单次副作用、同日 CheckIn 事务锁、409 冲突映射、只读 data-integrity doctor 联动和本地 PostgreSQL 并发 selftest；不执行生产 migration deploy、历史数据修复/删除/合并、批量任务修改、多用户迁移、附件改造、updater 改造、Release/tag、服务器命令、secrets 操作或 residual 台账关闭。
