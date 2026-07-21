# OPS-008 Updater Phase Journal 与 Maintenance Hold/Drain 设计

当前状态：`in-progress / local-verified`（G2 已确认并完成本地临时目录验证）。

本文定义 OPS-008 本地实施契约。生产 timer、hold/clear/drain、updater apply、backup/restore、migration 与 Docker/Nginx/compose 切换仍保持 `production_confirmation_required`，不得从本地证据推定授权。

离线/本地 preflight 契约：`OPS-008-PREFLIGHT-CONTRACT-V2`，本地验证证据类 `evidenceClass: local_updater_phase_journal_verified`（确认前候选等级 `runtime_preimage_candidate` 保留为历史语义）。preflight 只读校验并 source-hash 绑定本文、task、OPS-008 高风险确认包、当前 updater/update-agent 脚本、helpers、checked-in phase-journal/maintenance fixtures；提供 `AREAFORGE_OPS008_RUNTIME_RECORD`（由临时目录 kill-point/锁竞争 selftest 生成且未过期）时可达 `local_verified`，否则停留在 `local_validation` 且 strict 必须非零退出。它不证明 journal durability（生产主机持久化），不证明 timer 已停止，也不证明任何生产 updater、队列或切换行为。

gate 生命周期：`implementation_authorized -> local_validation -> local_verified -> release_ready ->
production_confirmation_required`；任何确认过期/撤销、scope/sourceSetHash 漂移、journal corruption 或扩大到
生产 timer/hold/apply 时立即 fail closed。`candidateEvidenceStatus=complete` 不等于生产授权。

## 目标不变量

1. validated、backup、migration、switch、health、smoke 和 terminal/reconciliation 每个阶段都有 durable started/complete 事件。
2. migration 开始前，数据库、uploads、env、compose、Nginx 和 Release assets 备份必须逐文件及逐级父目录 fsync，并写绑定精确 backup inventory 的 backup complete 事件。
3. event 使用不可覆盖的独立文件、连续 sequence、previousEventHash 和 eventHash；聚合 projection 不是源事实。
4. 任一 started 未完成、switch 后 record 写失败或状态无法确认时，自动进入 root-only maintenance hold 和 reconciliation required。
5. hold 生效后，update-agent 不领取新请求、自动 updater run 不开始；已有 claim/锁不被删除或抢占。
6. hold 写入和 claim 领取共用 queue-control lock，消除“观察为空后又领取”的竞态。
7. Web runtime 只能读取 redacted blocker/status，不能创建、清除或绕过 hold。

## 当前风险

- backup 完成后没有持久化屏障就进入 migration。
- switch/health/smoke 崩溃没有阶段证据，重启后可能继续消费队列。
- 切换成功但最终 update record 写失败会被误记为普通失败。
- 两个 Persistent systemd timer 没有统一 hold/drain barrier。
- 当前 checked-in fixture 只证明离线状态链自洽，journalHash 仍不证明 append-only/atomic publish。

## Root-only Journal

建议目录：`$AREAFORGE_OPS_STATE_DIR/updater-journal/<operation-id>/events/`。operation id 只能使用固定长度
lowercase UUID，目录必须 no-clobber 创建并校验 owner、mode、普通目录和非 symlink。

每个事件包含：

- schema version、operation id、sequence、phase、state、reasonCode；每个事件自身重复并 hash 绑定 operation id；
- pre-validation 事件只绑定 candidate tag/release id/manifest asset hash，不把未验证 digest 标记为可信；
  `identity-bound complete` 事件首次绑定已验证 release tag/version、manifest SHA256/version、web/migration
  immutable digest，后续事件必须逐字段完全一致；image 内嵌 tag 必须等于 release tag；
- `sourceKind`、redacted `source`；`sourceKind=request` 时必须同时携带 `requestId` 和 `requestHash`，automatic/operator 来源的 request 字段必须为 `null`；
- `executionAttempted`、`previousEventHash`、`eventHash`、规范 UTC `createdAt`；同一 operation 内 `createdAt` 必须按 sequence 严格递增；
- `beforeStateHash`；backup complete 额外绑定 relative `backupSetId` 与 `backupInventoryHash`，terminal complete
  额外绑定 `updateRecordHash` 和最终 production identity hash；无对应对象时字段必须为 null；
- 不包含 secret、数据库 URL、绝对路径或原始命令输出。

