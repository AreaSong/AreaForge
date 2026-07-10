---
name: areaforge-residual-ledger
description: "Use when Codex needs to classify, inspect, update, or report AreaForge residual risks, blockers, accepted exceptions, deferred work, release follow-ups, known gaps, historical references, or closure evidence without confusing them with current executable tasks."
---

# AreaForge Residual Ledger

Use this skill to keep unresolved items visible, classified, and closeable without turning every risk into immediate scope.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [tasks/README.md](../../../tasks/README.md)
3. [workflow/README.md](../../../workflow/README.md)
4. [docs/development/docs-100-completion-record.md](../../../docs/development/docs-100-completion-record.md)
5. [docs/development/feature-traceability.md](../../../docs/development/feature-traceability.md)
6. [docs/development/validation-matrix.md](../../../docs/development/validation-matrix.md)
7. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)
8. [docs/development/residual-risk-ledger.json](../../../docs/development/residual-risk-ledger.json)
9. [docs/development/operational-readiness.md](../../../docs/development/operational-readiness.md)

## References

- [references/classification.md](references/classification.md): residual types, close conditions, and reporting format.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): keep residual status synchronized across docs, tasks, and workflow.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): release residual risk and follow-up evidence.
- [../areaforge-incident-response/SKILL.md](../areaforge-incident-response/SKILL.md): incident follow-ups and accepted risks.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): checks after residual status changes.

## Workflow

1. Classify the item as current blocker, deferred work, accepted exception, monitoring gap, release follow-up, historical reference, template marker, or closed evidence.
2. Start from tasks, workflow, completion records, release records, and feature traceability before creating or changing a residual entry.
3. Report each item with stable ID, source file, current impact, owner, close condition, evidence required, and whether it is executable now.
4. If an item is executable and in current scope, promote it through tasks or workflow instead of leaving it only as residual text.
5. If an item is accepted or deferred, keep the rationale and revisit trigger explicit.
6. Sync docs after status changes and run the validation selected by the validation driver.

## Guardrails

- Do not make `.codex/skills-src/**` the product source of truth for residuals.
- Do not close a residual from intent, stale validation, or absence of search hits.
- Do not convert historical references, templates, or accepted exceptions into urgent tasks unless the source fact changed.
- Do not hide residual risk from release, incident, or completion summaries.
- Do not rewrite historical records just to centralize a residual ledger.
