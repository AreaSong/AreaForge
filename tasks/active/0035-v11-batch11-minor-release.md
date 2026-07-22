# v1.1 Batch 11 完整 minor Release

```yaml
status: in-progress
phase: awaiting-signed-release
blockers:
  - signed-release-confirmation
risk: high
ownerSkill: areaforge-release-operator
validation:
  - pnpm release:train:preflight
  - pnpm governance:preflight
  - pnpm ops:v11:compatibility-floor:runtime:selftest
residualRiskIds:
  - AF-RISK-SC-002
  - AF-RISK-SC-004
  - AF-RISK-DATA-001
releaseRequired: true
```

## 目标

本地完成记录与完整验证候选 → complete minor Release admission → 签名 minor Release。生产 backup/migration/apply/smoke/rollback 分别确认。不自动关闭 residual。

## 当前执行范围

- 目标版本：`1.1.0`。
- 已确认前置：Batch 10 完成；完整 Migration Gate 与 OPS-006/007 independent production apply 证据齐全。
- 本任务当前已获授权补齐本地完成记录、统一版本、完整验证候选、候选 commit、push、matching CI 与 SC-002/SC-004 Release admission 证据。
- 候选 commit 冻结后，SC-002/SC-004 必须按该 commit 重采；`v0.1.9` 或更早证据不得替代。
- 签名 Release 确认句、tag、GitHub Release、生产 backup/migration/apply/smoke/rollback 均不在当前授权内。
- `AREAFORGE_AUTO_APPLY=none` 保持不变；任何 residual 状态都不自动关闭。
- 本地 compatibility floor probe 已通过，证据见 `docs/development/v11-compatibility-floor-evidence-20260722.md`；签名 Release 仍须固定 floor image digest。
- `9ac4c413…` 的 GitHub run `29887252667` 在 full dependency audit 失败；`397636d9…` 的 run `29888908012` 通过两个 audit 后在 operability scripts typecheck 暴露旧 OPS-006 Subject fixture；`3a6c69a2…` 的 run `29889321859` 暴露 SC-004 临时目录随机禁词夹具；`004bce66…` 的 run `29889778535` 继续暴露 residual reciprocal taskRef 缺口。上述阻断均已修复；`094c564d9860c8211954196f50b833fd773c20fc` 的 matching CI run `29890052716` 已成功，最终 evidence-only 候选仍须取得 matching CI 与 SC-002/SC-004 exact-commit 证据。

## Admission 判定

complete minor Release admission 达到 `READY-FOR-SIGNED-RELEASE` 前，以下输入必须匹配同一最终 evidence-only 候选 commit：

- SC-002 CI-only 或签名 Release 供应链证据重采并通过对应 validator；
- SC-004 main protection readback 与 controlled PR 证据重采并通过 validator；
- package version 与候选 commit 身份一致，且本地 Release train / governance 门禁通过。

本会话已授权为补齐 admission 执行候选 commit、push、matching CI 与受控 PR；仍不授权 tag、GitHub Release、production apply、backup/restore、migration deploy、updater apply/rollback 或 residual ledger update。签名 Release 必须另贴明确确认句后才可执行。
