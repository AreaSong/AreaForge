# OPS-006 业务状态并发一致性设计

当前状态：`local_verified / production_confirmation_required`。

本文定义的本地实施已按 2026-07-18 明确确认完成；它不授权生产 migration deploy、历史数据修复、发布 Release 或修改服务器。

当前 preflight 契约：`OPS-006-PREFLIGHT-CONTRACT-V2`，`evidenceClass: local_concurrency_verified`。V2 同时绑定 canonical migration、24 小时内只读 doctor、隔离 PostgreSQL runtime record、当前实现文件和本文/task/确认包 source hash；strict 只在 `local_verified` 时返回零。该证据不证明签名 Release、生产 migration、生产并发安全或 residual 关闭。

确认与证据生命周期固定为：

1. `awaiting_high_risk_confirmation`：只有确认前设计、preimage、fixture 和只读证据；strict 非零退出。
2. `implementation_authorized`：仅在用户明确确认且确认范围仍与当前 task/design/packet/source hash 一致后进入；只授权本地实现。
3. `local_validation`：实现已开始，但 migration、CAS、锁和并发 fixture 尚未全部通过。
4. `local_verified`：同一 checkout 的本地 migration/CAS/409/并发验证通过；仍不等于 Release 或生产授权。
5. `release_ready`：干净 commit 和签名 Release 门禁通过；仍不得执行生产 migration。
6. `production_confirmation_required`：等待独立生产 migration/deploy 确认与 fresh doctor/evidence。

任何确认过期、撤销、scope/source hash 漂移或扩大到生产/历史修复时都回到 fail-closed 状态。V1 `migration_preimage_candidate` 只保留为确认前历史语义，不能被解释为当前实现或生产授权。

## 目标不变量

1. 当前单管理员模型中，全局最多存在一个 `RUNNING` 或 `PAUSED` 的 `StudySession`。
2. session/task 状态命令必须通过 compare-and-swap（CAS，比较并交换）产生唯一胜者；过期状态返回 HTTP 409。
3. `endStudySession` 只有成功完成 `RUNNING|PAUSED -> COMPLETED` CAS 的事务可以累加任务分钟、考纲分钟、写债务事件、审计和 CheckIn。
4. pause/resume/end 的状态变更与审计位于同一事务；失败事务不得留下部分副作用。
5. 同一学习日的 CheckIn 重算必须串行化，避免并发事务用较旧聚合覆盖较新快照。
6. 所有并发拒绝保持可重试、无副作用，不自动修复或重写历史记录。

## 实施前风险

- `startStudySession` 在事务外检查 active session，再在事务内创建，两个请求可同时成功。
- `resumeStudySession` 读取 `PAUSED` 后按 id 无条件更新，可能把已结束 session 重新写成 `RUNNING`。
- `endStudySession` 在事务外读取 active 状态，重复请求可分别累加任务和考纲分钟并重复写事件。
- complete/defer/drop/recover/split/convert、模拟任务完成和债务重排应用缺少统一 CAS，存在 last-write-wins。
- CheckIn 的唯一学习日约束只防重复行，不防并发旧聚合覆盖。

## 本地验证结果

- canonical migration hash：`sha256:928b5e3e60b2ce2f4e1292393ac8d2ff1bde2a4ee5c860170f422cb1fbf2b953`。
- runtime record：`output/ops006/concurrency-runtime-20260718.json`；记录内部 `recordHash` 以文件和 validator 输出为准。
- doctor before：`output/ops006/data-integrity-before-20260718.json`；session/task 四项检查通过。
- doctor after：`output/ops006/data-integrity-after-20260718.json`；session/task 四项检查通过；未提供 attachment summary，所以只报告 `warn/partial`，不把附件缺证据混作 OPS-006 失败。
- 隔离 PostgreSQL 验证覆盖 canonical apply、重复 apply 拒绝、dirty preimage 拒绝、单 active session、session/task CAS、结束计时单次副作用、simulation/debt reorder 和 CheckIn 锁后聚合。
- 本地实现没有执行生产 migration、历史修复、Release/tag、服务器命令或 residual 关闭。

源路径：

