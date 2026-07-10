---
name: areaforge-git-checkpoint
description: "Use when Codex needs to stage, commit, push, or review AreaForge Git checkpoint readiness after validation, especially before GitHub Release tags, release records, updater changes, docs completion claims, or separating unrelated dirty worktree changes."
---

# AreaForge Git Checkpoint

Use this skill when work is ready to become a Git checkpoint or when a dirty worktree may affect release evidence.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [README.md](../../../README.md)
3. [docs/development/codex-workflow.md](../../../docs/development/codex-workflow.md)
4. [docs/development/validation-matrix.md](../../../docs/development/validation-matrix.md)
5. [docs/development/completion-evidence-checklist.md](../../../docs/development/completion-evidence-checklist.md)
6. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
7. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)

## References

- [references/checkpoint-policy.md](references/checkpoint-policy.md): branch, staging, commit, push, and release tag checkpoint policy.
- [references/review-checklist.md](references/review-checklist.md): final diff review, validation evidence, and residual-risk checklist.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose and report the smallest sufficient validation set.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): release tags, GitHub Release assets, updater requests, and post-release evidence.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): keep README, docs, tasks, workflow, ops, and skills aligned.
- [../areaforge-residual-ledger/SKILL.md](../areaforge-residual-ledger/SKILL.md): record unresolved release, ops, security, supply-chain, or UX risk IDs.

## Workflow

1. Inspect `git status --short --branch` and identify unrelated pre-existing changes before staging.
2. Review `git diff --stat` and the relevant hunks; do not stage generated noise, private env, backups, release assets, or unrelated edits.
3. Confirm validation evidence is fresh and matches the changed scope. Use `completion-evidence-checklist.md` and `areaforge-validation-driver` when the command set or completion claim is unclear.
4. If the checkpoint is release-bound, load `areaforge-release-operator` and ensure version, tag, Release assets, rollback target, and residual risk evidence are ready.
5. Stage only the intended files, then re-check `git diff --cached --stat` and any high-risk hunks.
6. Commit with a concise Chinese message only after validation has passed or the remaining unverified items are explicitly documented.
7. Push only when the user asked for it or the release workflow requires it; creating or pushing a tag remains a release action.

## Guardrails

- Do not commit failed, blocked, stale, or unverified work as complete.
- Do not mix unrelated dirty worktree changes into a checkpoint.
- Do not stage production `.env`, secrets, cosign private keys, backup files, database dumps, upload contents, generated Release assets, or smoke credentials.
- Do not push, tag, create a GitHub Release, or trigger production update unless the user explicitly asked for that action and release gates are satisfied.
- Do not call a local commit "deployed"; deployment requires server-side updater or production release evidence.
- Do not treat dry-run validation, read-only readiness, or advisory residual reports as proof that production was updated.
