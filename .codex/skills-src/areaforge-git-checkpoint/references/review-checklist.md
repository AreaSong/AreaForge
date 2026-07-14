# Checkpoint Review Checklist

Use this checklist before staging, committing, pushing, or preparing a release tag.

## Diff Review

- `git status --short --branch` shows the expected branch and dirty files.
- `git diff --stat` matches the intended scope.
- High-risk files are inspected directly: Prisma migrations, auth/session, uploads, AI provider, release workflow, updater scripts, production docs, residual ledger, package metadata, and env examples.
- No unrelated user edits are staged.

## Validation Evidence

- Validation commands match `docs/development/validation-matrix.md`.
- `git diff --check` passes.
- Release/updater changes include updater preflight, shellcheck, governance, ops readiness, and relevant supply-chain checks, including `pnpm release:supply-chain:record:selftest` when record generation or SC residual evidence changed.
- Docs/source-fact changes include docs readiness and residual validation when residual IDs changed.

## Release Evidence

- Release-bound commits have version/tag intent, Release asset expectations, rollback target, and residual risks documented.
- Supply-chain residual closure commits have a validated record or an explicit note that the next GitHub Release/CI run is still required.
- Stable release assets must be signed; preview unsigned placeholders are not production evidence.
- `AREAFORGE_AUTO_APPLY=none` remains the default unless an explicit policy change is confirmed.

## Closeout

- Report files changed, validations run, and unverified items.
- Keep residual IDs open until their close condition is proven by current evidence.
- Do not claim production deployment, update, rollback, backup, restore, or migration from a local commit alone.
