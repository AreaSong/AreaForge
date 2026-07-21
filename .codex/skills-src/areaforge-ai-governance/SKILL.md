---
name: areaforge-ai-governance
description: "Use when Codex needs to review, change, or extend AreaForge AI provider behavior, OpenAI-compatible calls, prompt/data minimization, fallback, rate limiting, logging, schema validation, long-term stage AI drafts, AI cost controls, AI history, token usage, or privacy boundaries. This skill owns AI provider and cost details; AI privacy lifecycle coordination belongs to areaforge-security-governance."
---

# AreaForge AI Governance

Keep AI helpful, explicit, bounded, auditable, and cheap enough to survive production use.

## When To Use / Hand Off

- Use for: AI provider behavior details: outbound context, fallback, rate limiting, schema validation, cost controls, token usage, and AI history boundaries.
- Not here: AI privacy lifecycle coordination and high-risk boundary review -> `areaforge-security-governance`; retention-gap tracking -> `areaforge-residual-ledger`; AI test/scan selection -> `areaforge-validation-driver`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/architecture/ai-boundary.md](../../../docs/architecture/ai-boundary.md)
3. [docs/security/file-ai-safety.md](../../../docs/security/file-ai-safety.md)
4. [docs/development/high-risk-confirmation-packets.md](../../../docs/development/high-risk-confirmation-packets.md)
5. [tasks/backlog/0017-ai-stage-privacy-cost.md](../../../tasks/backlog/0017-ai-stage-privacy-cost.md)

## References

- [references/ai-boundaries.md](references/ai-boundaries.md): AI routes, allowed contexts, forbidden data, fallback, and cost gates.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): secrets, logs, provider, and privacy review.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): AI test and scan selection.

## Workflow

1. Classify the AI path: discipline text, daily review advice, tomorrow plan, long-term stage draft, or future AI history/cost feature.
2. Confirm whether the path is local fallback, explicit provider call, or forbidden automatic call.
3. Inspect the outbound context fields before editing prompts or schemas.
4. Keep output schema-validated and fallback-safe.
5. Treat AI history, token/cost ledger retention, user export/delete, provider traces, or provider data-sharing policy changes as high-risk privacy lifecycle work until a dedicated data-governance owner exists.
6. Route AI privacy lifecycle work through `areaforge-security-governance`; use `areaforge-residual-ledger` for accepted retention gaps and `areaforge-doc-sync` when user-visible privacy, export, or deletion facts change.
7. Verify disabled mode, provider failure, invalid schema, rate limiting, secret redaction, client bundle key scan, and no prompt/raw response persistence.

## Guardrails

- Do not call provider from ordinary SSR, GET reports, background jobs, or passive page loads.
- Do not send motivation vault, full emotion records, full review text, attachments, file paths, full task titles, or raw notes by default.
- Do not save full prompt/raw response unless a new confirmed schema and privacy boundary exists.
- Do not make AI output automatically overwrite tasks, reports, stage plans, or mastery state.
- Do not hide provider errors as success; report fallback clearly.
- Do not retain AI history, token usage, cost details, provider traces, or provider request metadata beyond the confirmed schema without explicit retention, export, and deletion rules.
