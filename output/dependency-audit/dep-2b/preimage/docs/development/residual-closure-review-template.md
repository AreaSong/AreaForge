# Residual 人工复核记录模板

## 目标

本模板用于记录维护者对单个 `AF-RISK-*` 残余项的人工复核结论。它只形成可校验的复核记录，不自动修改 `docs/development/residual-risk-ledger.md` 或 `docs/development/residual-risk-ledger.json`。

适用场景：

- `pnpm ops:ops-001:preflight` 返回 `ready_for_human_close` 后，维护者复核 `AF-RISK-OPS-001`。
- `pnpm ops:ops-004:preflight` 返回 `ready_for_human_close` 后，维护者复核 `AF-RISK-OPS-004`。
- `pnpm sc:sc-002:preflight` 返回 `ready_for_sc001_sc002_review` 后，维护者复核 `AF-RISK-SC-001` / `AF-RISK-SC-002`。
- 维护窗口中决定某个残余项继续保留、降级、重新打开或准备单独更新台账。

校验入口：

```bash
pnpm residuals:closure:validate <residual-closure-review-record.md|txt>
```

该校验只检查复核记录字段、证据 URI、validator 摘要、重新打开条件、`doesNotProve`、`closesResidual=no` 和只读 `safetyFacts`。它不执行 validator、不读取证据正文、不连接生产、不读取密钥、不执行服务器命令、不更新 residual 台账。

## 模板

```text
recordId: residual-review-<AF-RISK-ID>-<YYYYMMDD>
reviewedAt: <ISO timestamp with timezone>
reviewer: <maintainer or review group>
residualRiskId: <AF-RISK-OPS-001>
currentResidualType: current-blocker/deferred-work/accepted-exception/monitoring-gap/release-follow-up/historical-reference/template-marker/closed-evidence
reviewDecision: close/keep-open/downgrade/reopen
decisionRationale: <why this decision is justified by the evidence>
evidenceUris: <repo-relative record path or sha256 digest list>
validatorCommands: <pnpm ... commands used for the review>
validatorOutcome: pass/ready-for-human-close/ready-for-ledger-update/ready-for-sc001-sc002-review/keep-open/blocked/fail/invalid
validatorSummary: <pass / ready_for_human_close / ready_for_sc001_sc002_review / blocked / fail / invalid summary>
reopenConditions: new release, stale evidence, validation failure, production version change
doesNotProve: residual ledger closure, production health, updater apply, backup/restore, migration, rollback
residualLedgerAction: none/requires-separate-ledger-update
closesResidual: no
result: ready-for-ledger-update/keep-open/blocked/invalid
safetyFacts:
  productionWriteAttempted: no
  serverCommandAttempted: no
  backupRestoreAttempted: no
  migrationAttempted: no
  updaterApplyAttempted: no
  rollbackAttempted: no
  releaseCreated: no
  secretValuePrinted: no
  residualLedgerUpdated: no
```

## 判定规则

- `reviewDecision: close` 只表示维护者准备关闭或已形成关闭建议；记录本身必须保持 `closesResidual: no`，且 `residualLedgerAction: requires-separate-ledger-update`。
- `reviewDecision: keep-open` 必须保持 `residualLedgerAction: none` 和 `result: keep-open`。
- `residualRiskId` 必须存在于权威 Schema V2 residual ledger，`currentResidualType` 必须与台账一致；`close` 只接受明确的正向 `validatorOutcome`。
- `evidenceUris` 只能使用仓库相对路径、HTTPS URL 或 `sha256:<64 hex>` 摘要；不得写服务器绝对路径、`.env`、密码文件、token、私钥、生产原始日志或备份归档路径。
- 仓库相对 evidence 必须真实存在且是仓库内普通非 symlink 文件；记录中的顶层字段和 `safetyFacts` 字段不得重复。
- `validatorCommands` 必须列出复核时运行的 `pnpm ...` 校验命令；复核记录 validator 不会替你执行这些命令。
- `doesNotProve` 必须明确本记录不能证明 residual 台账已关闭、生产健康、updater apply、backup/restore、migration 或 rollback。
- 如需真正更新 residual 台账，必须另起一次明确的台账更新变更，并运行 `pnpm residuals:validate`、相关专项 validator 和文档同步检查。
