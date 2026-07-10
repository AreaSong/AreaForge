---
name: Ops Support
about: 自托管、发布、更新、备份、smoke 或回滚支持 / Self-hosting, release, updater, backup, smoke, or rollback support
title: "[Ops] "
labels: ["ops", "needs-triage"]
assignees: []
---

## 场景 / Scenario

- [ ] 首次自托管部署
- [ ] GitHub Release updater
- [ ] Web 版本中心请求
- [ ] 备份或恢复演练
- [ ] 生产只读 smoke
- [ ] 告警或 readiness
- [ ] Release train / 供应链证据
- [ ] 回滚判断
- [ ] 其他

## 当前版本 / Version

- AreaForge version:
- Release tag:
- Web image digest:
- Migration image digest:
- Auto apply policy: none / patch / other

## 环境 / Environment

- Domain:
- Install mode:
- Docker Compose file:
- Nginx or reverse proxy:
- PostgreSQL exposure: internal-only / public / unknown
- Upload storage: private volume / host dir / unknown

## 已运行的只读检查 / Read-Only Checks

<!-- 只贴 redacted 结果。不要贴生产 .env、token、密码、数据库 URL、备份本体或附件内容。 -->

- [ ] `pnpm operator:onboarding:preflight`
- [ ] `pnpm release:train:preflight`
- [ ] `pnpm github-release-updater:preflight`
- [ ] `pnpm ops:readiness`
- [ ] `pnpm ops:support:bundle-preview`
- [ ] `pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>`
- [ ] `pnpm ops:readiness:summary`
- [ ] `pnpm ops:evidence:bundle`
- [ ] `pnpm ops:alert:preview`
- [ ] `pnpm smoke:prod-readonly`
- [ ] other:

```text

```

## 阻塞点 / Blocker

## 残余风险 ID / Residual Risk IDs

<!-- 如相关：AF-RISK-OPS-001, AF-RISK-OPS-002, AF-RISK-REL-001, AF-RISK-SC-001, AF-RISK-SC-002, AF-RISK-OPS-004 -->

## 自查 / Self-Check

- [ ] 我已阅读 `docs/deployment/operator-onboarding.md`
- [ ] 我已阅读 `docs/development/release-train.md`
- [ ] 我没有公开粘贴生产 `.env`、数据库 URL、API key、GitHub token、cosign 私钥、smoke 密码、备份文件或附件内容
- [ ] 我理解公开 issue 不授权维护者执行我的生产部署、备份、恢复、migration、updater apply 或 rollback
