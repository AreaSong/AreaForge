# 受保护路径审阅记录模板

本模板用于在工作区有既存改动、治理/Release/Ops 路径将被触及，或需要交接人类审阅结论时，
保存一个可脱敏的审阅边界。它不是 `git status` 的替代，也不会自动修改、暂存或提交任何文件。

记录完成后运行：

```bash
pnpm governance:protected-path-review:validate <protected-path-review-record.md|txt>
```

建议先运行 `pnpm ops:status > /tmp/areaforge-operability-status.json`，从 `sourceSnapshot.protectedPathFingerprint`
记录 `protectedPathScope` 和 `protectedPathFingerprint`；`worktreeStatusHash` 只记录 `git status --short`
文本的 sha256，不包含文件内容、密钥或未脱敏 diff。

## 模板

```text
recordId: protected-path-review-<date-or-release>
reviewedAt: <ISO-8601 timestamp>
reviewer: <maintainer or review group>
reviewScope: <why this review is needed and which paths are in scope>
sourceCommit: <7-64 hex git commit>
worktreeState: clean/dirty-reviewed
worktreeStatusHash: sha256:<64-hex>
protectedPathScope: read_only_side_effect_guard_inputs
protectedPathFingerprint: sha256:<64-hex>
protectedPaths: README.md, package.json, docs/development/long-term-operability-control-plane.md
reviewCommand: git status --short; pnpm ops:status; pnpm governance:preflight
reviewDecision: pass/follow-up-required/block
findings: <specific result; use none only when worktreeState is clean>
followUpRefs: <repo-relative docs/tasks/workflow refs or none>
doesNotProve: production health; all repository paths were reviewed; git worktree cleanliness after review; updater apply; backup/restore; migration; rollback; residual ledger closure
result: reviewed/follow-up-required/blocked
safetyFacts:
  productionWriteAttempted: no
  serverCommandAttempted: no
  backupRestoreAttempted: no
  migrationAttempted: no
  updaterApplyAttempted: no
  rollbackAttempted: no
  secretValuePrinted: no
  residualLedgerUpdated: no
```

## 记录规则

- `dirty-reviewed` 时 `findings` 不能是 `none`，`followUpRefs` 必须指向可追踪的 docs、tasks 或 workflow 项。
- `clean` 时可以使用 `findings: none` 和 `followUpRefs: none`，但仍不得把记录当成后续工作区保持干净的证明。
- `protectedPathFingerprint` 绑定 `pnpm ops:status` 的只读 protected path 集合；它不覆盖所有仓库文件。
- `reviewDecision: pass` 只允许 `result: reviewed`；`follow-up-required` 与 `block` 必须保留非空 follow-up。
- 记录不得包含 `.env`、密码、token、私钥、数据库 URL、cookie、完整 diff、完整 prompt/response 或真实学习内容。
