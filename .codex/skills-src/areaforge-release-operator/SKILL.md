---
name: areaforge-release-operator
description: "Use when Codex needs to prepare, review, create, or verify an AreaForge feature release, GitHub Release, signed release assets, GHCR image update, server updater request, rollback target, changelog, or post-release evidence. Trigger for release tags, version bumps, GitHub Actions release workflow, update center requests, auto-update policy, production release records, or questions about shipping a finished feature. This skill owns release execution and evidence; hand artifact trust verification to areaforge-supply-chain and plain commit/push checkpoints to areaforge-git-checkpoint."
---

# AreaForge Release Operator

Operate AreaForge releases as evidence-backed production changes, not as ad-hoc tags.

## When To Use / Hand Off

- Use for: preparing, creating, reviewing, or verifying releases: version, tag, GitHub Release, signed assets, GHCR digest, updater request, rollback target, and post-release evidence.
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

1. Identify the release scope: feature, docs-only, ops-only, dependency, migration, AI, upload, or production config.
2. Confirm high-risk boundaries before touching migration, upload storage, AI provider behavior, deployment, backup, restore, update policy, or rollback.
3. Load the release gates before proposing or creating a tag.
4. Verify local gates after the final change, not before the last edit; release workflow must validate before build and stable signing must fail closed.
5. Ensure release notes and docs mention version, tag, image digest, health, update-agent status, validation, evidence class, write boundary, and residual risk.
6. For production release, require signed GitHub Release assets, immutable GHCR digests, updater check/apply evidence, backup point, migration result, smoke result, and rollback target.
7. For a release that closes or reviews supply-chain residuals, require `pnpm sc:sc-002:preflight` with both record and assets directory plus a strict validated supply-chain record; use `pnpm release:supply-chain:record <release-assets-dir>`, then `pnpm release:supply-chain:validate <record> <release-assets-dir> --strict`. Record-only validation cannot prove signed Release readiness.
8. Coordinate owner handoff explicitly: Release Operator owns tag/version/assets/update evidence; Supply Chain owns trust validation; Observability supplies read-only live signals; SRE Ops executes confirmed production update, rollback, backup, restore, or migration actions.
9. Keep `AREAFORGE_AUTO_APPLY=none` unless the user explicitly confirms a different policy.
10. For feature updates, use `long-term-operability-control-plane.md` to decide whether the change requires a GitHub Release, docs-only sync, or residual-only follow-up.

## Guardrails

- Do not create or recommend a Release when validation evidence is stale.
- Do not call Web version center requests "automatic update complete"; completion belongs to server-side updater evidence.
- Do not let Web runtime execute Docker, backup, restore, migration, shell, or server commands.
- Do not use floating `latest` images for production evidence.
- Do not publish a release without rollback target and residual risk.
- Do not publish a stable release with unsigned placeholder assets.
- Do not treat local production-mode evidence as remote production evidence unless the remote record proves it.
