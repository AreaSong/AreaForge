# Validation Map

The authoritative project matrix is `docs/development/validation-matrix.md`; use this file as the compact skill-facing map and defer to the matrix when they differ.

## Default By Scope

- Docs/tasks/workflow/ops only: follow `docs/development/validation-matrix.md`; usually `pnpm docs:readiness` and `git diff --check`, adding `pnpm docs:completion` or `pnpm risk:preflight` when completion evidence, release state, high-risk guardrails, or broad docs 100% claims changed.
- Repo-local skills: `pnpm skills:validate`, `git diff --check`; add docs/risk gates when skill text changes enterprise governance, release, security, supply chain, observability, incident response, residual risk, AI, ops, validation, or source-of-truth policy.
- Ops readiness or residual ledger: `pnpm ops:readiness`, `pnpm ops:readiness:summary`, `pnpm ops:evidence:bundle`, `pnpm ops:alert:preview`, `pnpm alert:drill:selftest`, `pnpm docs:readiness`, `git diff --check`; add release/updater gates when release workflow or updater trust changed.
- Web UI/API: `pnpm --filter @areaforge/web typecheck`, `pnpm --filter @areaforge/web lint`, targeted smoke, `pnpm check`.
- Core rules: `pnpm --filter @areaforge/core test`, `pnpm --filter @areaforge/core typecheck`, `pnpm check`.
- Storage/upload: `pnpm --filter @areaforge/storage test`, upload route smoke, `pnpm risk:preflight`.
- AI: `pnpm --filter @areaforge/ai test`, Web typecheck/lint, key scan/risk preflight.
- Prisma schema: `pnpm db:validate`, `pnpm db:generate`, temporary database migration deploy when migration changes.
- Release/updater: `pnpm github-release-updater:preflight`, `pnpm shellcheck:updater`, release evidence validation, updater smoke.
- Production ops: prefer read-only health/status checks unless user confirms write action.
- Observability/incident/residual changes: pair structural validation with docs/risk gates; use live checks only when explicitly authorized and needed.

## Report Format

```text
Changed scope:
Commands run:
PASS:
FAIL/BLOCKED:
Coverage:
Evidence freshness:
Skipped checks and reason:
Engineering quality blockers:
Security/privacy blockers:
Dependency/supply-chain blockers:
CI/release blockers:
Git checkpoint blockers:
Unverified residual risk:
```

## Widening Rules

Widen from targeted checks to `pnpm check` when the change crosses packages, changes shared types, touches Prisma, alters build/runtime config, or is release-bound.