发布协议：

1. no-clobber 创建 operation 目录和 events 子目录，`chmod 700`，依次 `fsync` events、operation、
   updater-journal 和 ops-state 父目录；任一级不确定都不得开始副作用。
2. 在 events 同目录创建临时文件，`chmod 600`。
3. 写入完整 JSON，`fsync` 文件。
4. 用 hard-link/no-clobber 或等价原子方式发布最终 sequence 文件。
5. `fsync` events 目录；临时文件清理失败只报告，不覆盖已发布事件。
6. 更新 redacted projection 时使用 temp + fsync + rename + directory fsync。

任何 operation 目录冲突、sequence 重复、hash chain 断裂、未知字段/阶段、owner/mode/symlink 异常、逐级目录
fsync 不确定、既有事件内容冲突或 scan error 都进入 reconciliation；扫描失败本身就是全局 admission blocker，
不能按“没有 journal”继续消费队列。

## 阶段与崩溃语义

合法状态机必须覆盖阶段内和阶段之间的 kill point：

| 阶段 | 合法事件 | 完成后下一步 | 中断/失败语义 |
| --- | --- | --- | --- |
| admission | `operation-created complete` | validation | 事件或逐级 fsync 失败时零副作用退出；无 journal 不允许继续 |
| validation | `candidate started`、`identity-bound complete` | backup | started 无 complete、候选/验证 identity 漂移均 hold/reconciliation |
| backup | `started`、`complete` | prepare | complete 必须绑定 durable backup inventory；只证明持久化，不证明 DB/uploads 一致快照 |
| prepare/config | `started`、`complete` | migration | compose/env 候选写入、fsync 和 beforeStateHash 在此记录；不得偷偷发生在 migration 事件之前 |
| migration | `started`、`complete` 或 `skipped` | switch | 无 migration image 时显式 skipped；started 无 complete 时数据库状态未知，必须 hold |
| switch | `started`、`complete` | health | env/container 状态未知时 hold，不自动重复切换 |
| health | `started`、`complete` | smoke | 中断时应用可能已切换，hold |
| smoke | `started`、`complete` | terminal | 中断时 hold，不自动重放写入型 smoke |
| rollback | `started`、`complete`、`needs_reconciliation` | terminal | 仅表达应用镜像/env 回退；数据库/uploads restore 仍需独立确认 |
| terminal | `started`、`applied`、`rolled_back`、`rejected`、`needs_reconciliation` | none | terminal 只有 update record、projection 和目录均 durable 后完成；绑定 updateRecordHash |

阶段 complete 后、下一阶段 started 前被杀也属于合法非终态前缀，scanner 追加 reconciliation event 时不得伪造
一个未发生的 started。切换后 update record 或 terminal journal 写失败使用专用 reconciliation exit code，agent 不记录
普通 rejection，也不重放 apply。

重启扫描到任一非终态、corrupt 或不可完整扫描 journal 时不得自动继续阶段或回滚数据库/uploads；journal 自身
直接阻塞所有 mutation admission，并尽力发布 redacted hold/blocker 等待人工 reconciliation。

## Maintenance Hold/Drain

hold 采用 append-only event + active projection，而不是覆盖/删除单个布尔文件。每个 hold/clear event 包含 holdId、
严格递增 generation、reasonCode、createdAt、source、可选 operationId、lastJournalEventHash、previousHoldEventHash
和 eventHash；active projection 只是一份可重建的 redacted 状态。

- 所有入口的锁顺序固定为 `queue-control -> production-state -> agent-local`；禁止反向获取。queue-control 只覆盖
  admission/claim/hold generation CAS，不跨下载、备份、migration、Docker 或 smoke 长时间持有。
- root helper 获取 queue-control lock 后发布 hold event/projection，并在释放前再次扫描 processing/journal。
- update-agent 在同一 queue-control lock 内检查 active hold、journal scanner 和 request preimage 后才允许 atomic claim；
  claim 后在最终副作用边界仍需 production-state lock 和 OPS-005 expected-before guard。
- automatic updater 与 operator updater 都必须经过同一 admission barrier；本地第一版不提供 `--override-hold`。
- drain 在 hold 已发布后观察 active processing claim 和 production-state lock：
  - 都为空闲才返回 drained；
  - 有 active claim 时返回 waiting，保留 claim，不 kill、不删除；
  - timer 是否停止是单独 systemd 事实，不能由 fixture 自声明。
