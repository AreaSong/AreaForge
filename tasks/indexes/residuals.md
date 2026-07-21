# Residual Risk Index

本索引面向执行任务，只解释哪些残余项可能影响下一步工作。权威关闭条件仍以 `docs/development/residual-risk-ledger.md` 和 `docs/development/residual-risk-ledger.json` 为准。

## 使用规则

- 不把 residual 当作 Package A-E 未完成；Package A-E 的当前 docs 100% 主线已闭环。
- 触发发布、运维、安全、供应链或真实体验判断时，先查本索引，再回到权威台账确认关闭条件。
- 若 residual 到达 `reviewAt` 仍未关闭，更新影响、关闭条件、所需证据或风险接受理由。
- 若 residual 变成当前工作阻塞，升级为任务或 incident，不只停留在本索引。
- schema V2 的 `taskRefs` 必须指向现存 task，并由 task YAML 的 `residualRiskIds` 反向绑定；`executableNow=true` 必须有 active task 或仍在有效期内的人工 promotion waiver。
- 当前没有 task promotion waiver；不得用空 waiver、过期 waiver 或 backlog task 解释可立即执行状态。
- 使用 `pnpm residuals:promotion-preview` 只读检查 active task、waiver、backlog/done 和 exception 状态；preview 不生成目标路径、不移动任务、不修改台账，也不替代人工 promotion 决策。
- 维护者形成 close / keep-open / downgrade / reopen 结论时，先用 `docs/development/residual-closure-review-template.md` 和 `pnpm residuals:closure:validate <record>` 固定复核记录；该记录保持 `closesResidual=no`，不自动修改权威台账。

## 当前索引

| ID | 执行影响 | 下一 owner | 触发时机 |
|---|---|---|---|
| AF-RISK-OPS-001 | 2026-07-11/12 生产只读 fallback 已补齐 smoke 凭据配置并形成可人工复核证据；`v0.1.7` 生产 updater apply 时 extra smoke 通过；post-`v0.1.7` 只读 operational evidence bundle 已保存但状态为 `needs_attention`，因为 redacted update-agent status 和 production readonly smoke record 尚未重新采集入仓库；台账仍待维护者人工复核关闭 | `areaforge-sre-ops` / `areaforge-qa-smoke` | 每次 release/update 后或维护窗口复核；关闭台账前复核最新生产版本对应的 OPS-001 证据目录、`pnpm ops:ops-001:preflight` 和 `pnpm ops:ops-001:closure:validate` 输出 |
| AF-RISK-OPS-002 | 写入型生产 smoke 策略已有非执行草案，但仍缺账号、确认、清理和受控记录 | `areaforge-qa-smoke` / `areaforge-security-governance` | 执行生产写入 smoke 前 |
| AF-RISK-REL-001 | `AREAFORGE_AUTO_APPLY=none` 是安全默认，不等于自动应用已启用 | `areaforge-release-operator` / `areaforge-sre-ops` | 调整自动更新策略前 |
| AF-RISK-SC-001 | `v0.1.7` 签名 Release 已生成并校验 SBOM/provenance、checksum、cosign signature 和 GHCR digest 证据，并已由服务器侧 updater 应用到生产；带当前 release supply-chain record 路径运行 `pnpm sc:sc-002:preflight` 已到 `ready_for_sc001_sc002_review`，台账仍待维护者人工复核关闭 | `areaforge-supply-chain` | 关闭台账前复核 `release-supply-chain-v0.1.7` / `release-v0.1.7`；生产 apply 不自动关闭 residual；后续创建新 Release 或修改 release workflow 前 |
| AF-RISK-SC-002 | 已按 exact commit `5bec626` 的成功 CI run 关闭为 CI-only 证据项；v1.1 Release 前须重跑 `pnpm sc:sc-002:preflight`、`pnpm ci:supply-chain:validate`、`pnpm release:supply-chain:validate` | `areaforge-supply-chain` / `areaforge-enterprise-governance` | 创建新 Release 或改 Actions/依赖审计前；承接 task `0035` |
| AF-RISK-SC-003 | 已关闭为证据项；`packages/db` 已串行化 Prisma pg adapter transaction query，后续升级 `pg` / Prisma adapter 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke | `areaforge-supply-chain` / `areaforge-sre-ops` | 升级 `pg` / Prisma adapter 前 |
| AF-RISK-SC-004 | GitHub `main` ruleset `19138434`、required PR/approval、GitHub Actions `verify`、delete/non-fast-forward 禁止和无 bypass 已读回；受控 PR `#13` 已覆盖失败/成功检查并关闭未合并。远端实施完成，residual 仍待人工 close/keep-open 决策 | `areaforge-enterprise-governance` / `areaforge-supply-chain` | 复核两份 `output/supply-chain/github-main-protection-*.json`、validator/preflight 与 ruleset/check 漂移后，维护者明确 close 或 keep-open；不得自动关闭 |
| AF-RISK-OPS-003 | 服务器、域名、Nginx 或端口迁移需单独 runbook 和证据 | `areaforge-sre-ops` | 基础设施迁移前 |
| AF-RISK-OPS-004 | 2026-07-11 manual-window alert preview 和告警/恢复演练记录保留为历史输入；post-`v0.1.7` alert preview 与 `docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt` 已匹配，带当前 preview/drill 路径运行 `pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`；外部接收人和 metrics dashboard 仍未产品化，台账关闭需维护者人工复核 | `areaforge-observability` | 建立外部告警、关闭 OPS-004 或声称完整生产健康前 |
| AF-RISK-OPS-005 | 已 closed-evidence：v0.1.9 生产 mismatch 证据包通过 `ops:ops-005:evidence:validate`；closeout 见 `docs/development/residual-closure-review-20260721-ops-005-closeout.md`。dirty worktree 下 `ops:ops-005:preflight` 仍可能 `needs_signed_release`，不构成重新打开条件 alone | `areaforge-security-governance` / `areaforge-release-operator` / `areaforge-sre-ops` | 新 Release、expectedBefore 语义变化、evidence:validate 失败或生产版本变化时重新打开 |
| AF-RISK-OPS-006 | 已 closed-evidence：Phase B doctor 时间序 + probe + write-smoke PASS，`ops:ops-006:evidence:validate` 通过；closeout 见 `docs/development/residual-closure-review-20260721-ops-006-closeout.md`。dirty worktree 下 production:preflight 仍可能 blocked | `areaforge-security-governance` / `areaforge-sre-ops` / `areaforge-validation-driver` | 新 Release、concurrency 语义变化、evidence:validate 失败或 doctor/smoke 过期时重新打开 |
| AF-RISK-OPS-007 | 已 closed-evidence：生产迁移已 apply + recon/doctor pass，协议记录已绑定；closeout 见 `docs/development/residual-closure-review-20260721-ops-007-closeout.md`。当前 dirty checkout 下本地 preflight 可能因 runtime hash drift 为 invalid | `areaforge-file-storage-safety` / `areaforge-security-governance` | 新 Release、附件协议变化、生产 recon/doctor 失败，或需 fresh local_verified 时重新打开并刷新隔离 runtime |
| AF-RISK-OPS-008 | 已 closed-evidence：生产 hold/barrier/clear/timers 已观测；`ops:ops-008:preflight:strict=local_verified`；closeout 见 `docs/development/residual-closure-review-20260721-ops-008-closeout.md` | `areaforge-sre-ops` / `areaforge-observability` / `areaforge-security-governance` | 新 Release、hold/journal 语义变化、preflight 不再 local_verified 或生产 hold 证据失效时重新打开 |
| AF-RISK-UX-001 | 已 closed-evidence：current-bound local UX review；本地证据不证明生产写入体验；重审时运行 `pnpm experience:review:validate` | `areaforge-product-experience` / `areaforge-qa-smoke` | 体验改动或 fingerprint 漂移后重审 |
| AF-RISK-DATA-001 | 生命周期边界已接受（2026-07-21），允许隔离 confirm；长期留存/备份扩散与缺物理删除仍未关；保持 deferred-work | `areaforge-security-governance` / `areaforge-file-storage-safety` | 关闭需 fixture+物理删除/撤销路线证据；重开见台账 closeCondition |

