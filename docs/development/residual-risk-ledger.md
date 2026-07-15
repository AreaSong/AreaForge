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
| AF-RISK-OPS-001 | current-blocker | 2026-07-17 | 2026-07-11/12 生产只读 fallback 已补齐 smoke 账号和权限收紧的 smoke password file，并形成可人工复核证据；`v0.1.7` 生产 updater apply 时 extra smoke 通过；post-`v0.1.7` 只读 evidence bundle 已保存但状态为 `needs_attention`，因为 redacted update-agent status 和 production readonly smoke record 尚未重新采集入仓库；台账尚未按维护者人工复核关闭 | 否 | 服务器配置 `AREAFORGE_EXTRA_SMOKE_COMMAND`、smoke 账号和权限收紧的 smoke 密码文件；最近一次生产版本对应的只读 smoke 通过、redacted update-agent status、operational evidence bundle 和 OPS-001 收口包齐全；生产更新后必须重采或明确降级旧证据为历史 | `docs/development/ops-001-production-readonly-attempt-20260711.md`、`docs/development/ops-001-production-readonly-20260711/prod-readonly-smoke-record.txt`、`docs/development/ops-001-production-readonly-20260711/redacted-update-status.json`、`docs/development/ops-001-production-readonly-20260711/operational-evidence-bundle.json`、`docs/development/ops-001-production-readonly-20260711/ops-001-closure-packet.txt`、`docs/development/release-v0.1.7-record.md`、`docs/development/operational-evidence-bundle-v0.1.7-20260712.json`、后续 post-`v0.1.7` redacted smoke/status/OPS-001 closure packet、`pnpm smoke:prod-readonly:validate` 通过、`pnpm update-agent:status:validate` 通过、`pnpm ops:evidence:bundle:validate` 通过、`pnpm ops:ops-001:closure:validate` 通过、`pnpm ops:ops-001:preflight` 返回 `ready_for_human_close` | `areaforge-sre-ops` / `areaforge-qa-smoke` |
| AF-RISK-OPS-002 | deferred-work | 2026-08-10 | 写入型生产 smoke 策略已有非执行草案；仍缺专用账号、用户确认、清理策略和受控记录 | 否 | 明确 smoke 账号、允许写入范围、清理策略、失败处理方式并获确认后，完成至少一次受控记录 | 确认记录、测试账号、写入对象 ID、清理或保留说明、smoke 结果 | `areaforge-qa-smoke` / `areaforge-security-governance` |
| AF-RISK-REL-001 | accepted-exception | 2026-08-10 | `AREAFORGE_AUTO_APPLY=none` 是当前安全默认；patch 自动应用尚未启用 | 否 | 用户明确确认 patch 自动应用，且签名、备份、extra smoke、rollback target 和 manifest policy 同时满足 | 确认记录、updater env 摘要、release manifest、smoke 和 rollback evidence | `areaforge-release-operator` / `areaforge-sre-ops` |
| AF-RISK-SC-001 | deferred-work | 2026-08-10 | `v0.1.7` 签名 GitHub Release 已生成 SBOM/provenance、`SHA256SUMS`、`SHA256SUMS.sig` 和 GHCR digest 证据，且已由服务器侧 updater 应用到生产；`pnpm release:supply-chain:validate` 已通过，并且带 `AREAFORGE_SC002_RELEASE_RECORD=docs/development/release-supply-chain-v0.1.7.md` 运行 `pnpm sc:sc-002:preflight` 可返回 `ready_for_sc001_sc002_review`；台账尚未按维护者人工复核关闭 | 否 | 维护者人工复核 `v0.1.7` 签名 Release 供应链记录和发布记录后，明确关闭或继续保留该 residual；生产 apply 不自动关闭该 residual，后续修改 Release workflow、签名策略、依赖审计或创建新 Release 前重新复核 | `docs/development/release-supply-chain-v0.1.7.md`、`docs/development/release-v0.1.7-record.md`、GitHub Release run `29179904808` 成功、SBOM asset、provenance asset、`SHA256SUMS` 覆盖记录、cosign `Verified OK`、服务器 updater apply 记录、`pnpm release:supply-chain:validate` 通过、带当前 release record 路径的 `pnpm sc:sc-002:preflight` 返回 `ready_for_sc001_sc002_review`；`pnpm ops:long-term:gate` 仅用于整体长期运营完成声明，不作为 SC-001 关闭条件 | `areaforge-supply-chain` |
| AF-RISK-SC-002 | closed-evidence | 2026-10-10 | CI-only 供应链证据已可对已验证 checkpoint `b9bbfa2072a79318fc93f6e9497fe4f4b3da29b7` 复核：GitHub CI run `29167042314` 通过，记录见 `docs/development/ci-supply-chain-20260711-b9bbfa2.txt`；外部 Actions pin 到 40 位 commit SHA、`pnpm audit:prod` high 阈值通过、governance/skills/release supply-chain selftest 通过，且 CI-only 记录要求 `expectedGitCommit` 与 GitHub run `gitCommit` 一致；该项不关闭 `AF-RISK-SC-001` 的签名 Release / SBOM / provenance 证据 | 否 | 后续修改 GitHub Actions、依赖审计策略、release workflow、供应链记录生成/校验或创建新 Release 前，重新生成对应代码 checkpoint 的 CI-only 或签名 Release 供应链记录并通过校验；若 high/critical 漏洞、未 pin action 或 commit mismatch 出现则重新打开 | `docs/development/ci-supply-chain-20260711-b9bbfa2.txt`、GitHub Actions run 成功记录、`pnpm governance:preflight` 输出、`pnpm audit:prod` high 阈值通过、Actions pinning 计数、CI-only `expectedGitCommit` / `gitCommit` match、带 CI-only record 路径的 `pnpm sc:sc-002:preflight` 返回 `ready_for_sc002_review`、`pnpm ci:supply-chain:validate` 通过；签名 Release 仍另需 `pnpm release:supply-chain:validate` | `areaforge-supply-chain` / `areaforge-enterprise-governance` |
| AF-RISK-SC-003 | closed-evidence | 2026-10-10 | 本地 UX smoke 曾复现 `pg` transaction client query queue deprecation；`packages/db` 已对 Prisma pg adapter transaction query 进行串行化，增强后的 trace 覆盖 representative include 路径且无 warning | 否 | 后续升级 `pg` / `@prisma/adapter-pg` 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke；若 warning 复现则重新打开 | `pnpm why pg --recursive` 只有 `pg@8.22.0`；临时 PostgreSQL 16 库 `pnpm db:migrate:deploy` 通过；`NODE_OPTIONS=--trace-deprecation pnpm pg:trace-deprecation` matchedWarningCount=0；`NODE_OPTIONS=--trace-deprecation pnpm smoke:local-ux` 通过且 server log 无 deprecation warning | `areaforge-supply-chain` / `areaforge-sre-ops` |
| AF-RISK-OPS-003 | deferred-work | 2026-09-10 | 未来服务器、域名、Nginx 或端口迁移会影响公网 health 和 updater 状态 | 否 | 新迁移 runbook、备份、Nginx/compose hash、health、rollback 记录齐全 | 迁移记录、release/update evidence、DNS/TLS 检查 | `areaforge-sre-ops` |
| AF-RISK-OPS-004 | monitoring-gap | 2026-08-10 | 告警阈值已有非执行策略；2026-07-11 manual-window alert preview 和告警/恢复演练记录保留为历史输入；post-`v0.1.7` alert preview 已保存为 `docs/development/ops-004-alert-preview-v0.1.7-20260712.json`，matching drill 已保存为 `docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt`，带当前 preview/drill 环境变量运行 `pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`；metrics dashboard 和外部告警接收人仍未产品化，台账关闭仍待维护者人工复核 | 否 | 配置外部告警接收人或人工值班窗口，完成一次与当前版本 alert preview 匹配的告警/恢复演练记录，并通过 OPS-004 证据预检；历史 manual-window 证据只能作为参考输入；`ready_for_human_close` 不自动关闭台账 | `docs/development/ops-004-alert-preview-20260711.json`、`docs/development/ops-004-alert-drill-20260711-manual-window.txt`、`docs/development/ops-004-alert-preview-v0.1.7-20260712.json`、`docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt`、`pnpm alert:drill:validate` 通过、带当前 preview/drill 路径的 `pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`、值班窗口或外部接收人说明、恢复记录 | `areaforge-observability` |
| AF-RISK-OPS-005 | current-blocker | 2026-07-20 | 当前 checkout 已实现 schema V2、用户确认 snapshot binding、目标 Release/manifest/digest、rollback source record/target、TTL、idempotency/hash、processing reconciliation、不可变 decision history、legacy mutation fail-closed 和共享 production-state lock，并通过本地门禁；该实现尚未进入匹配签名 Release 或生产部署，线上 `v0.1.7` 不能据此宣称具备 V2 stale-request 防护 | 否 | 保留已通过的本地 V2 证据；创建匹配提交的签名 Release；随后通过独立生产部署确认暂停 timer、隔离旧队列、部署匹配 Web/agent、V2 check 验证并恢复 timer；取得 24 小时内 fresh redacted decision history 后人工复核 | `docs/development/update-request-expected-before-design.md`、`docs/development/ops-005-expected-before-production-evidence-template.md`、`tasks/active/0019-update-request-expected-before-binding.md`、`pnpm ops:ops-005:local:selftest` / `pnpm shellcheck:updater` / `pnpm github-release-updater:preflight` 通过、后续匹配签名 Release、生产部署记录、V2 check、至少一条 `executionAttempted=no` 的 expected-before rejection fixture 或受控 redacted evidence、shared-lock/processing reconciliation 证据、`AREAFORGE_AUTO_APPLY=none` 证明、`pnpm ops:ops-005:evidence:validate` 通过、`pnpm ops:ops-005:preflight` 返回 `ready_for_ops005_human_review` | `areaforge-security-governance` / `areaforge-release-operator` / `areaforge-sre-ops` |
| AF-RISK-UX-001 | closed-evidence | 2026-07-24 | 2026-07-10 本地真实体验复核已覆盖 desktop/mobile、核心旅程、未授权状态和确认边界；2026-07-12 已新增本地 `0.1.7` desktop/mobile 复核记录 `docs/development/product-experience-review-v0.1.7-20260712-local.md`，证明当前 checkout 的本地体验路径可用；该证据不证明生产写入型 smoke、生产附件写入或真实用户数据体验 | 否 | 后续 release/update、体验改动或超过 14 天维护窗口前，重新完成 desktop/mobile 体验复核并通过 `pnpm experience:review:validate`；若复核失败则重新打开为 monitoring-gap | `pnpm smoke:local-ux` 31/31 通过；desktop/mobile/unauth browser 截图；`pnpm experience:review:validate docs/development/product-experience-review-20260710-local.md` 通过；`pnpm experience:review:validate docs/development/product-experience-review-v0.1.7-20260712-local.md` 通过；后续 release/update 后需新增对应体验复核记录 | `areaforge-product-experience` / `areaforge-qa-smoke` |

