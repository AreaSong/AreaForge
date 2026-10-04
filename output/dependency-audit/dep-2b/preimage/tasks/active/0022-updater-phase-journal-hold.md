# Updater 阶段日志与维护 Hold/Drain

```yaml
status: in-progress
phase: local-verified
blockers:
  - production_confirmation_required
  - signed Release and independent production timer/hold/apply confirmation
risk: high
ownerSkill: areaforge-sre-ops
evidenceClass: local_updater_phase_journal_verified
preflightContract: OPS-008-PREFLIGHT-CONTRACT-V2
validation:
  - pnpm ops:ops-008:runtime:selftest --output output/ops008/updater-runtime-20260721.json
  - pnpm ops:ops-008:runtime:validate output/ops008/updater-runtime-20260721.json
  - AREAFORGE_OPS008_RUNTIME_RECORD=output/ops008/updater-runtime-20260721.json pnpm ops:ops-008:preflight:strict
  - pnpm ops:ops-008:preflight:selftest
  - pnpm updater:phase-journal:selftest
  - pnpm updater:maintenance-control:selftest
  - pnpm shellcheck:updater
  - pnpm github-release-updater:preflight
  - pnpm ops:ops-005:local:selftest
residualRiskIds:
  - AF-RISK-OPS-008
releaseRequired: true
```

目标：增加 root-only append-only/atomic updater phase journal，并提供只允许服务器运维控制的 hold/drain，
在维护窗口停止领取新请求、保留当前 claim 和阶段证据。Web runtime 不获得服务器命令或 hold 写权限；
生产 timer、队列和 updater 策略变化仍需单独确认。

## 本地已完成范围（G2 已确认）

- `ops/update-agent/lib/updater-phase-journal.sh`：no-clobber operation、hash-chained events、逐级 fsync、scanner fail-closed。
- `ops/update-agent/lib/updater-maintenance-control.sh`：queue-control 锁、append-only hold/clear CAS、drain 只观察、旧 generation 请求隔离。
- `ops/update-agent/areaforge-updater-maintenance.sh`：root-only hold/clear/drain/status CLI。
- updater/update-agent 接入 admission barrier、phase events、backup inventory 屏障、reconciliation exit mapping。
- 临时目录 kill-point / fsync 失败 / 锁竞争 / drain / stale-request runtime selftest 已通过。

## Preflight 契约

确认后离线/本地 preflight 契约为 `OPS-008-PREFLIGHT-CONTRACT-V2`，`evidenceClass: local_updater_phase_journal_verified`。
`pnpm ops:ops-008:preflight` 绑定 task/design/确认包/runtime 脚本与 checked-in fixtures 的 SHA-256；
提供 `AREAFORGE_OPS008_RUNTIME_RECORD`（fresh 临时目录 runtime record）时 strict 可达 `local_verified`。
该证据只证明当前 checkout 的本地实现与临时目录验证，不证明签名 Release、生产 timer/hold/apply 或 residual 关闭。
未提供 runtime record 时停留在 `local_validation`，strict 必须非零退出。

## 确认句

> 确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施：范围仅限 root-only no-clobber/逐级 fsync immutable hash-chained phase events、精确 backup inventory 持久化屏障、admission/identity-bound/backup/prepare/migration-or-skipped/switch/health/smoke/rollback/terminal/reconciliation 状态机、崩溃后 fail-closed hold、固定 queue-control -> production-state -> agent-local 锁顺序、hold generation/clear CAS、旧 generation 请求隔离、record/journal 失败的 reconciliation exit mapping、redacted status、扩展 sourceSetHash 和本地临时目录 kill-point/锁竞争 selftest；不执行生产 updater apply、Web apply/rollback 请求、systemd timer 启停、生产 hold/clear/drain、backup/restore、migration、Docker/Nginx/compose 切换、自动应用策略变化、服务器命令、secrets 操作、Release/tag 或 residual 台账关闭。
