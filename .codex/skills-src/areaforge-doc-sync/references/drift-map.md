# Drift Map

## Source Facts

- Product scope: `docs/product/**`.
- Architecture/API/data boundaries: `docs/architecture/**`.
- Module behavior: `docs/modules/**`.
- UX states: `docs/ux/**`.
- Security: `docs/security/**`.
- Development order and completion evidence: `docs/development/**`.
- Deployment and updater: `docs/deployment/**`, `ops/**`.
- Task ledger: `tasks/**`.
- Version roadmap: `workflow/**`.
- Entry points: `README.md`, `AGENTS.md`, `apps/web/README.md`, `apps/web/AGENTS.md`.
- Repo-local skills: `.codex/skills-src/**` with `.agents/skills/**` symlink entries.

## Stale Wording Search

Use targeted `rg` searches for:

```text
Package D 后续|Package E 前|仍需 Package D|仍归 Package D
完整第一版还必须继续完成|当前仍存在|只能算基础版
生产部署仍需另行确认|延后到 migration 后
未把 Package E 主状态标为完成|Package E 主状态不能
```

Treat historical evidence files differently: preserve history, but label it as historical if it can be misread as current state.

## Long-Term Wording Audit

When syncing README, docs, workflow, tasks, skills, or release records, check that durable source facts do not inherit temporary delivery wording:

- Current-state docs should not describe Package A-E, Batch 0-6, D1-D5, or E1-E4 as pending unless the text is explicitly historical.
- Completion records may preserve old blockers, but current summaries must name the date/version or mark the entry as historical evidence.
- Avoid vague terms such as "basic only", "later", "not done", or "temporary" in current-state docs without a residual risk ID, owner, and close condition.
- If a stale phrase is intentionally kept for audit history, add nearby wording that prevents it from being read as the current product state.

## Current-State Facts

- Current repository and production version: `0.1.7`.
- Online URL: `https://forge.areasong.top/`.
- GitHub Release evidence: historical production baseline `v0.1.5`; current signed production Release `v0.1.7`.
- Package A-E complete for current docs 100%.
- Web update center writes controlled requests only.
- Server-side update-agent/updater performs signature verification, backup, migration, switch, smoke, and rollback.
- Default `AREAFORGE_AUTO_APPLY=none`.
- Long-term operations skills cover enterprise governance, release, smoke, docs, SRE, observability, incident response, security, supply chain, residual ledger, product experience, AI governance, and validation.
