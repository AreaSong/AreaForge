# Release Gates

## Readiness

- Scope named: feature/docs/ops/security/AI/upload/migration/release.
- Version/tag decided and consistent across all AreaForge package manifests, release notes, and docs.
- High-risk confirmation exists for migration, upload, AI privacy, deployment, backup, restore, update policy, or rollback changes.
- Local validation selected through `areaforge-validation-driver`.
- Docs sync plan includes README, docs, tasks, workflow, ops, and completion/release records.
- Release workflow validate job passes before image build/push.
- Stable release signing fails closed when cosign private key secrets are missing.

## Required Evidence

- Commit or diff summary.
- Validation commands and PASS/FAIL.
- Release tag and GitHub Release URL.
- Release evidence record. For repository-visible records, copy `docs/development/release-record-template.md` to a new versioned file under `docs/development/`, such as `release-vX.Y.Z-record.md`; private operator logs may stay under server backup or ops-state paths but must be summarized in the repo-visible record.
- Supply-chain evidence record when closing or reviewing `AF-RISK-SC-001` / `AF-RISK-SC-002`: copy `docs/development/release-supply-chain-record-template.md` and run `pnpm release:supply-chain:validate <record>`.
- Web and migration image digests.
- `SHA256SUMS` and signature verification.
- Backup path/hash when production update is applied.
- Migration runner and result.
- Public health result: `GET https://forge.areasong.top/api/health`.
- Update-agent status: latest/current version, blocker, timer, rollback target.
- Residual risk and rollback plan.
- Residual risk IDs when unresolved items remain.

## Release Exceptions

Final gates explain readiness; they are not production actions. If a release proceeds with an accepted exception, the release record must include:

- exception owner
- reason and affected scope
- residual risk ID
- required evidence still missing
- review or expiry date
- rollback or revocation condition

Do not use an exception to bypass signing, hash verification, immutable image digests, backup readiness, or rollback evidence for a stable production update.

## Default Commands

```bash
pnpm docs:readiness
pnpm docs:completion
pnpm risk:preflight
pnpm github-release-updater:preflight
pnpm shellcheck:updater
pnpm ops:readiness
git diff --check
pnpm check
```

## Auto-Update Policy

- Default production policy: `AREAFORGE_AUTO_APPLY=none`.
- `patch` auto-apply requires explicit confirmation, signed assets, backup evidence, updater smoke, rollback target, and manifest `autoApply.patch=true`.
- Minor/major updates remain manual unless a new policy is confirmed.

## Production Smoke

- Built-in updater smoke currently proves public health.
- Login, task, timer, attachment, report, simulation, and AI fallback production smoke must be supplied by `AREAFORGE_EXTRA_SMOKE_COMMAND` or a documented manual release check.
- Do not call a release fully experience-verified unless these extra smoke paths are recorded.
