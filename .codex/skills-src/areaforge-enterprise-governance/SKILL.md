---
name: areaforge-enterprise-governance
description: "Use when Codex needs to inspect, design, or update AreaForge enterprise governance: CI policy, branch and release rules, dependency admission, CODEOWNERS or PR templates, security policy, review gates, repository settings, workflow drift, or governance-level readiness."
---

# AreaForge Enterprise Governance

Use this skill when a change affects how the project is governed rather than a single feature path.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [README.md](../../../README.md)
3. [.github/workflows/ci.yml](../../../.github/workflows/ci.yml)
4. [.github/workflows/release.yml](../../../.github/workflows/release.yml)
5. [SECURITY.md](../../../SECURITY.md)
6. [SUPPORT.md](../../../SUPPORT.md)
7. [CODE_REVIEW.md](../../../CODE_REVIEW.md)
8. [docs/development/support-intake.md](../../../docs/development/support-intake.md)
9. [docs/development/dependency-policy.md](../../../docs/development/dependency-policy.md)
10. [docs/development/external-capability-admission.md](../../../docs/development/external-capability-admission.md)
11. [docs/development/codex-workflow.md](../../../docs/development/codex-workflow.md)
12. [docs/development/validation-matrix.md](../../../docs/development/validation-matrix.md)
13. [docs/development/doc-sync-checklist.md](../../../docs/development/doc-sync-checklist.md)
14. [docs/development/operational-readiness.md](../../../docs/development/operational-readiness.md)
15. [docs/development/maintenance-cadence.md](../../../docs/development/maintenance-cadence.md)
16. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)

## References

- [references/governance-gates.md](references/governance-gates.md): CI, review, dependency, release, ownership, and policy gates.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): source-of-truth and documentation drift checks.
- [../areaforge-supply-chain/SKILL.md](../areaforge-supply-chain/SKILL.md): dependency, signing, artifact, and action trust.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): security and privacy review.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose checks after governance changes.

## Workflow

1. Identify the governance surface: CI, release, branch policy, dependency policy, review process, security policy, ownership, docs gate, or Codex workflow.
2. Load the governance gates before editing workflows, templates, skills, scripts, or repository policy docs.
3. Check whether the change weakens evidence, expands write capability, changes approval requirements, or bypasses a high-risk confirmation packet.
4. Keep source facts in docs, tasks, workflow, ops, README, AGENTS, or GitHub config; keep skills as execution guidance only.
5. For governance reviews, report blockers first, then missing evidence, then residual risk and suggested close condition.
6. After governance changes, run the validation matrix path checks and sync docs.
7. For public repository governance changes, run `pnpm governance:preflight`.

## Guardrails

- Do not make `.codex/skills-src/**` the only source of policy.
- Do not weaken CI, signing, security, docs, risk, or release gates for convenience.
- Do not add external dependencies, actions, plugins, MCPs, or scripts without purpose, permissions, and supply-chain review.
- Do not claim enterprise readiness without evidence for CI, release hard gates, rollback, observability, incident response, residual risk IDs, and security boundaries.
- Do not add heavyweight process copied from AreaMatrix or AreaFlow unless AreaForge has an explicit operational need for it.
