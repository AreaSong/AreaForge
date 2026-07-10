# Validation Map

The authoritative project matrix is `docs/development/validation-matrix.md`; use this file as the compact skill-facing map and defer to the matrix when they differ.

## Default By Scope

- Docs/tasks/workflow/ops only: follow `docs/development/validation-matrix.md`; usually `pnpm docs:readiness` and `git diff --check`, adding `pnpm docs:completion` or `pnpm risk:preflight` when completion evidence, runtime write boundary, release state, high-risk guardrails, or broad docs 100% claims changed.
- Repo-local skills: `pnpm skills:validate`, `git diff --check`; add docs/risk gates when skill text changes enterprise governance, release, security, file storage, supply chain, observability, incident response, residual risk, AI, ops, validation, or source-of-truth policy.
- Ops readiness or residual ledger: `pnpm ops:readiness`, `pnpm ops:status`, `pnpm ops:status:selftest`, `pnpm ops:handoff`, `pnpm ops:handoff:selftest`, `pnpm ops:support:bundle-preview:selftest`, `pnpm ops:ops-001:preflight`, `pnpm ops:ops-001:preflight:selftest`, `pnpm ops:readiness:summary`, `pnpm ops:evidence:bundle`, `pnpm ops:evidence:bundle:selftest`, `pnpm ops:ops-001:closure:selftest`, `pnpm ops:alert:preview`, `pnpm smoke:prod-readonly:selftest`, `pnpm smoke:prod-readonly:config:selftest`, `pnpm smoke:prod-readonly:record:selftest`, `pnpm alert:drill:selftest`, `pnpm docs:readiness`, `git diff --check`; add release/updater gates when release workflow or updater trust changed. If a real support bundle preview is saved, run `pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>`; if a real evidence bundle is saved, also run `pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>`; if an OPS-001 closure packet is saved, run `pnpm ops:ops-001:preflight` and `pnpm ops:ops-001:closure:validate <ops-001-closure-packet.txt>`.
- Long-term operability control plane: `pnpm enterprise:operability:preflight`, `pnpm maintenance:cadence:preflight`, `pnpm release:train:preflight`, `pnpm ops:readiness`, `pnpm ops:status`, `pnpm ops:status:selftest`, `pnpm ops:handoff`, `pnpm ops:handoff:selftest`, `pnpm residuals:validate`, `pnpm residuals:review-due`, `pnpm docs:readiness`, `pnpm skills:validate`, `git diff --check`.
- Maintenance, incident, restore drill, or update-agent status records: run the matching selftest (`pnpm maintenance:window:record:selftest`, `pnpm maintenance:window:selftest`, `pnpm incident:record:selftest`, `pnpm restore:drill:selftest`, `pnpm update-agent:status:record:selftest`, or `pnpm update-agent:status:selftest`), then docs/ops gates based on the changed path. If a real record is added, validate it with the matching `*:validate` script.
- Web UI/API: `pnpm --filter @areaforge/web typecheck`, `pnpm --filter @areaforge/web lint`, targeted smoke, `pnpm check`.
- Core rules: `pnpm --filter @areaforge/core test`, `pnpm --filter @areaforge/core typecheck`, `pnpm check`.
- Storage/upload: `pnpm --filter @areaforge/storage test`, upload route smoke, path traversal/unsafe root checks, `pnpm risk:preflight`, and docs gates when file-storage source facts change.
- AI: `pnpm --filter @areaforge/ai test`, Web typecheck/lint, key scan/risk preflight.
- Prisma schema: `pnpm db:validate`, `pnpm db:generate`, temporary database migration deploy when migration changes.
- Release/updater: `pnpm github-release-updater:preflight`, `pnpm shellcheck:updater`, release evidence validation, updater smoke.
- Release supply-chain evidence: `pnpm release:supply-chain:selftest`, `pnpm release:supply-chain:record:selftest`, `pnpm ci:supply-chain:selftest`, `pnpm sc:sc-002:preflight:selftest`, `pnpm github-release-updater:preflight`, `pnpm governance:preflight`, and `git diff --check`; if a real signed Release record is generated, also run `pnpm sc:sc-002:preflight` and `pnpm release:supply-chain:validate <record>`; if a real CI-only SC-002 record is generated, run `pnpm sc:sc-002:preflight` and `pnpm ci:supply-chain:validate <record>`.
- Production ops: prefer read-only health/status checks unless user confirms write action.
- Observability/incident/residual changes: pair structural validation with docs/risk gates; use live checks only when explicitly authorized and needed.

## Report Format

```text
Changed scope:
Commands run:
PASS:
FAIL/BLOCKED:
Coverage:
Evidence class:
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
