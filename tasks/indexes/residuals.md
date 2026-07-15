# Residual Risk Index

本索引面向执行任务，只解释哪些残余项可能影响下一步工作。权威关闭条件仍以 `docs/development/residual-risk-ledger.md` 和 `docs/development/residual-risk-ledger.json` 为准。

## 使用规则

- 不把 residual 当作 Package A-E 未完成；Package A-E 的当前 docs 100% 主线已闭环。
- 触发发布、运维、安全、供应链或真实体验判断时，先查本索引，再回到权威台账确认关闭条件。
- 若 residual 到达 `reviewAt` 仍未关闭，更新影响、关闭条件、所需证据或风险接受理由。
- 若 residual 变成当前工作阻塞，升级为任务或 incident，不只停留在本索引。
- 维护者形成 close / keep-open / downgrade / reopen 结论时，先用 `docs/development/residual-closure-review-template.md` 和 `pnpm residuals:closure:validate <record>` 固定复核记录；该记录保持 `closesResidual=no`，不自动修改权威台账。

## 当前索引

| ID | 执行影响 | 下一 owner | 触发时机 |
|---|---|---|---|
| AF-RISK-OPS-001 | 2026-07-11/12 生产只读 fallback 已补齐 smoke 凭据配置并形成可人工复核证据；`v0.1.7` 生产 updater apply 时 extra smoke 通过；post-`v0.1.7` 只读 operational evidence bundle 已保存但状态为 `needs_attention`，因为 redacted update-agent status 和 production readonly smoke record 尚未重新采集入仓库；台账仍待维护者人工复核关闭 | `areaforge-sre-ops` / `areaforge-qa-smoke` | 每次 release/update 后或维护窗口复核；关闭台账前复核最新生产版本对应的 OPS-001 证据目录、`pnpm ops:ops-001:preflight` 和 `pnpm ops:ops-001:closure:validate` 输出 |
| AF-RISK-OPS-002 | 写入型生产 smoke 策略已有非执行草案，但仍缺账号、确认、清理和受控记录 | `areaforge-qa-smoke` / `areaforge-security-governance` | 执行生产写入 smoke 前 |
| AF-RISK-REL-001 | `AREAFORGE_AUTO_APPLY=none` 是安全默认，不等于自动应用已启用 | `areaforge-release-operator` / `areaforge-sre-ops` | 调整自动更新策略前 |
| AF-RISK-SC-001 | `v0.1.7` 签名 Release 已生成并校验 SBOM/provenance、checksum、cosign signature 和 GHCR digest 证据，并已由服务器侧 updater 应用到生产；带当前 release supply-chain record 路径运行 `pnpm sc:sc-002:preflight` 已到 `ready_for_sc001_sc002_review`，台账仍待维护者人工复核关闭 | `areaforge-supply-chain` | 关闭台账前复核 `release-supply-chain-v0.1.7` / `release-v0.1.7`；生产 apply 不自动关闭 residual；后续创建新 Release 或修改 release workflow 前 |
| AF-RISK-SC-002 | 已关闭为 CI-only 证据项；已验证 checkpoint `b9bbfa2072a79318fc93f6e9497fe4f4b3da29b7` 的 GitHub CI run `29167042314` 已通过，记录见 `docs/development/ci-supply-chain-20260711-b9bbfa2.txt`；Actions SHA pinning、`pnpm audit:prod` high 阈值、governance/skills/release supply-chain selftest 和 `expectedGitCommit` / `gitCommit` match 仍需在每次相关 workflow、依赖或 release 变更后用 `pnpm sc:sc-002:preflight`、`pnpm ci:supply-chain:validate` 或签名 Release 路径的 `pnpm release:supply-chain:validate` 重新复核；签名 Release 证据继续归 `AF-RISK-SC-001` | `areaforge-supply-chain` / `areaforge-enterprise-governance` | 修改 GitHub Actions、依赖审计、release workflow、供应链记录工具或创建新 Release 前 |
| AF-RISK-SC-003 | 已关闭为证据项；`packages/db` 已串行化 Prisma pg adapter transaction query，后续升级 `pg` / Prisma adapter 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke | `areaforge-supply-chain` / `areaforge-sre-ops` | 升级 `pg` / Prisma adapter 前 |
| AF-RISK-OPS-003 | 服务器、域名、Nginx 或端口迁移需单独 runbook 和证据 | `areaforge-sre-ops` | 基础设施迁移前 |
| AF-RISK-OPS-004 | 2026-07-11 manual-window alert preview 和告警/恢复演练记录保留为历史输入；post-`v0.1.7` alert preview 与 `docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt` 已匹配，带当前 preview/drill 路径运行 `pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`；外部接收人和 metrics dashboard 仍未产品化，台账关闭需维护者人工复核 | `areaforge-observability` | 建立外部告警、关闭 OPS-004 或声称完整生产健康前 |
| AF-RISK-OPS-005 | 本地 V2 expected-before、目标身份、TTL、idempotency/hash、no-clobber publish、directory fsync uncertain、processing reconciliation、不可变 decision history 和共享 production-state lock 已实现；fixture 已覆盖恶意 ID、崩溃重启和真实锁竞争；尚缺匹配签名 Release、生产部署和 fresh redacted rejection/history evidence | `areaforge-security-governance` / `areaforge-release-operator` / `areaforge-sre-ops` | 先创建并验证匹配提交的签名 Release；生产部署必须再次确认并暂停 timer、隔离旧队列、验证 V2 check |
| AF-RISK-OPS-006 | 只读 doctor 已能发现重复活跃计时和状态矛盾，但数据库级唯一约束、task/session CAS 和结束计时单次副作用尚未实施 | `areaforge-security-governance` / `areaforge-sre-ops` / `areaforge-validation-driver` | 执行 `tasks/active/0020-business-state-concurrency.md` 前先确认 additive migration、并发测试和回滚边界 |
| AF-RISK-OPS-007 | 附件写文件与 metadata 提交之间仍有崩溃窗口，当前只靠补偿和只读 reconciliation 发现孤儿 | `areaforge-file-storage-safety` / `areaforge-security-governance` | 实施 staging/write-intent 前单独确认 migration、旧附件兼容和不自动清理边界 |
| AF-RISK-OPS-008 | updater 缺阶段日志和 root-only maintenance hold/drain，强杀后的精确阶段与维护停止领取仍依赖人工判断 | `areaforge-sre-ops` / `areaforge-observability` / `areaforge-security-governance` | 实施 phase journal/hold/drain 前单独确认 updater、timer、队列和生产边界 |
| AF-RISK-UX-001 | 已关闭为证据项；2026-07-10 本地 desktop/mobile 体验记录是历史证据，2026-07-12 本地 `0.1.7` desktop/mobile 体验复核记录已新增且已通过 `pnpm experience:review:validate`；该证据不证明生产写入型 smoke 或真实用户数据体验 | `areaforge-product-experience` / `areaforge-qa-smoke` | 每次体验优化、release/update 后或声称体验健康前；若生产健康声明涉及写入路径，仍需单独生产 smoke 确认 |