## Task Bindings

| Residual | Task | 状态边界 |
|---|---|---|
| AF-RISK-OPS-005 | `tasks/active/0019-update-request-expected-before-binding.md` | active；residual 已 closed-evidence，task 仅保留证据/实现追溯 |
| AF-RISK-OPS-006 | `tasks/active/0020-business-state-concurrency.md` | active；residual 已 closed-evidence，task 仅保留证据/实现追溯 |
| AF-RISK-OPS-007 | `tasks/active/0021-attachment-staging-intent.md` | active；residual 已 closed-evidence，task 仅保留证据/实现追溯 |
| AF-RISK-OPS-008 | `tasks/active/0022-updater-phase-journal-hold.md` | active；residual 已 closed-evidence，task 仅保留证据/实现追溯 |
| AF-RISK-SC-004 | `tasks/backlog/0023-github-main-protection.md` | backlog blocked；远端实施已验证，等待维护者 residual 决策 |
| AF-RISK-UX-001 | `tasks/active/0024-ux-residual-closure-review.md` | active；residual 已 closed-evidence，task 仅保留证据/实现追溯 |
| AF-RISK-DATA-001 | `tasks/done/0029-v11-batch5-resources-import-confirm.md` | Batch 5 已完成；生命周期已接受，residual 不自动关闭 |
| AF-RISK-SC-002 | `tasks/active/0035-v11-batch11-minor-release.md` | active；v1.1 minor Release 前须重采匹配 commit 的 CI/供应链证据；不自动改变 residual 状态 |

其他 residual 的 `taskRefs=[]`。`AF-RISK-REL-001` 使用已有历史 accepted exception，不使用 task promotion waiver；接受例外不等于 executable task，也不授权 patch 自动应用。
