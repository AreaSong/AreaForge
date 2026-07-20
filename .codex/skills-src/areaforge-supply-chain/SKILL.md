---
name: areaforge-supply-chain
description: "Use when Codex needs to inspect, design, or verify AreaForge supply-chain trust: GitHub Actions, Release assets, GHCR images, immutable digests, cosign/GPG signatures, SHA256SUMS, dependency changes, package manager build approvals, updater trust policy, SBOM or provenance gaps. This skill owns artifact and dependency trust verification; hand release creation to areaforge-release-operator and broad security boundary review to areaforge-security-governance."
---

# AreaForge Supply Chain

Use this skill to keep release artifacts, dependencies, and updater inputs trustworthy enough for long-term operation.

## When To Use / Hand Off

- Use for: verifying trust of release artifacts, images, digests, signatures, hashes, dependencies, GitHub Actions, and updater inputs.
- Not here: creating releases or release records -> `areaforge-release-operator`; secrets and security boundary review -> `areaforge-security-governance`; production updater/apply evidence -> `areaforge-sre-ops`; repository dependency policy -> `areaforge-enterprise-governance`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [README.md](../../../README.md)
3. [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)
4. [.github/workflows/release.yml](../../../.github/workflows/release.yml)
5. [docs/development/release-train.md](../../../docs/development/release-train.md)
6. [docs/deployment/github-release-updater.md](../../../docs/deployment/github-release-updater.md)
7. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
8. [docs/development/setup.md](../../../docs/development/setup.md)
9. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)

## References

- [references/trust-gates.md](references/trust-gates.md): artifact, dependency, image, updater, and CI trust gates.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): release creation and production evidence.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): secrets, signing, and command boundaries.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): validation selection for CI or dependency changes.
- [../areaforge-enterprise-governance/SKILL.md](../areaforge-enterprise-governance/SKILL.md): repository policy and dependency admission.

## Workflow

1. Classify the change: dependency, GitHub Actions, Docker image, release asset, signing key, updater policy, package visibility, or build approval.
2. Load the trust gates before approving, releasing, or advising auto-update policy.
3. Verify artifacts by immutable identity: tag, digest, SHA256, signature bundle or GPG signature, workflow run, and manifest contents.
4. For dependency changes, check purpose, license/security risk, build scripts, lockfile impact, transitive risk, and runtime exposure.
5. Treat public package visibility as distribution convenience, not trust. Trust still comes from signatures, hashes, pinned digests, and rollback evidence.
6. When reviewing or closing `AF-RISK-SC-002` from CI-only evidence, use `docs/development/ci-supply-chain-record-template.md`, run `pnpm sc:sc-002:preflight`, then validate with `pnpm ci:supply-chain:validate <record>`. CI-only evidence must not close `AF-RISK-SC-001`.
7. When reviewing or closing `AF-RISK-SC-001` / signed Release supply-chain evidence, use the release supply-chain record template. Generate a redacted draft with `pnpm release:supply-chain:record <release-assets-dir>`, run `pnpm sc:sc-002:preflight` with both `AREAFORGE_SC002_RELEASE_RECORD` and `AREAFORGE_SC002_RELEASE_ASSETS_DIR`, then validate it with `pnpm release:supply-chain:validate <record> <release-assets-dir> --strict` so manifest identity, record hashes, `SHA256SUMS`, assets, and cosign are all rechecked. Record-only validation cannot reach signed Release review readiness.
8. Keep execution boundaries clear: Supply Chain validates trust evidence and residual close conditions; Release Operator creates or reviews release records; SRE Ops owns production updater/apply evidence.
9. Record residual gaps such as missing SBOM, missing provenance attestation, missing GitHub Actions run evidence, unpinned action versions, or unavailable vulnerability scan.

## Guardrails

- Do not recommend strong automatic update without signed assets, hash verification, immutable image digests, backup readiness, rollback evidence, and smoke hooks.
- Do not trust `latest`, mutable tags, unsigned Release assets, or package visibility alone.
- Do not weaken GitHub Actions permissions, release signing, shellcheck, updater preflight, or digest checks without explicit risk acceptance.
- Do not commit secrets, signing private material, package tokens, production env, or backup files.
- Do not treat local build success as release artifact trust.
- Do not allow stable release assets to be unsigned; preview placeholders are not production trust evidence.
- Do not let CI-only evidence close SC-001; do not let a generated supply-chain record close SC residuals unless the explicit workflow run, audit, Actions pinning, checksum, signature, and stable release fields pass validation.
