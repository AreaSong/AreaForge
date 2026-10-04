recordId: residual-review-AF-RISK-OPS-004-20260721
reviewedAt: 2026-07-21T13:35:00+08:00
reviewer: Codex maintenance review (v0.1.9 G6)
residualRiskId: AF-RISK-OPS-004
currentResidualType: monitoring-gap
reviewDecision: keep-open
decisionRationale: Local alert preview for v0.1.9 runs with status warning and lacks a matching server-side receiver/timer drill for the current production version. Historical v0.1.7 drill remains reference-only. Keep open until a current-version drill reaches ready_for_human_close.
evidenceUris: docs/development/ops-004-alert-preview-v0.1.9-20260721.json,docs/development/ops-004-alert-preview-v0.1.9-20260721-gap-note.txt
validatorCommands: pnpm ops:alert:preview; pnpm ops:ops-004:preflight; pnpm residuals:closure:validate docs/development/residual-closure-review-20260721-ops-004.md
validatorOutcome: keep-open
validatorSummary: pnpm ops:alert:preview status=warning; ops:ops-004:preflight blocked / keep-open without matching v0.1.9 drill
reopenConditions: new release, stale evidence, alert threshold change, missing drill freshness, validation failure
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
