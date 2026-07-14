---
name: areaforge-operating-loop
description: "Use when Codex needs to run AreaForge work end-to-end across multiple skills: classify Quick/Change/Mission-Critical/Review/Ops/Release work, choose owner skills, gather source facts, enforce high-risk gates, select validation, sync docs, and report residual risk."
---

# AreaForge Operating Loop

## Overview

Use this skill as the light orchestration layer for AreaForge. It routes work through the existing owner skills and keeps the loop evidence-backed without importing a heavyweight task runner from AreaMatrix or AreaFlow.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [README.md](../../../README.md)
3. [docs/development/codex-workflow.md](../../../docs/development/codex-workflow.md)
4. [docs/development/validation-matrix.md](../../../docs/development/validation-matrix.md)
5. [docs/development/doc-sync-checklist.md](../../../docs/development/doc-sync-checklist.md)
6. [docs/development/operational-readiness.md](../../../docs/development/operational-readiness.md)
7. [docs/development/long-term-operability-control-plane.md](../../../docs/development/long-term-operability-control-plane.md)
8. [docs/development/maintenance-cadence.md](../../../docs/development/maintenance-cadence.md)
9. [docs/development/completion-evidence-checklist.md](../../../docs/development/completion-evidence-checklist.md)
10. [docs/development/runtime-write-boundary.md](../../../docs/development/runtime-write-boundary.md)
11. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)
12. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
13. [docs/deployment/github-release-updater.md](../../../docs/deployment/github-release-updater.md)
14. [docs/development/high-risk-confirmation-packets.md](../../../docs/development/high-risk-confirmation-packets.md)
15. [.github/workflows/release.yml](../../../.github/workflows/release.yml)
16. [tasks/README.md](../../../tasks/README.md)
17. [workflow/README.md](../../../workflow/README.md)

## References

- [references/loop-map.md](references/loop-map.md): task classes, owner skills, required evidence, and closeout gates.
- [../areaforge-enterprise-governance/SKILL.md](../areaforge-enterprise-governance/SKILL.md): CI, policy, review, and repository governance.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): release, updater, rollback, and release evidence.
- [../areaforge-qa-smoke/SKILL.md](../areaforge-qa-smoke/SKILL.md): authenticated smoke and user-journey evidence.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): high-risk security, signing, secrets, and command-boundary checks.
- [../areaforge-file-storage-safety/SKILL.md](../areaforge-file-storage-safety/SKILL.md): upload, attachment, reconciliation, backup, restore, and storage migration gates.
- [../areaforge-observability/SKILL.md](../areaforge-observability/SKILL.md): production signals and readiness evidence.
- [../areaforge-residual-ledger/SKILL.md](../areaforge-residual-ledger/SKILL.md): residual risk IDs, close conditions, and accepted exceptions.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose validation after the final edit.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): sync README, docs, tasks, workflow, ops, and skills.
- [../areaforge-git-checkpoint/SKILL.md](../areaforge-git-checkpoint/SKILL.md): stage, commit, push, and release-tag readiness without mixing unrelated dirty work.

## Workflow

1. Classify the work as Quick, Change, Mission-Critical, Review, Ops, Release, Incident, or Product Experience.
2. Load the loop map and the owner skill for the highest-risk surface. Use more skills only when the work crosses their ownership boundary.
   Until a dedicated data-governance owner exists, classify data export, retention, deletion rights, user migration, privacy lifecycle, AI history retention, token/cost ledgers, and provider traces as Mission-Critical security/privacy work led by `areaforge-security-governance`, with file, AI, SRE, residual, and doc-sync handoff as needed.
3. Identify source facts before edits: docs, tasks, workflow, ops records, code, release evidence, or production read-only evidence.
4. If high-risk boundaries are touched, stop for an explicit confirmation packet before write actions.
5. Execute the smallest aligned implementation that moves the requested final state forward.
6. Select validation from `areaforge-validation-driver` after the final edit.
7. Sync source facts through `areaforge-doc-sync`.
8. Record unresolved items through `areaforge-residual-ledger` when they affect release, ops, security, supply chain, or user experience.
9. Close with evidence from `completion-evidence-checklist.md`: files changed, commands run, pass/fail, unverified items, blockers, residual risk IDs, release requirement, runtime write boundary, and whether production was touched. If a completion evidence record is saved, validate it with `pnpm completion:evidence:validate <record>`; this validates the record shape only and does not replace runtime, release, production, smoke, or long-term live gates.
10. Use `pnpm ops:status` for an offline AreaFlow-style status projection when a maintainer needs the current control-plane/residual snapshot before live evidence collection.
11. Use `pnpm ops:handoff` at maintenance, release, or thread handoff boundaries when the maintainer needs a compact read-only summary of claim boundaries, due residuals, release-relevant residuals, and next evidence commands.
12. Keep evidence words distinct: `health`, `readiness`, `doctor`, `gate`, `smoke`, `record`, and `apply` 不能互相替代。

## Guardrails

- Do not make this skill a product source of truth.
- Do not skip owner skills when a request touches release, production, security, AI, uploads, attachments, file storage, migrations, or user experience.
- Do not route data lifecycle work as docs-only or ordinary feature work; require explicit scope, validation owner, rollback or revocation path, and residual-risk close condition.
- Do not execute production deploy, updater apply, backup, restore, migration, rollback, or server commands from this skill.
- Do not claim enterprise readiness without CI/release gates, ops readiness evidence, residual risk IDs, and validation output.
- Do not copy AreaMatrix or AreaFlow platform mechanics unless AreaForge has a direct operational need.
