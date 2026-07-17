# Updater 阶段日志与维护 Hold/Drain

```yaml
status: blocked
phase: awaiting-high-risk-confirmation
blockers:
  - explicit OPS-008 phase journal confirmation
  - separate hold/drain production-boundary confirmation
risk: high
ownerSkill: areaforge-sre-ops
evidenceClass: runtime_preimage_candidate
preflightContract: OPS-008-PREFLIGHT-CONTRACT-V1
validation:
  - pnpm ops:ops-008:preflight
  - pnpm ops:ops-008:preflight:strict
  - pnpm ops:ops-008:preflight:selftest
  - pnpm updater:phase-journal:selftest
  - pnpm updater:phase-journal:validate scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json
  - pnpm updater:phase-journal:validate scripts/quality/fixtures/update-agent/phase-journal/ops008-migration-kill-point-reconciliation.json
  - pnpm updater:phase-journal:validate scripts/quality/fixtures/update-agent/phase-journal/ops008-switch-kill-point-reconciliation.json
  - pnpm updater:phase-journal:validate scripts/quality/fixtures/update-agent/phase-journal/ops008-terminal-kill-point-reconciliation.json
  - pnpm updater:maintenance-control:selftest
  - pnpm updater:maintenance-control:validate scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-drain-preconfirmation.json
  - pnpm updater:maintenance-control:validate scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-waiting-preconfirmation.json
  - pnpm updater:maintenance-control:validate scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-lock-waiting-preconfirmation.json
  - pnpm shellcheck:updater
residualRiskIds:
  - AF-RISK-OPS-008
releaseRequired: true
```

目标：增加 root-only append-only/atomic updater phase journal，并提供只允许服务器运维控制的 hold/drain，
在维护窗口停止领取新请求、保留当前 claim 和阶段证据。Web runtime 不获得服务器命令或 hold 写权限；
生产 timer、队列和 updater 策略变化仍需单独确认。

checked-in maintenance fixture 同时覆盖 drained 与 waiting 声明，但明确不证明 queue-control lock 顺序或生产并发排他；这些只由确认后的锁竞争 selftest 证明。

详细事件发布、backup fsync barrier、崩溃语义和 queue-control lock 契约见 `docs/development/ops-008-updater-phase-journal-design.md`。

phase-journal checked-in evidence 同时覆盖事件 `sourceKind/source`、request id/hash 条件、`createdAt` 严格单调性，以及 migration/switch/terminal kill-point 的 report-only `reconciliation_required` 前缀；不代表真实 updater 执行或生产持久化。

确认前离线 preflight 契约为 `OPS-008-PREFLIGHT-CONTRACT-V1`，`evidenceClass: runtime_preimage_candidate`。它只对本 task、设计、确认包、当前 updater/update-agent 脚本和 checked-in phase-journal/maintenance fixtures 做只读校验与 source hash 绑定；不证明 journal durability、hold/drain lock 顺序、timer 状态或任何生产行为。task 仍处于 `awaiting-high-risk-confirmation` 时 strict 必须非零退出。

确认前设计进一步固定了 operation 目录逐级 fsync、阶段间 kill/no-migration/prepare/rollback、
`queue-control -> production-state -> agent-local` 锁顺序、hold generation/clear CAS、旧 generation 请求隔离和
完整 runtime sourceSetHash。现有 fixture 仍只是 preimage；上述 runtime 实施必须等待更新后的明确确认句。

## 确认句

> 确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施：范围仅限 root-only no-clobber/逐级 fsync immutable hash-chained phase events、精确 backup inventory 持久化屏障、admission/identity-bound/backup/prepare/migration-or-skipped/switch/health/smoke/rollback/terminal/reconciliation 状态机、崩溃后 fail-closed hold、固定 queue-control -> production-state -> agent-local 锁顺序、hold generation/clear CAS、旧 generation 请求隔离、record/journal 失败的 reconciliation exit mapping、redacted status、扩展 sourceSetHash 和本地临时目录 kill-point/锁竞争 selftest；不执行生产 updater apply、Web apply/rollback 请求、systemd timer 启停、生产 hold/clear/drain、backup/restore、migration、Docker/Nginx/compose 切换、自动应用策略变化、服务器命令、secrets 操作、Release/tag 或 residual 台账关闭。
