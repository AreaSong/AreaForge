# Git Checkpoint Policy

## Branch And Scope

- Work on the current `codex/*` branch unless the user requests another branch.
- Preserve unrelated dirty files; inspect them, but do not stage or revert them without explicit instruction.
- A checkpoint should represent one coherent change: feature, docs sync, release ops, governance, or residual closure.
- Release tags are not ordinary checkpoints. They require release-operator review, fresh validation, signed asset readiness, rollback target, and explicit user intent.

## Staging

- Stage only reviewed files.
- Keep private operational artifacts out of Git: `.env*` with real values, backups, database dumps, upload files, release downloads, cosign private material, smoke password files, and server logs.
- Generated proof files belong in Git only when a runbook or docs source of truth explicitly requires a redacted record.

## Commit

- Commit after validation passes for the touched scope.
- If a validation is intentionally not run, the commit message or closeout must mention the reason and residual risk.
- Prefer concise Chinese commit messages that describe the user-visible or governance-visible effect.

## Push

- Do not push by default.
- Push only when requested, when opening a PR, or when a release/tag flow explicitly requires it.
- If push fails, stop and inspect the branch state instead of force-pushing.

## Recovery

- If staging accidentally includes unrelated files, unstage only those files and leave their working-tree content intact.
- If validation fails after staging, keep the index recoverable and fix the cause before committing.
- If a commit was created with the wrong scope, do not rewrite shared history without explicit confirmation.