- clear 必须提供 expected holdId/generation/lastEventHash CAS，验证无 reconciliation-required journal、目标
  production identity 已人工确认，并追加 clear event；不能删除历史 hold。clear 后，所有在旧 generation 前创建的
  mutation request 必须拒绝或隔离，不能静默复用旧确认。Web 无权限。

## 确认前 Fixture

- `ops008-preconfirmation.json`：完整 started/complete phase chain、terminal applied、event hash chain 和 journal hash。
- `ops008-migration-kill-point-reconciliation.json`：migration started 后中断，保留完整前缀并进入 reconciliation_required。
- `ops008-switch-kill-point-reconciliation.json`：switch started 后中断，保留完整前缀并进入 reconciliation_required。
- `ops008-terminal-kill-point-reconciliation.json`：terminal started 后中断，保留完整前缀并进入 reconciliation_required。
- `ops008-hold-drain-preconfirmation.json`：root-only hold、禁止新 claim/automatic run、保留队列、无 active claim 才 drained。
- `ops008-hold-waiting-preconfirmation.json`：active claim/production-state lock 尚忙时只返回 waiting，claim 保留且不删除。
- `ops008-hold-lock-waiting-preconfirmation.json`：没有 active claim 但 production-state lock 仍 busy 时返回独立 waiting 状态，不误报 drained。

上述 phase-journal fixture 均明确 `executionAttempted=false`，kill-point 文件是 report-only reconciliation 声明，不调用 updater、Docker、systemd、timer、queue 或服务器命令。hash chain 和时间/身份检查只证明 fixture 自洽，不证明生产 append-only durability，也不证明 hold/claim queue-control lock 顺序或并发排他；后者只由确认后的真实锁竞争 selftest 证明。确认后必须补充 operation-parent fsync、阶段间 kill、no-migration、prepare/config、rollback、corrupt/duplicate event、hold publish/clear crash、generation CAS、旧请求隔离和 agent decision-history failure fixture。

## 确认后验证

- 临时目录 kill-point：backup/migration/switch/health/smoke 每阶段 started 后中断，重启均进入 hold/reconciliation。
- backup fsync 注入失败时 migration/Docker 未执行。
- event no-clobber、sequence/hash chain、event/directory fsync failure 和 projection 原子替换。
- queue-control lock 竞争：hold 与 claim 并发时不能在 hold 后产生新 claim。
- active claim drain 返回 waiting 且 claim 保留；锁释放后重新检查才 drained。
- switch 成功但 update record/journal terminal 写失败时 agent 映射 reconciliation required。
- 所有 runtime preimage helper、service/timer unit、validator/preflight 都进入同一 `sourceSetHash`；CI 必须运行
  当前 checkout 的 non-strict preflight，而不只运行 selftest。
- shellcheck、updater preflight、OPS-005 V2 selftest、正式 CI/Release validate job。

## 回滚与不证明

- 本地失败时回滚 journal/hold 代码并删除临时 fixture 目录。
- 生产已存在 journal 时不得删除历史事件；回滚应用后保留 journal 和 hold，clear 另行确认。
- 本地 fixture 不证明 timer 已停、生产队列已 drain、backup/migration/switch 成功或 residual 已关闭。
- maintenance hold 只停止 updater admission，不停止 Web 数据库或上传写入；backup complete 只证明该 backup
  set 已 durable，不证明数据库与 uploads 是一致快照。一致快照或应用停写必须独立高风险确认。

## 明确确认句

> 确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施：范围仅限 root-only no-clobber/逐级 fsync immutable hash-chained phase events、精确 backup inventory 持久化屏障、admission/identity-bound/backup/prepare/migration-or-skipped/switch/health/smoke/rollback/terminal/reconciliation 状态机、崩溃后 fail-closed hold、固定 queue-control -> production-state -> agent-local 锁顺序、hold generation/clear CAS、旧 generation 请求隔离、record/journal 失败的 reconciliation exit mapping、redacted status、扩展 sourceSetHash 和本地临时目录 kill-point/锁竞争 selftest；不执行生产 updater apply、Web apply/rollback 请求、systemd timer 启停、生产 hold/clear/drain、backup/restore、migration、Docker/Nginx/compose 切换、自动应用策略变化、服务器命令、secrets 操作、Release/tag 或 residual 台账关闭。
