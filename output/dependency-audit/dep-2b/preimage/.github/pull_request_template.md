## Summary

-

## Scope

- [ ] Code
- [ ] Docs
- [ ] Ops/release
- [ ] Security/privacy
- [ ] AI
- [ ] Uploads/storage
- [ ] Database/migration

## High-Risk Boundary

- [ ] No high-risk boundary touched
- [ ] High-risk confirmation packet is linked and explicit approval exists

High-risk areas include auth/session, uploads, AI context, migrations, backups/restores, deployment/update policy, and server command capability.

## Review Tier

- [ ] `routine` - path report and normal source-fact validation reviewed
- [ ] `protected-path` - governance/release/ops control-plane review evidence linked
- [ ] `high-risk` - confirmation packet and scoped validation evidence linked
- [ ] `pnpm governance:changed-paths --summary` output is linked or summarized

## Validation

- [ ] `pnpm governance:preflight`
- [ ] `pnpm secrets:scan`
- [ ] `pnpm ops:readiness`
- [ ] `pnpm skills:validate`
- [ ] `pnpm docs:readiness`
- [ ] `pnpm docs:completion`
- [ ] `pnpm risk:preflight`
- [ ] `pnpm check`
- [ ] Other:

## Review Evidence

- [ ] Reviewed against `CODE_REVIEW.md`
- [ ] Source facts and validation evidence are linked or summarized
- [ ] Findings, open questions, and residual risk IDs are recorded

## Release / Ops Evidence

- [ ] Not release-bound
- [ ] Version bump, tag, GitHub Release, image digest, smoke, rollback target, and residual risk are documented
- [ ] Ops readiness and residual risk IDs are updated when release/ops posture changes

## Residual Risk

-
