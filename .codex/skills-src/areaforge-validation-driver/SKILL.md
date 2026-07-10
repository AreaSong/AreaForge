---
name: areaforge-validation-driver
description: "Use when Codex needs to choose, run, or report the smallest sufficient AreaForge validation set for docs-only changes, web changes, Prisma migrations, core rules, AI provider changes, uploads, security changes, supply-chain changes, observability or incident workflows, release/update work, production ops, or mixed changes."
---

# AreaForge Validation Driver

Choose validation from risk and touched paths, then report evidence honestly.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/development/validation-matrix.md](../../../docs/development/validation-matrix.md)
3. [docs/development/docs-100-completion-record.md](../../../docs/development/docs-100-completion-record.md)
4. [package.json](../../../package.json)
5. The nearest path-local `AGENTS.md` for changed files.

## References

- [references/validation-map.md](references/validation-map.md): path-to-check mapping and report format.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): docs drift checks.
- [../areaforge-qa-smoke/SKILL.md](../areaforge-qa-smoke/SKILL.md): browser and user journey evidence.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): security high-risk gates.
- [../areaforge-supply-chain/SKILL.md](../areaforge-supply-chain/SKILL.md): artifact, dependency, CI, and updater trust gates.
- [../areaforge-observability/SKILL.md](../areaforge-observability/SKILL.md): production signal evidence and observability gaps.
- [../areaforge-residual-ledger/SKILL.md](../areaforge-residual-ledger/SKILL.md): residual risk and close-condition evidence.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): release and updater validation.

## Workflow

1. Start from changed paths and risk boundaries, not a fixed maximal command set.
2. Load the validation map before selecting commands.
3. Run checks after the final relevant edit.
4. If a command fails, classify whether the failure is caused by the change, environment, stale generated files, or an unrelated dirty worktree.
5. Report commands, result, scope covered, and residual unverified risk.

## Guardrails

- Do not claim completion without executed validation or an explicit blocked reason.
- Do not use `pnpm check` alone to prove release, production, AI privacy, upload safety, or UX.
- Do not use docs gates to prove runtime behavior.
- Do not report PASS when `git diff --check` fails.
- Do not widen validation by habit; widen because the risk or path requires it.
