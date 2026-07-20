---
name: areaforge-public-maintenance
description: "Use when Codex needs to triage or improve AreaForge public repository maintenance: GitHub issues, support intake, contributor PRs, public/private security routing, self-hosting support, community-facing docs, issue templates, support preflight, or maintainer response boundaries. This skill owns public-facing triage and coordination; hand each risky surface to its owner skill such as areaforge-security-governance or areaforge-sre-ops."
---

# AreaForge Public Maintenance

Use this skill to keep the public project usable without weakening AreaForge's security, release, or production boundaries.

## When To Use / Hand Off

- Use for: triaging public issues, support intake, contributor PRs, and community-facing docs while guarding sensitive-data boundaries.
- Not here: security disclosure details -> `areaforge-security-governance`; self-hosting production support -> `areaforge-sre-ops`; release/update questions -> `areaforge-release-operator`; repository policy -> `areaforge-enterprise-governance`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [README.md](../../../README.md)
3. [SUPPORT.md](../../../SUPPORT.md)
4. [SECURITY.md](../../../SECURITY.md)
5. [CODE_REVIEW.md](../../../CODE_REVIEW.md)
6. [docs/development/support-intake.md](../../../docs/development/support-intake.md)
7. [docs/development/support-bundle-preview.md](../../../docs/development/support-bundle-preview.md)
8. [docs/development/dependency-policy.md](../../../docs/development/dependency-policy.md)
9. [docs/development/external-capability-admission.md](../../../docs/development/external-capability-admission.md)
10. [docs/development/maintenance-cadence.md](../../../docs/development/maintenance-cadence.md)
11. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)
12. [docs/deployment/operator-onboarding.md](../../../docs/deployment/operator-onboarding.md)
13. [docs/deployment/github-release-updater.md](../../../docs/deployment/github-release-updater.md)
14. [.github/ISSUE_TEMPLATE/bug_report.md](../../../.github/ISSUE_TEMPLATE/bug_report.md)
15. [.github/ISSUE_TEMPLATE/feature_request.md](../../../.github/ISSUE_TEMPLATE/feature_request.md)
16. [.github/ISSUE_TEMPLATE/ops_support.md](../../../.github/ISSUE_TEMPLATE/ops_support.md)
17. [.github/pull_request_template.md](../../../.github/pull_request_template.md)

## References

- [references/public-triage.md](references/public-triage.md): public issue, PR, support, and security routing gates.
- [../areaforge-enterprise-governance/SKILL.md](../areaforge-enterprise-governance/SKILL.md): repository policy, dependency, CI, and review governance.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): security, secret, privacy, and high-risk disclosure boundaries.
- [../areaforge-sre-ops/SKILL.md](../areaforge-sre-ops/SKILL.md): self-hosting, production, update, backup, restore, and rollback support.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): release train, GitHub Release, updater, and rollback evidence.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): keep public docs, README, templates, tasks, and workflow aligned.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose checks after public-maintenance changes.

## Workflow

1. Classify the public request as bug, feature, ops support, release/supply-chain, AI, docs, security, or contribution review.
2. Check for sensitive data before solving the issue. If public content contains secrets, private study data, attachment content, exploit details, database URLs, tokens, server paths, or unredacted logs, route to redaction or `SECURITY.md` first.
3. Map the request to the source fact: product docs, module docs, support intake, operator onboarding, release train, residual ledger, or code review policy.
4. Assign the owner skill for the risky surface. Keep this skill as the coordinator; hand security, SRE, release, supply-chain, AI, upload/storage, UX, and validation details to their owner skills.
5. Ask first for `pnpm ops:support:bundle-preview` output validated by `pnpm ops:support:bundle-preview:validate` when a public support or self-hosting issue needs context. Ask only for redacted, minimal reproduction evidence. Do not request production `.env`, database dumps, backup archives, attachment contents, full review text, motivation data, session secrets, API keys, cosign material, or smoke passwords.
6. If the request implies production deploy, backup, restore, migration, updater apply, rollback, auto-apply policy change, or server command execution, state that a public issue or PR is not execution confirmation and require the appropriate high-risk confirmation path.
7. After public-template, support, or governance changes, sync docs and run `pnpm support:intake:preflight`, `pnpm ops:support:bundle-preview:selftest`, `pnpm governance:preflight`, `pnpm docs:readiness`, and `git diff --check`. If skills changed, also run `pnpm skills:validate`.

## Guardrails

- Do not treat public issues as permission to operate the user's production system.
- Do not ask users to paste secrets, production logs with user data, database URLs, backup files, attachment contents, or exploit details into public channels.
- Do not close residual risks from a support reply or template edit; close only when `docs/development/residual-risk-ledger.md` conditions are met.
- Do not weaken security disclosure, signing, backup, release, or Web runtime command boundaries for convenience.
- Do not duplicate product policy in this skill. Source facts stay in `docs/**`, `SUPPORT.md`, `SECURITY.md`, `CODE_REVIEW.md`, `.github/**`, `tasks/**`, and `workflow/**`.
