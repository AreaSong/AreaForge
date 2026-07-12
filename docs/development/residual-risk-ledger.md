# 残余风险台账

## 目标

本文件只记录会影响后续发布、生产运维、安全、供应链或真实体验判断的残余项。它不是普通 backlog，也不表示当前 docs 100% 功能未完成。

机器可读索引见 `docs/development/residual-risk-ledger.json`，并由 `pnpm residuals:validate` 校验与本文同步。

状态类型遵循 `.codex/skills-src/areaforge-residual-ledger/references/classification.md`：

- `current-blocker`
- `deferred-work`
- `accepted-exception`
- `monitoring-gap`
- `release-follow-up`
- `historical-reference`
- `template-marker`
- `closed-evidence`

## 编号规则

- `AF-RISK-OPS-*`：生产运维、备份、smoke、update-agent、基础设施。
- `AF-RISK-REL-*`：发布、自动更新、回滚和 release evidence。
- `AF-RISK-SC-*`：供应链、签名、依赖、SBOM/provenance。
- `AF-RISK-UX-*`：真实体验、可用性、端到端体验证据。
- `AF-RISK-AI-*`：AI provider、隐私、费用、fallback。

## 当前残余项

| ID | 类型 | 复核时间 | 当前影响 | 可立即执行 | 关闭条件 | 所需证据 | Owner |
|---|---|---|---|---|---|---|---|
| AF-RISK-OPS-001 | current-blocker | 2026-07-17 | 2026-07-11/12 生产只读 fallback 已补齐 smoke 账号和权限收紧的 smoke password file，等价 curl 只读 smoke 通过，redacted update-agent status 有效，且 update-agent `autoApply=none`、`signatureRequired=true`、timer active、`blocker=null`；本地收口证据在 `docs/development/ops-001-production-readonly-20260711/`，`pnpm ops:ops-001:preflight` 已返回 `ready_for_human_close`；台账尚未按维护者人工复核关闭 | 否 | 服务器配置 `AREAFORGE_EXTRA_SMOKE_COMMAND`、smoke 账号和权限收紧的 smoke 密码文件；OPS-001 helper 具备可执行 `pnpm smoke:prod-readonly` 的运行时或有等价 curl fallback 记录；最近一次生产只读 smoke 通过、redacted update-agent status、operational evidence bundle 和 OPS-001 收口包齐全 | `docs/development/ops-001-production-readonly-attempt-20260711.md`、`docs/development/ops-001-production-readonly-20260711/prod-readonly-smoke-record.txt`、`docs/development/ops-001-production-readonly-20260711/redacted-update-status.json`、`docs/development/ops-001-production-readonly-20260711/operational-evidence-bundle.json`、`docs/development/ops-001-production-readonly-20260711/ops-001-closure-packet.txt`、`docs/development/ops-001-production-readonly-20260711/ops001-preflight-after-closure.json`、`pnpm smoke:prod-readonly:validate` 通过、`pnpm update-agent:status:validate` 通过、`pnpm ops:evidence:bundle:validate` 通过、`pnpm ops:ops-001:closure:validate` 通过、`pnpm ops:ops-001:preflight` 返回 `ready_for_human_close` | `areaforge-sre-ops` / `areaforge-qa-smoke` |
| AF-RISK-OPS-002 | deferred-work | 2026-08-10 | 写入型生产 smoke 策略已有非执行草案；仍缺专用账号、用户确认、清理策略和受控记录 | 否 | 明确 smoke 账号、允许写入范围、清理策略、失败处理方式并获确认后，完成至少一次受控记录 | 确认记录、测试账号、写入对象 ID、清理或保留说明、smoke 结果 | `areaforge-qa-smoke` / `areaforge-security-governance` |
| AF-RISK-REL-001 | accepted-exception | 2026-08-10 | `AREAFORGE_AUTO_APPLY=none` 是当前安全默认；patch 自动应用尚未启用 | 否 | 用户明确确认 patch 自动应用，且签名、备份、extra smoke、rollback target 和 manifest policy 同时满足 | 确认记录、updater env 摘要、release manifest、smoke 和 rollback evidence | `areaforge-release-operator` / `areaforge-sre-ops` |
| AF-RISK-SC-001 | deferred-work | 2026-08-10 | `v0.1.7` 签名 GitHub Release 已生成 SBOM/provenance、`SHA256SUMS`、`SHA256SUMS.sig` 和 GHCR digest 证据；`pnpm release:supply-chain:validate` 已通过并使 `pnpm sc:sc-002:preflight` 返回 `ready_for_sc001_sc002_review`；线上仍是 `v0.1.5`，台账尚未按维护者人工复核关闭 | 否 | 维护者人工复核 `v0.1.7` 签名 Release 供应链记录和发布记录后，明确关闭或继续保留该 residual；后续修改 Release workflow、签名策略、依赖审计或创建新 Release 前重新复核 | `docs/development/release-supply-chain-v0.1.7.md`、`docs/development/release-v0.1.7-record.md`、GitHub Release run `29179904808` 成功、SBOM asset、provenance asset、`SHA256SUMS` 覆盖记录、cosign `Verified OK`、`pnpm release:supply-chain:validate` 通过、`pnpm ops:long-term:gate` 返回 `ready_for_long_term_operability_review` | `areaforge-supply-chain` |
| AF-RISK-SC-002 | closed-evidence | 2026-10-10 | CI-only 供应链证据已可对已验证 checkpoint `b9bbfa2072a79318fc93f6e9497fe4f4b3da29b7` 复核：GitHub CI run `29167042314` 通过，记录见 `docs/development/ci-supply-chain-20260711-b9bbfa2.txt`；外部 Actions pin 到 40 位 commit SHA、`pnpm audit:prod` high 阈值通过、governance/skills/release supply-chain selftest 通过，且 CI-only 记录要求 `expectedGitCommit` 与 GitHub run `gitCommit` 一致；该项不关闭 `AF-RISK-SC-001` 的签名 Release / SBOM / provenance 证据 | 否 | 后续修改 GitHub Actions、依赖审计策略、release workflow、供应链记录生成/校验或创建新 Release 前，重新生成对应代码 checkpoint 的 CI-only 或签名 Release 供应链记录并通过校验；若 high/critical 漏洞、未 pin action 或 commit mismatch 出现则重新打开 | `docs/development/ci-supply-chain-20260711-b9bbfa2.txt`、GitHub Actions run 成功记录、`pnpm governance:preflight` 输出、`pnpm audit:prod` high 阈值通过、Actions pinning 计数、CI-only `expectedGitCommit` / `gitCommit` match、`pnpm sc:sc-002:preflight` 返回 `ready_for_sc002_review`、`pnpm ci:supply-chain:validate` 通过；签名 Release 仍另需 `pnpm release:supply-chain:validate` | `areaforge-supply-chain` / `areaforge-enterprise-governance` |
| AF-RISK-SC-003 | closed-evidence | 2026-10-10 | 本地 UX smoke 曾复现 `pg` transaction client query queue deprecation；`packages/db` 已对 Prisma pg adapter transaction query 进行串行化，增强后的 trace 覆盖 representative include 路径且无 warning | 否 | 后续升级 `pg` / `@prisma/adapter-pg` 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke；若 warning 复现则重新打开 | `pnpm why pg --recursive` 只有 `pg@8.22.0`；临时 PostgreSQL 16 库 `pnpm db:migrate:deploy` 通过；`NODE_OPTIONS=--trace-deprecation pnpm pg:trace-deprecation` matchedWarningCount=0；`NODE_OPTIONS=--trace-deprecation pnpm smoke:local-ux` 通过且 server log 无 deprecation warning | `areaforge-supply-chain` / `areaforge-sre-ops` |
| AF-RISK-OPS-003 | deferred-work | 2026-09-10 | 未来服务器、域名、Nginx 或端口迁移会影响公网 health 和 updater 状态 | 否 | 新迁移 runbook、备份、Nginx/compose hash、health、rollback 记录齐全 | 迁移记录、release/update evidence、DNS/TLS 检查 | `areaforge-sre-ops` |
| AF-RISK-OPS-004 | monitoring-gap | 2026-08-10 | 告警阈值已有非执行策略；2026-07-11 已保存 manual-window alert preview 和告警/恢复演练记录，`pnpm ops:ops-004:preflight` 可返回 `ready_for_human_close`；metrics dashboard 和外部告警接收人仍未产品化，台账关闭仍待维护者人工复核 | 否 | 配置外部告警接收人或人工值班窗口，完成一次告警/恢复演练记录，并通过 OPS-004 证据预检；当前 manual-window 证据可作为人工关闭复核输入 | `docs/development/ops-004-alert-preview-20260711.json`、`docs/development/ops-004-alert-drill-20260711-manual-window.txt`、`pnpm alert:drill:validate` 通过、`pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`、值班窗口或外部接收人说明、恢复记录 | `areaforge-observability` |
| AF-RISK-UX-001 | closed-evidence | 2026-07-24 | 2026-07-10 本地真实体验复核已覆盖 desktop/mobile、核心旅程、未授权状态和确认边界；记录见 `docs/development/product-experience-review-20260710-local.md`，截图见 `output/playwright/experience-review/` | 否 | 后续 release/update、体验改动或超过 14 天维护窗口前，重新完成 desktop/mobile 体验复核并通过 `pnpm experience:review:validate`；若复核失败则重新打开为 monitoring-gap | `pnpm smoke:local-ux` 31/31 通过；desktop/mobile/unauth Playwright 截图；`pnpm experience:review:validate docs/development/product-experience-review-20260710-local.md` 通过 | `areaforge-product-experience` / `areaforge-qa-smoke` |

## 关闭规则

- 关闭残余项必须追加证据，不从“看起来没问题”关闭。
- 每个残余项必须设置 `复核时间` / `reviewAt`。到期后若仍未关闭，应更新影响、关闭条件、所需证据或风险接受理由。
- 若残余项变成当前发布或事故阻塞，应升级为 `current-blocker` 并写入任务或 incident 记录。
- 历史 release 记录中的旧限制不改写；如会误导当前状态，在当前台账中标为 historical reference 或 closed evidence。
