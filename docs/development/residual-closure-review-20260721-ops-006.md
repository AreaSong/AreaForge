recordId: residual-review-AF-RISK-OPS-006-20260721
reviewedAt: 2026-07-21T13:35:00+08:00
reviewer: Codex maintenance review (v0.1.9 G6)
residualRiskId: AF-RISK-OPS-006
currentResidualType: current-blocker
reviewDecision: keep-open
decisionRationale: Matching signed Release v0.1.9 is applied in production with migrations including StudySession_one_active_idx. Controlled synthetic concurrency probe PASSED (start ACTIVE_SESSION_EXISTS, end SESSION_STATE_CONFLICT, taskCas TASK_STATE_CONFLICT, sideEffects single-application, checkIn aggregate, cleanup pass) with fresh after-probe doctors. Full pnpm ops:ops-006:evidence:validate remains blocked because no pre-deploy full data-integrity doctor exists (timestamp sequence requires before-doctor before deploy) and OPS-002 write smoke fields required by release-evidence binding were intentionally excluded from this window. Keep open until a future maintenance captures a full before-doctor before deploy or policy/validator adjustment is explicitly approved.
evidenceUris: docs/development/ops-006-production-evidence-v0.1.9-20260721/ops-006-production-evidence-v0.1.9-20260721.txt,docs/development/ops-006-production-evidence-v0.1.9-20260721/rollout-v0.1.9.json,output/release-v0.1.9/ops006-prod-evidence/controlled-probe-runtime.json,docs/development/release-v0.1.9-record.md,docs/development/release-supply-chain-v0.1.9.md
validatorCommands: pnpm ops:ops-006:confirmation-scopes docs/development/ops-006-production-evidence-v0.1.9-20260721/ops-006-production-evidence-v0.1.9-20260721.txt; pnpm ops:ops-006:evidence:validate docs/development/ops-006-production-evidence-v0.1.9-20260721/ops-006-production-evidence-v0.1.9-20260721.txt docs/development/release-supply-chain-v0.1.9.md output/release-v0.1.9 docs/development/release-v0.1.9-record.md docs/development/ops-006-production-evidence-v0.1.9-20260721/attachment-reconciliation.csv docs/development/ops-006-production-evidence-v0.1.9-20260721/attachment-reconciliation-summary.json; pnpm residuals:closure:validate docs/development/residual-closure-review-20260721-ops-006.md
validatorOutcome: blocked
validatorSummary: controlled probe and probe-window doctors pass; evidence:validate fails canonical timestamp order (before-doctor after deploy) and release smoke binding for write paths excluded by plan
reopenConditions: new release, production redeploy without doctor sequence, stale evidence, validation failure
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
