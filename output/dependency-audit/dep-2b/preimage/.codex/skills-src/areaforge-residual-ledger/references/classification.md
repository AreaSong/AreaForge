# Residual Classification

## Types

| Type | Meaning | Current task? |
|---|---|---|
| current-blocker | Prevents the stated goal or release from completing | yes |
| deferred-work | Intentionally postponed with a revisit trigger | no, unless reactivated |
| accepted-exception | Known risk accepted for a stated scope | no |
| monitoring-gap | Missing evidence or alerting for an operational claim | maybe |
| release-follow-up | Post-release work tied to a version or update | maybe |
| historical-reference | Old record that still mentions past limitations | no |
| template-marker | Placeholder in a template or draft record | no |
| closed-evidence | Completed item retained for audit | no |

## Reporting Format

Report each item as:

- id or short label
- type
- source file and line when available
- impact
- executable now: yes/no
- reviewAt / 复核时间
- close condition
- required evidence
- owner skill or owner document

Use stable IDs from `docs/development/residual-risk-ledger.md` for items that affect future release, production ops, security, supply chain, AI, or user-experience decisions.
Keep `docs/development/residual-risk-ledger.json` and `tasks/indexes/residuals.md` synchronized with the Markdown table and run `pnpm residuals:validate` after residual status changes. Use `pnpm residuals:review-due` during maintenance windows to list overdue or due-soon `reviewAt` items without modifying the ledger.

## Close Conditions

- Current blockers require direct evidence from tests, runtime behavior, release record, or source docs.
- Deferred work requires a review date and revisit trigger, not just a vague "later".
- Accepted exceptions require rationale, scope, review date, and a condition that would reopen the item.
- Historical and template markers should remain indexed but not counted as live blockers.

## AreaForge Sources

Primary places where residuals currently appear:

- `docs/development/docs-100-completion-record.md`
- `docs/development/validation-matrix.md`
- `docs/development/production-release-runbook.md`
- `docs/development/operational-readiness.md`
- `docs/development/residual-risk-ledger.md`
- `docs/development/residual-risk-ledger.json`
- `tasks/indexes/residuals.md`
- `tasks/**`
- `workflow/**`
- release records under `docs/development/**`