- `apps/web/lib/study/service.ts`
- `apps/web/lib/study/simulation-service.ts`
- `apps/web/lib/study/task-debt-reorder-service.ts`
- `apps/web/lib/study/check-in-service.ts`
- `prisma/schema.prisma`

## Additive migration

候选 migration 只能包含以下 PostgreSQL 部分唯一索引，不修改现有行：

```sql
CREATE UNIQUE INDEX "StudySession_one_active_idx"
ON "StudySession" ((1))
WHERE "status" IN ('RUNNING', 'PAUSED');
```

约束：

- 不在 Prisma schema 中伪造 `@@unique([status])`，因为它会错误限制所有历史状态。
- 不包含 `DROP`、`DELETE`、`TRUNCATE`、`UPDATE`、回填、自动结束 session 或历史修复。
- 如果临时库或只读 doctor 发现两个以上 active session，migration 必须中止；数据修复另走确认包。
- preflight、临时库 apply/verify、签名 Release、生产 migration deploy 是四类不同证据。
- 候选 SQL strict preflight 必须在去除 SQL 注释后只剩一条规范 partial unique index；额外索引、附加子句或多语句均拒绝。
- doctor 必须来自 24 小时内 `configured_read_only_query` 且 `databaseReadAttempted=true`；只按 session/task checks 判定 OPS-006 readiness，附件 check 单独报告，fixture/陈旧记录不得开闸。

## CAS 契约

第一版不新增通用 version 字段。服务在事务内读取目标行，并使用 `id + expected status + updatedAt` 执行 `updateMany`；`count !== 1` 时抛出稳定冲突错误，事务整体回滚。客户端不直接指定任意数据库状态。

Session 允许转换：

- `RUNNING -> PAUSED`
- `PAUSED -> RUNNING`
- `RUNNING|PAUSED -> COMPLETED`

### 任务动作状态矩阵

第一版本地实施必须按下表固定来源状态；不得由调用者传入任意 expected status。`updatedAt`、来源 status、
debtStatus、type 和 plannedDate 均来自同一事务内读取，并进入 CAS 谓词。表中“冲突”均为
`TASK_STATE_CONFLICT / 409`，且无 AuditEvent、TaskDebtEvent、子任务、分钟或 CheckIn 副作用。

| 动作 | 允许来源 | 目标与字段语义 | 派生副作用 |
| --- | --- | --- | --- |
| start session 关联 task | `TODO` 或 `IN_PROGRESS`；type 不限制 | `TODO -> IN_PROGRESS`；`IN_PROGRESS` 保持原状态；`completedAt` 必须为 null | session 创建与 task CAS 同事务；若 task CAS 或 active-session index 冲突，session 不创建 |
| complete | `TODO`、`IN_PROGRESS`、`DEFERRED` | `DONE / NONE`，`completedAt=now`，plannedDate 不变 | 一次 AuditEvent、一次 complete TaskDebtEvent、刷新原 plannedDate |
| defer | `TODO`、`IN_PROGRESS`、`DEFERRED`，且 `completedAt=null` | `DEFERRED / ACCEPTABLE`，更新 plannedDate，`completedAt` 保持 null | 一次 AuditEvent/defer event，刷新旧/新 plannedDate |
| drop | `TODO`、`IN_PROGRESS`、`DEFERRED`，且 `completedAt=null` | `SKIPPED / NONE`，plannedDate 不变，`completedAt` 保持 null | 一次 AuditEvent/drop event，刷新原 plannedDate |
| recover | `TODO`、`IN_PROGRESS`、`DEFERRED`、`SKIPPED`；不允许 `DONE` | `TODO / ACCEPTABLE`，更新 plannedDate，清空 `completedAt` | 一次 AuditEvent/recover event，刷新旧/新 plannedDate |
| split | `TODO`、`IN_PROGRESS`、`DEFERRED`；不允许终态 | 父任务变为 `DEFERRED / ACCEPTABLE`，新子任务为 `TODO / ACCEPTABLE` | 子任务创建、父任务 CAS、AuditEvent、split event 和 CheckIn 必须同事务；CAS 失败回滚子任务 |
| convert-review | `TODO`、`IN_PROGRESS`、`DEFERRED`、`SKIPPED`；不允许 `DONE` | type=`review`、`TODO / ACCEPTABLE`，更新日期/时长并清空 `completedAt` | 一次 AuditEvent/convert_review event，刷新旧/新 plannedDate |
| simulation complete | legacy `type=simulation_exam` 且来源为 `TODO`、`IN_PROGRESS`、`DEFERRED` | 与 complete 相同；结构化 `SimulationExam` 不借此入口改状态 | 与 complete 相同，不重复写模拟结果 |
| debt reorder application | 当前重新计算建议中的非终态 task，且 status/debtStatus/plannedDate/updatedAt 与建议 preimage 一致 | 只执行用户选中的建议目标 | 小批量事务任一 CAS 失败则整体回滚；不得保留部分 reorder event |
| metadata PATCH | `TODO`、`IN_PROGRESS`、`DEFERRED`；不允许改变 status/debtStatus/completedAt | 只改 title/type/priority/date/estimate/review 等允许字段 | plannedDate 变化时刷新旧/新日期；不写 TaskDebtEvent |

