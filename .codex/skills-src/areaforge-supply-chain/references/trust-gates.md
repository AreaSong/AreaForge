# Supply Chain Trust Gates

## Release Artifact Gate

Required for production-ready release evidence:

- GitHub Release tag is immutable for the intended version.
- Release assets include manifest, compose artifact, `SHA256SUMS`, and signature or bundle.
- GHCR images are referenced by fixed version tag and immutable digest.
- Server updater verifies signature and hash before applying.
- Release record captures digest, health, updater state, smoke, rollback target, and residual risk.

## Dependency Gate

For new or upgraded dependencies:

- state purpose and owner
- follow `docs/development/dependency-policy.md`
- check package reputation, license, maintenance, and runtime exposure
- inspect lockfile and build script changes
- avoid dependency if standard library or existing local helper suffices
- run `pnpm install` only when needed and commit lockfile changes deliberately

## GitHub Actions Gate

- Prefer pinned major versions at minimum; record residual risk for unpinned SHAs.
- Keep workflow permissions least-privilege.
- Do not add secret-bearing workflow steps without review.
- Release workflow must keep artifact signing and digest publication.
- Stable releases must fail closed without cosign signing key secrets; unsigned preview assets are not production trust evidence.
- CI must keep docs, risk, updater, shellcheck, and `pnpm check` gates unless explicitly changed with rationale.
- CI must keep `pnpm governance:preflight` so SECURITY, Dependabot, PR template, and dependency policy drift is caught.

## Updater Trust Gate

Strong auto-update requires:

- signed and hashed release assets
- immutable image digests
- public or authorized package pull path
- backup readiness and rollback evidence
- extra smoke hook for authenticated journeys
- documented policy for `none`, `notify`, or `patch`

## Residuals

Track missing SBOM, provenance attestations, vulnerability scanner output, pinned action SHAs, or dependency ownership as residuals, not as invisible assumptions. Current SBOM/provenance residual is `AF-RISK-SC-001`; GitHub Actions SHA pinning / vulnerability scan residual is `AF-RISK-SC-002`.