## 关闭规则

- 关闭残余项必须追加证据，不从“看起来没问题”关闭。
- 每个残余项必须设置 `复核时间` / `reviewAt`。到期后若仍未关闭，应更新影响、关闭条件、所需证据或风险接受理由。
- 若残余项变成当前发布或事故阻塞，应升级为 `current-blocker` 并写入任务或 incident 记录。
- 历史 release 记录中的旧限制不改写；如会误导当前状态，在当前台账中标为 historical reference 或 closed evidence。

## 人工复核关闭清单

`ready_for_human_close`、`ready_for_ops005_human_review` 或 `ready_for_sc001_sc002_review` 只表示证据形态可复核，不自动关闭台账。维护者关闭、保留、降级或重新打开 `AF-RISK-OPS-001`、`AF-RISK-SC-001`、`AF-RISK-OPS-004` 或 `AF-RISK-OPS-005` 前，先使用 `docs/development/residual-closure-review-template.md` 保存人工复核记录并运行：

```bash
pnpm residuals:closure:validate <residual-closure-review-record.md|txt>
```

该记录必须保持 `closesResidual: no`；它只证明人工复核结论和证据边界完整，不修改 Markdown/JSON 台账。若结论是 `reviewDecision: close`，后续仍需单独更新台账并运行 `pnpm residuals:validate`。