同终态或重复请求不作为幂等成功返回；没有独立命令幂等账本时必须返回 409，避免调用者误认为副作用再次执行。
需要重新执行的用户动作必须重新读取当前状态并形成新的明确请求。

每个 task 命令必须：

1. 在同一事务读取 status、debtStatus、updatedAt 和计算副作用需要的字段。
2. 验证该命令允许的来源状态。
3. 以读取值作为 CAS 谓词；CAS 失败返回 `TASK_STATE_CONFLICT`。
4. CAS 成功后才写 AuditEvent、TaskDebtEvent、子任务、CheckIn 或其他派生状态。
5. split 可以先创建子任务再 CAS 父任务，但 CAS 失败必须抛错，使整个事务回滚并删除本事务内子任务。

## 结束计时副作用顺序

`endStudySession` 的事务顺序固定为：

1. 读取 session 并计算 closeout。
2. 对 session 执行 active -> completed CAS。
3. CAS 失败立即抛出 `SESSION_STATE_CONFLICT`，不执行后续写入。
4. 累加关联 task 和 syllabus minutes；需要完成 task 时使用同一事务内的 task CAS。
5. 写 TaskDebtEvent 和 AuditEvent。
6. 按学习日升序获取 CheckIn advisory transaction lock，重新聚合并 upsert 快照。
7. 提交事务并返回最终 session。

锁顺序必须稳定；锁内不执行网络、AI、文件 IO、外部命令或可重入回调。该原则参考 AreaMatrix 的锁顺序约束，但实现保持 PostgreSQL/Prisma 原生。

## CheckIn 串行化

需要刷新一个或多个学习日时：

- 使用 `getStudyDayRange(value)` 得到 Asia/Shanghai 学习日 `day.key=YYYY-MM-DD` 和 `day.start`；
- 按 `day.start` 升序去重，不能按调用参数原始顺序取锁；
- 使用 PostgreSQL 双 int32 advisory key：namespace 固定为 `1095123785`（ASCII `AFCI`），第二个 key 为
  `Number(day.key.replaceAll("-", ""))`，即 `YYYYMMDD`；调用形态固定为
  `pg_advisory_xact_lock(1095123785, YYYYMMDD)`；
- 不使用 JS `Number` 承载任意 64-bit hash，不复用 RecoveryState 的锁 key，也不依赖 PostgreSQL
  `hashtext/hashtextextended` 的版本实现；
- 在读取 session/task/review 聚合之前先获锁，获锁后重新读取并 upsert；
- 锁随事务提交或回滚自动释放。

该锁只保护 CheckIn 派生快照，不替代 session 唯一索引或 task/session CAS。

## API 冲突

稳定映射：

- active session 唯一索引冲突：`ACTIVE_SESSION_EXISTS` / 409；
- session CAS 失败：`SESSION_STATE_CONFLICT` / 409；
- task CAS 失败或来源状态不允许：`TASK_STATE_CONFLICT` / 409；
- debt reorder 任一所选任务冲突：整个小批量事务回滚，并返回 `TASK_STATE_CONFLICT` / 409。

