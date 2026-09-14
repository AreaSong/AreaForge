---
name: areaforge-doc-sync
description: "Use when Codex needs to keep AreaForge README, AGENTS, docs, tasks, workflow, ops, release records, templates, or project-level skills aligned with current code, production, and release state. Trigger after feature work, migrations, uploads, AI changes, deployment/update changes, docs edits, task status changes, or questions asking whether all documents are synchronized. This skill owns documentation alignment; choosing validation commands belongs to areaforge-validation-driver."
---

# AreaForge Doc Sync

Keep AreaForge source facts aligned across product docs, engineering docs, task ledgers, workflow plans, ops records, and Codex skills.

## When To Use / Hand Off

- Use for: aligning source facts across README, AGENTS, docs, tasks, workflow, ops records, templates, and skills after state changes.
- Not here: choosing and running validation commands -> `areaforge-validation-driver`; release evidence fields themselves -> `areaforge-release-operator`; residual status decisions -> `areaforge-residual-ledger`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [README.md](../../../README.md)
3. [docs/README.md](../../../docs/README.md)
4. [docs/development/doc-sync-checklist.md](../../../docs/development/doc-sync-checklist.md)
5. [docs/development/feature-traceability.md](../../../docs/development/feature-traceability.md)
6. [docs/development/completion-evidence-checklist.md](../../../docs/development/completion-evidence-checklist.md)
7. [docs/development/runtime-write-boundary.md](../../../docs/development/runtime-write-boundary.md)
8. [tasks/README.md](../../../tasks/README.md)
9. [workflow/README.md](../../../workflow/README.md)

Choose the minimum source set for the changed facts. Do not read every linked document for a small entry-point or wording-only sync; escalate to security, release, ops, or data sources only when the changed fact crosses that boundary.

## References

- [references/drift-map.md](references/drift-map.md): source-of-truth map and drift search patterns.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): docs gates and final verification.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): release evidence fields that must sync back to docs.
- [../areaforge-residual-ledger/SKILL.md](../areaforge-residual-ledger/SKILL.md): blockers, deferred work, accepted exceptions, and close conditions.

## Workflow

0. If the request is only to review synchronization or diagnose drift, keep it read-only: report the authoritative source, affected paths, and proposed edits without changing files. Perform the synchronization steps below only when the user requests a sync/change or the current change workflow explicitly includes it.
1. Determine the authoritative source: code, production state, release record, completion record, product docs, or high-risk confirmation.
2. Update source facts before adapters, summaries, templates, or skill text.
3. Sync entry points first: `README.md`, `AGENTS.md`, `docs/README.md`, `tasks/README.md`, `workflow/README.md`, and relevant ops README. Include `apps/web/README.md` and `apps/web/AGENTS.md` when Web runtime, version center, release, or deployment facts change.
4. Sync module and development docs next: API, data model, validation matrix, feature traceability, completion records, completion evidence checklist, runtime write boundary, runbooks, residual risk, and task ledgers.
5. Scan for stale wording that implies completed Package A-E work is still pending.
6. For data lifecycle changes, sync security, file storage, AI, backup/restore, residual, release, and user-facing docs together; docs gates alone do not prove privacy, export, deletion, retention, or migration safety.
7. When `.codex/skills-src/**` changes, edit the matching `agents/openai.yaml` trigger wording only when owner/trigger/scope semantics changed; wording-only or guardrail-only edits require checking metadata for drift, not a forced metadata diff.
8. After the final doc/metadata edit, use the validation-driver matrix: docs normally run old-reference/entry-point `rg` checks, `pnpm docs:readiness`, `pnpm docs:links`, `pnpm docs:evergreen`, and `git diff --check`; tasks/workflow also run `pnpm tasks:doctor`. Add `pnpm docs:completion` or `pnpm risk:preflight` only when completion evidence, runtime write boundary, release state, high-risk guardrails, risk records, or a docs-100% claim changed. If `.codex/skills-src/**` or `.agents/skills/**` changed, also run `pnpm skills:validate` and any docs/risk gate required by the changed owner.

## Guardrails

- Do not make `.codex/skills-src/**` the product source of truth.
- Do not rewrite historical evidence just to make grep quiet; mark historical records as historical instead.
- Do not claim docs 100% from README alone; use completion record and scripts.
- Do not leave backlog entries ambiguous: they must say whether they are current blockers or future enhancement entry points.
- Do not sync docs in a way that broadens product scope without explicit confirmation. Accurately documenting existing code or an already-confirmed scope is synchronization, not scope expansion; a new behavior, data type, permission, external call, or delivery surface remains subject to its owner and confirmation boundary.
