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
| AF-RISK-OPS-001 | 生产 extra smoke 未配置时，发布体验验证只能到 `warn` | `areaforge-sre-ops` / `areaforge-qa-smoke` | 每次 release/update 后 |
| AF-RISK-OPS-002 | 写入型生产 smoke 策略已有非执行草案，但仍缺账号、确认、清理和受控记录 | `areaforge-qa-smoke` / `areaforge-security-governance` | 执行生产写入 smoke 前 |
| AF-RISK-REL-001 | `AREAFORGE_AUTO_APPLY=none` 是安全默认，不等于自动应用已启用 | `areaforge-release-operator` / `areaforge-sre-ops` | 调整自动更新策略前 |
| AF-RISK-SC-001 | 下一次签名 Release 需产生并校验 SBOM/provenance | `areaforge-supply-chain` | 创建新 GitHub Release 时 |
| AF-RISK-SC-002 | Actions SHA pinning 和 `pnpm audit:prod` 已本地落地，仍需 GitHub run 证据 | `areaforge-supply-chain` / `areaforge-enterprise-governance` | 下一次 CI 或 Release 运行后 |
| AF-RISK-SC-003 | `pg@9` warning 来源需在依赖升级前定位或接受 | `areaforge-supply-chain` / `areaforge-sre-ops` | 升级 `pg` / Prisma adapter 前 |
| AF-RISK-OPS-003 | 服务器、域名、Nginx 或端口迁移需单独 runbook 和证据 | `areaforge-sre-ops` | 基础设施迁移前 |
| AF-RISK-OPS-004 | 告警阈值已有非执行策略，但外部接收人、metrics dashboard 和演练记录仍缺 | `areaforge-observability` | 建立告警或声称完整生产健康前 |
