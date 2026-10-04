---
name: areaforge-release-operator
description: "Use for publishing or reviewing AreaForge versioned artifacts and update requests: tags, GitHub Releases, changelog, GHCR image identity, updater requests, rollback targets, and release records. Confirmed production execution belongs to areaforge-sre-ops; artifact provenance belongs to areaforge-supply-chain and plain Git checkpoints to areaforge-git-checkpoint."
---

# AreaForge Release Operator

Operate AreaForge releases as evidence-backed production changes, not as ad-hoc tags.

## When To Use / Hand Off

- Use for: preparing, creating, reviewing, or verifying release artifacts and records: version, tag, GitHub Release, signed assets, GHCR digest, updater request, rollback target, and post-release evidence. A published artifact and a production-applied release are separate claim scopes.
- Not here: artifact and dependency trust verification -> `areaforge-supply-chain`; local stage/commit/push before any tag -> `areaforge-git-checkpoint`; confirmed production execution -> `areaforge-sre-ops`; read-only live signals -> `areaforge-observability`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [README.md](../../../README.md)
3. [docs/development/long-term-operability-control-plane.md](../../../docs/development/long-term-operability-control-plane.md)
4. [docs/development/release-train.md](../../../docs/development/release-train.md)
5. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
6. [docs/development/release-record-template.md](../../../docs/development/release-record-template.md)
7. [docs/deployment/github-release-updater.md](../../../docs/deployment/github-release-updater.md)
8. [docs/development/docs-100-completion-record.md](../../../docs/development/docs-100-completion-record.md)
9. [docs/development/operational-readiness.md](../../../docs/development/operational-readiness.md)
10. [docs/development/completion-evidence-checklist.md](../../../docs/development/completion-evidence-checklist.md)
11. [docs/development/runtime-write-boundary.md](../../../docs/development/runtime-write-boundary.md)
12. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)
13. [tasks/done/0018-github-release-updater.md](../../../tasks/done/0018-github-release-updater.md)

Read the minimum sources relevant to the release scope. Always read this skill; load production, updater, migration, storage, AI, and supply-chain references only when the release actually crosses those boundaries.

## References

- [references/release-gates.md](references/release-gates.md): release readiness, execution, evidence, and rollback gates.
- [../areaforge-supply-chain/SKILL.md](../areaforge-supply-chain/SKILL.md): signed assets, digests, dependencies, and updater trust.
- [../areaforge-observability/SKILL.md](../areaforge-observability/SKILL.md): live health, update-agent, backup freshness, and release identity evidence.
- [../areaforge-residual-ledger/SKILL.md](../areaforge-residual-ledger/SKILL.md): classify release follow-ups and accepted residual risk.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose the validation set for the changed scope.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): sync README/docs/tasks/workflow/ops after release changes.
- [../areaforge-sre-ops/SKILL.md](../areaforge-sre-ops/SKILL.md): inspect production updater, health, backups, and rollback readiness.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): review signing, GHCR, secrets, and Web runtime command boundaries.
- [../areaforge-file-storage-safety/SKILL.md](../areaforge-file-storage-safety/SKILL.md): review upload archive, attachment reconciliation, restore, and file rollback evidence when releases touch file storage.

## Workflow

0. If the request is Review/diagnostic, keep it read-only: inspect release identity and evidence without creating tags, Releases, update requests, or docs/records. Continue with preparation or edits only when the user explicitly requests that scoped change.
1. Identify the release scope: feature, docs-only, ops-only, dependency, migration, AI, upload, or production config.
2. Confirm high-risk boundaries before changing migration/upload storage/AI provider behavior, performing deployment/backup/restore/update-policy/rollback actions, or making a real provider call. Read-only release planning, artifact inspection, and disabled/fallback preparation may continue.
3. Load the release gates before proposing or creating a tag.
4. Verify local gates after the final change, not before the last edit; release workflow must validate before build and stable signing must fail closed.
5. Ensure release notes and docs mention version, tag, image digest, health, update-agent status, validation, evidence class, write boundary, and residual risk.
6. For `release-published`, require signed GitHub Release assets, immutable GHCR digests, release validation, residual risk, and a rollback target. For `production-applied`, additionally require updater check/apply evidence, backup point, migration result, smoke result, and confirmed production rollback evidence.
7. For a release that closes or reviews supply-chain residuals, require `pnpm sc:sc-002:preflight` with both record and assets directory plus a strict validated supply-chain record; use `pnpm release:supply-chain:record <release-assets-dir>`, then `pnpm release:supply-chain:validate <record> <release-assets-dir> --strict`. Record-only validation cannot prove signed Release readiness.
8. Coordinate owner handoff explicitly: Release Operator owns tag/version/assets/update-request and release evidence; Supply Chain owns trust validation; Observability supplies read-only live signals; SRE Ops executes only confirmed production update, rollback, backup, restore, or migration actions.
9. Keep `AREAFORGE_AUTO_APPLY=none` unless the user explicitly confirms a different policy.
10. For feature updates, use `long-term-operability-control-plane.md` to decide whether the change requires a GitHub Release, docs-only sync, or residual-only follow-up.

## Guardrails

- Do not create or recommend a Release when validation evidence is stale.
- Do not call `release-published` production-applied; `production-deferred` is valid when artifact publication was requested but production execution was not.
- Do not call Web version center requests "automatic update complete"; completion belongs to server-side updater evidence.
- Do not let Web runtime execute Docker, backup, restore, migration, shell, or server commands.
- Do not use floating `latest` images for production evidence.
- Do not publish a release without rollback target and residual risk.
- Do not publish a stable release with unsigned placeholder assets.
- Do not treat local production-mode evidence as remote production evidence unless the remote record proves it.