人工复核记录至少包含：

- reviewer 和复核日期。
- residual ID、当前类型和复核结论：close / keep-open / downgrade / reopen。
- 证据路径：生产只读 smoke、redacted update-agent status、operational evidence bundle、alert drill、release supply-chain record 或 release record。
- validator 输出：对应 `pnpm ...:validate`、`pnpm ops:ops-001:preflight`、`pnpm ops:ops-004:preflight`、`pnpm ops:ops-005:preflight`、`pnpm ops:ops-005:evidence:validate`、`pnpm sc:sc-002:preflight` 或 `pnpm ops:long-term:gate` 的通过结论。
- 重新打开条件：新 release/update、证据超过窗口、workflow/updater/签名策略变化、smoke/alert 失败或生产版本变化。
- 明确未执行事项：未执行 updater apply、backup/restore、migration、rollback、写入型 smoke 或 secrets 读取时，必须写明不能由本次复核证明。

历史记录降级规则：

- 旧 release record 只能证明当时版本的发布事实；不能证明当前 latest Release、当前生产版本或当前供应链状态。
- 旧 smoke、截图或体验记录超过新鲜窗口后只能作为 historical reference；不能支撑当前健康声明。
- 旧 blocked record 在后续 closure packet 通过后仍保留为历史尝试记录，不再作为当前 blocker 结论。
- 生产更新后，更新前的 OPS-001、OPS-004、readiness summary 和 evidence bundle 需要重新采集或明确降级为历史证据。
