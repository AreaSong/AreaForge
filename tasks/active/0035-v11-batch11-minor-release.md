# v1.1 Batch 11 完整 minor Release

```yaml
status: in-progress
phase: awaiting-signed-release
blockers:
  - target-commit-sc002-resample
  - target-commit-sc004-resample
  - signed-release-confirmation
risk: high
ownerSkill: areaforge-release-operator
validation:
  - pnpm release:train:preflight
  - pnpm governance:preflight
residualRiskIds:
  - AF-RISK-SC-002
releaseRequired: true
```

## 目标

本地完成记录与完整验证候选 → complete minor Release admission → 签名 minor Release。生产 backup/migration/apply/smoke/rollback 分别确认。不自动关闭 residual。

## 当前执行范围

- 目标版本：`1.1.0`。
- 已确认前置：Batch 10 完成；完整 Migration Gate 与 OPS-006/007 independent production apply 证据齐全。
- 本任务当前只形成本地完成记录、统一版本、完整验证候选与本地候选 commit。
- 候选 commit 冻结后，SC-002/SC-004 必须按该 commit 重采；`v0.1.9` 或更早证据不得替代。
- 签名 Release 确认句、tag、GitHub Release、生产 backup/migration/apply/smoke/rollback 均不在当前授权内。
- `AREAFORGE_AUTO_APPLY=none` 保持不变；任何 residual 状态都不自动关闭。

## Admission 判定

当前本地候选完成后仍为 `NOT-READY`，直到以下输入全部匹配同一目标 commit：

- SC-002 CI-only 或签名 Release 供应链证据重采并通过对应 validator；
- SC-004 main protection readback 与 controlled PR 证据重采并通过 validator；
- complete minor Release 的明确确认句；
- tag、package version、default-branch ancestry 与不可变 Release identity admission 全部通过。

本状态不授权 push、tag、GitHub Release、production apply、backup/restore、migration deploy、updater apply/rollback 或 residual ledger update。
