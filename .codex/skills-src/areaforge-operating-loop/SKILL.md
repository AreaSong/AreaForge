---
name: areaforge-operating-loop
description: "Use when Codex needs to run AreaForge work end-to-end across multiple skills: classify Quick/Change/Mission-Critical/Review/Ops/Release work, choose owner skills, gather source facts, enforce high-risk gates, select validation, sync docs, and report residual risk. This skill owns orchestration only; when the task clearly belongs to a single surface, activate that owner skill directly."
---

# AreaForge Operating Loop

## Overview

Use this skill as the light orchestration layer for AreaForge. It routes work through the existing owner skills and keeps the loop evidence-backed without importing a heavyweight task runner from AreaMatrix or AreaFlow.

## When To Use / Hand Off

- Use for: multi-surface work that needs classification, owner-skill routing, high-risk gating, validation selection, doc sync, and residual closeout in one loop.
- Not here: single-surface tasks -> activate the owner skill directly (for example `areaforge-release-operator` for a release, `areaforge-qa-smoke` for a smoke check, `areaforge-doc-sync` for doc drift).

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

`Read First` 是按任务范围选择的最小来源集合，不要求无条件读取整张清单；选中本 skill 后完整阅读本文件，再读取实际 owner 和相关 reference。未触及的 release、生产或数据生命周期文档不因列在清单中而自动扩大任务范围。

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
   Until a dedicated data-governance owner exists, classify data export, retention, deletion rights, user migration, privacy lifecycle, AI history retention, token/cost ledgers, and provider traces as Mission-Critical security/privacy work led by `areaforge-security-governance`. Security sets the data scope and confirmation packet; file, AI, SRE, residual, and doc-sync owners return scoped evidence without reopening approval for that exact scope. Independent rollout, probe, Release, provider-call, or residual-closure confirmations remain separate.
3. Identify source facts before edits: docs, tasks, workflow, ops records, code, release evidence, or production read-only evidence.
4. If a high-risk boundary will be changed or a real state/external write will occur, stop for an explicit confirmation packet before that action. Read-only investigation, plans, docs, preflight, static checks, and no-real-write mock tests may continue; they do not authorize migration, real provider calls, shared/production data writes, or rollback.
5. For Change, Mission-Critical, Ops, Release, Incident, or Product Experience work with explicit change intent, execute the smallest aligned implementation that moves the requested final state forward. For Review/diagnostic work, do not implement or write files; return findings, source/line evidence, and claim scope.
6. For a change task, sync source facts through `areaforge-doc-sync` after implementation. For Review/diagnostic work, report drift or proposed edits without applying them.
7. Record unresolved items or closure drafts through `areaforge-residual-ledger` before final validation when they affect release, ops, security, supply chain, or user experience. Actual residual status/closure writes still require the applicable confirmation packet; Review/diagnostic work only reports candidates.
8. Select and run final validation from `areaforge-validation-driver` after the last relevant doc, metadata, source, or residual edit. If validation or evidence files change afterward, rerun the affected profile.
9. Close with evidence from `completion-evidence-checklist.md`: files changed, commands run, pass/fail, unverified items, blockers, residual risk IDs, release requirement, runtime write boundary, and whether production was touched. Use `complete`, `partial`, `blocked`, or `not-applicable` in the human report; `blocked` requires a material missing approval, environment, or evidence condition after safe alternatives are exhausted and never makes the task complete by itself. If a completion evidence record is saved, validate it with `pnpm completion:evidence:validate <record>`; this validates the record shape only and does not replace runtime, release, production, smoke, or long-term live gates.
10. Use `pnpm ops:status` for an offline AreaFlow-style status projection when a maintainer needs the current control-plane/residual snapshot before live evidence collection.
11. Use `pnpm ops:handoff` at maintenance, release, or thread handoff boundaries when the maintainer needs a compact read-only summary of claim boundaries, due residuals, release-relevant residuals, and next evidence commands.
12. Keep evidence words distinct: `health`, `readiness`, `doctor`, `gate`, `smoke`, `record`, and `apply` 不能互相替代。
13. For local UI/browser validation, test-pool operations, or a task that needs a local test URL, run `pnpm dev:test:latest -- --json` when local Docker is available. If this task successfully ran `refresh` or `snapshot`, report the returned latest slot, port, URL, and source fingerprint as this task's latest optimized instance. Otherwise state that the pool was not updated and label the returned latest as pre-existing; it may support evidence only when its source fingerprint matches the requested scope, and it is never task-owned latest. Pure docs, review, core, and non-Web tasks mark this check `not-applicable`; if an in-scope task lacks Docker, report latest as unverified.
14. Browser evidence must reuse the reported latest URL. Do not create a container per conversation, page, or screenshot; any one-shot `areaforge-v11browser-runtime-*` runtime must be removed before closeout.

## Guardrails

- Do not make this skill a product source of truth.
- Do not skip owner skills when a request touches release, production, security, AI, uploads, attachments, file storage, migrations, or user experience.
- Do not route data lifecycle work as docs-only or ordinary feature work; require explicit scope, validation owner, rollback or revocation path, and residual-risk close condition. Do not send the same item back through Security merely because a specialist skill completed its scoped evidence.
- Do not execute production deploy, updater apply, backup, restore, migration, rollback, or server commands from this skill.
- Do not claim enterprise readiness without CI/release gates, ops readiness evidence, residual risk IDs, and validation output.
- Do not copy AreaMatrix or AreaFlow platform mechanics unless AreaForge has a direct operational need.
