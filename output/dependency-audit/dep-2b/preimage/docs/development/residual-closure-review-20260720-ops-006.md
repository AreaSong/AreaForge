recordId: residual-review-AF-RISK-OPS-006-20260720
reviewedAt: 2026-07-20T23:56:00+08:00
reviewer: Codex maintenance review
residualRiskId: AF-RISK-OPS-006
currentResidualType: current-blocker
reviewDecision: keep-open
decisionRationale: reviewAt 2026-07-22 is reviewed ahead of expiry inside the 2026-07-20 long-term operations round. The canonical partial unique index, session/task CAS, single end-session side effect and CheckIn advisory lock remain implemented in the current checkout, but pnpm ops:ops-006:preflight:strict currently returns status local_validation with the strict gate blocked because the isolated doctor/runtime evidence bindings are missing at the current head and must be regenerated against the release candidate commit. Closing still requires a matching signed release, an independently confirmed production migration and rollout, a separately confirmed controlled synthetic concurrency probe and fresh production doctor evidence, none of which exist yet; the v0.1.8 candidate is being re-formed and no signed release exists at review time, so the item stays current-blocker.
evidenceUris: docs/development/ops-006-business-state-concurrency-design.md,tasks/active/0020-business-state-concurrency.md,docs/development/ops-006-production-evidence-template.md
validatorCommands: pnpm ops:ops-006:preflight:strict; pnpm residuals:closure:validate docs/development/residual-closure-review-20260720-ops-006.md; pnpm residuals:validate
validatorOutcome: blocked
validatorSummary: pnpm ops:ops-006:preflight:strict returned status local_validation with strictGate blocked because doctor and runtime evidence bindings are missing at the current head; closure remains blocked on a matching signed release plus independently confirmed production migration, rollout, controlled probe and fresh production doctor evidence
reopenConditions: new release, production deployment of the concurrency protection, stale evidence beyond the freshness window, validation failure
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
