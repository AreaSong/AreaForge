recordId: residual-review-AF-RISK-SC-004-20260720
reviewedAt: 2026-07-20T20:47:00+08:00
reviewer: Codex maintenance review
residualRiskId: AF-RISK-SC-004
currentResidualType: current-blocker
reviewDecision: keep-open
decisionRationale: reviewAt 2026-07-18 has expired. The 2026-07-18 ruleset readback and controlled PR records remain valid historical facts, but running pnpm sc:sc-004:preflight against them today returns invalid because their freshness windows are stale, and the final close/keep-open call is a maintainer human decision that has not been made. Keep the item open pending a fresh maintenance-window readback and an explicit maintainer decision.
evidenceUris: tasks/backlog/0023-github-main-protection.md,output/supply-chain/github-main-protection-readback-20260718.json,output/supply-chain/github-main-protection-controlled-pr-20260718.json
validatorCommands: AREAFORGE_SC004_READBACK_RECORD=output/supply-chain/github-main-protection-readback-20260718.json AREAFORGE_SC004_CONTROLLED_PR_RECORD=output/supply-chain/github-main-protection-controlled-pr-20260718.json pnpm sc:sc-004:preflight; pnpm residuals:closure:validate docs/development/residual-closure-review-20260720-sc-004.md; pnpm residuals:validate
validatorOutcome: invalid
validatorSummary: pnpm sc:sc-004:preflight with the 2026-07-18 readback and controlled PR records returned invalid due to stale freshness; a fresh redacted readback in a new maintenance window is required before any maintainer close decision
reopenConditions: new release, ruleset or required-check or workflow change, stale evidence beyond the freshness window, validation failure
doesNotProve: residual ledger closure, production health, updater apply, backup/restore, migration, rollback
residualLedgerAction: none
closesResidual: no
result: keep-open
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
