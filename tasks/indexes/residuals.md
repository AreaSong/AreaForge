# Residual Risk Index

本索引面向执行任务，只解释哪些残余项可能影响下一步工作。权威关闭条件仍以 `docs/development/residual-risk-ledger.md` 和 `docs/development/residual-risk-ledger.json` 为准。

## 使用规则

- 不把 residual 当作 Package A-E 未完成；Package A-E 的当前 docs 100% 主线已闭环。
- 触发发布、运维、安全、供应链或真实体验判断时，先查本索引，再回到权威台账确认关闭条件。
- 若 residual 到达 `reviewAt` 仍未关闭，更新影响、关闭条件、所需证据或风险接受理由。
- 若 residual 变成当前工作阻塞，升级为任务或 incident，不只停留在本索引。

## 当前索引

| ID | 执行影响 | 下一 owner | 触发时机 |
|---|---|---|---|
| AF-RISK-OPS-001 | 生产 extra smoke 未配置时，发布体验验证只能到 `warn`；关闭前先跑 `pnpm ops:ops-001:preflight`，再用生产只读 smoke、redacted update-agent status、operational evidence bundle 和 `pnpm ops:ops-001:closure:validate` 收口包复核 | `areaforge-sre-ops` / `areaforge-qa-smoke` | 每次 release/update 后或维护窗口复核 |
| AF-RISK-OPS-002 | 写入型生产 smoke 策略已有非执行草案，但仍缺账号、确认、清理和受控记录 | `areaforge-qa-smoke` / `areaforge-security-governance` | 执行生产写入 smoke 前 |
| AF-RISK-REL-001 | `AREAFORGE_AUTO_APPLY=none` 是安全默认，不等于自动应用已启用 | `areaforge-release-operator` / `areaforge-sre-ops` | 调整自动更新策略前 |
| AF-RISK-SC-001 | 下一次签名 Release 需产生并校验 SBOM/provenance；`pnpm release:supply-chain:validate` 可校验证据记录 | `areaforge-supply-chain` | 创建新 GitHub Release 时 |
| AF-RISK-SC-002 | 已关闭为 CI-only 证据项；当前 HEAD 的 GitHub CI、Actions SHA pinning、`pnpm audit:prod` high 阈值、governance/skills/release supply-chain selftest 和 `expectedGitCommit` / `gitCommit` match 仍需在每次相关 workflow、依赖或 release 变更后用 `pnpm sc:sc-002:preflight` 和 `pnpm ci:supply-chain:validate` 重新复核；签名 Release 证据继续归 `AF-RISK-SC-001` | `areaforge-supply-chain` / `areaforge-enterprise-governance` | 修改 GitHub Actions、依赖审计、release workflow、供应链记录工具或创建新 Release 前 |
| AF-RISK-SC-003 | 已关闭为证据项；`packages/db` 已串行化 Prisma pg adapter transaction query，后续升级 `pg` / Prisma adapter 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke | `areaforge-supply-chain` / `areaforge-sre-ops` | 升级 `pg` / Prisma adapter 前 |
| AF-RISK-OPS-003 | 服务器、域名、Nginx 或端口迁移需单独 runbook 和证据 | `areaforge-sre-ops` | 基础设施迁移前 |
| AF-RISK-OPS-004 | 2026-07-11 manual-window alert preview 和告警/恢复演练记录已保存，`pnpm ops:ops-004:preflight` 可到 `ready_for_human_close`；外部接收人和 metrics dashboard 仍未产品化，台账关闭需维护者人工复核 | `areaforge-observability` | 建立告警、关闭 OPS-004 或声称完整生产健康前 |
| AF-RISK-UX-001 | 已关闭为证据项；2026-07-10 本地 desktop/mobile 体验复核记录已通过，后续体验优化、release/update 或 14 天维护窗口前必须重跑 `pnpm experience:review:validate` | `areaforge-product-experience` / `areaforge-qa-smoke` | 每次体验优化、release/update 后或声称体验健康前 |