不得把 Prisma `P2002`、`P2025`、数据库 URL、SQL、对象 ID 列表或原始异常正文直接返回客户端。

## 本地验证

确认后必须在隔离 PostgreSQL 临时库完成：

- 两个并发 start 只有一个成功，另一个 409，数据库 active count=1。
- pause/resume/end 交错时只有合法状态转换成功，completed session 不会复活。
- 两个并发 end 只有一个成功；task/syllabus minutes、AuditEvent、TaskDebtEvent 和 CheckIn 只增加一次。
- complete/defer/drop/recover/split/convert/simulation complete/debt reorder 的冲突请求无部分副作用。
- CheckIn 同日并发刷新后等于事务提交后的真实聚合。
- CheckIn lock key fixture 覆盖 Asia/Shanghai 日界线、输入顺序置换、重复日期和与 RecoveryState key 隔离。
- 合法 migration apply/verify、重复 apply、非法历史数据和 destructive SQL 负向 fixture。
- doctor before/after 只输出聚合、hash 和 safety facts，不输出业务正文或对象标识。
- 实施 gate 必须区分 `local_verified`、`release_ready` 和 `production_confirmation_required`，任何本地 pass 都不能自动开生产门。

命令入口：

```bash
pnpm ops:ops-006:preflight:selftest
pnpm ops:ops-006:preflight:strict
pnpm ops:data-integrity:selftest
pnpm db:generate
pnpm db:validate
DATABASE_URL=<isolated-postgresql-url> pnpm db:migrate:deploy
pnpm check
git diff --check
```

## 生产证据契约

本地 `local_verified` 后不得扩写本 preflight 冒充生产验证。生产阶段使用独立的 `docs/development/ops-006-production-evidence-template.md`、`pnpm ops:ops-006:evidence:validate` 和 `pnpm ops:ops-006:production:preflight`，固定验证：

- matching strict signed Release 和 Release commit 中的 migration/实现 source hash。
- 单独确认的基础 rollout、canonical index 读回、health/authenticated read-only smoke。
- 另行确认的 synthetic concurrency probe：start/end/task CAS 一胜一 409、单次分钟/事件/CheckIn 副作用和同日聚合。
- fresh production before/after doctor、通用 Release evidence、backup hash 和 application rollback target。
- after-doctor 文件 SHA/`doctorHash` 与长期 data-integrity gate 使用的记录完全一致。

`ready_for_ops006_human_review` 只表示证据达到人工复核门槛；不执行 migration/probe，不授权历史修复、restore、DROP index 或 residual 关闭。

## 参考项目取舍

- AreaMatrix：只吸收固定锁顺序、锁内不回调、并发交错测试原则；不复制 Swift actor、UniFFI、Rust runtime 或 SQLite WAL 机制。
- AreaFlow：只吸收 hash-bound migration gate、expected-before/CAS、负向 fixture 和严格证据投影；不复制完整 command engine、worker lease 或 workflow control plane。
- AreaForge 保留现有 TypeScript preflight/doctor/selftest 结构，不新增平台级并发框架。

## 回滚与不证明

- 开发期失败时回滚本次服务代码；隔离临时库可以销毁。
- additive index 若已进入环境，应用回滚时优先保留索引，不执行 DROP；删除索引必须另行确认。
- 本地测试不证明生产 migration、生产历史数据干净、生产并发安全、Release 已创建或 residual 已关闭。
- OPS-006 不处理通用创建请求幂等、附件 staging 或 updater phase journal；这些边界分别继续由后续 residual/任务承接。

## 明确确认句

> 确认执行 OPS-006 业务状态并发一致性本地实施：范围仅限新增“最多一个活跃 StudySession”的 additive migration、task/session expected-status CAS、结束计时事务内单次副作用、同日 CheckIn 事务锁、409 冲突映射、只读 data-integrity doctor 联动和本地 PostgreSQL 并发 selftest；不执行生产 migration deploy、历史数据修复/删除/合并、批量任务修改、多用户迁移、附件改造、updater 改造、Release/tag、服务器命令、secrets 操作或 residual 台账关闭。
