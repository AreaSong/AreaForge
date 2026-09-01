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
| AF-RISK-OPS-001 | 已 `closed-evidence`：`v0.1.9` 生产只读 smoke、redacted update-agent status、backup/restore preview、operational evidence bundle、closure packet 与人工 closeout 已齐；`pnpm ops:ops-001:preflight` 已达 `ready_for_human_close`，`pnpm ops:ops-001:closure:validate` 已通过；新生产版本或证据过期时必须重采，不能沿用旧版本证据 | `areaforge-sre-ops` / `areaforge-qa-smoke` | 后续 release/update、证据过期、preflight 不再 ready 或 validator 失败时重新打开并重采 |
| AF-RISK-OPS-002 | 写入型生产 smoke 策略已有非执行草案，但仍缺账号、确认、清理和受控记录 | `areaforge-qa-smoke` / `areaforge-security-governance` | 执行生产写入 smoke 前 |
| AF-RISK-REL-001 | `AREAFORGE_AUTO_APPLY=none` 是安全默认，不等于自动应用已启用 | `areaforge-release-operator` / `areaforge-sre-ops` | 调整自动更新策略前 |
| AF-RISK-SC-001 | 已 `closed-evidence`：`v0.1.9` 签名 Release assets、strict 供应链校验、evidence-only closeout binding 与人工 closeout 已齐；该证据不覆盖未来 Release | `areaforge-supply-chain` | 创建新 Release、签名策略/workflow 变化、strict 校验失败或 closeout binding 失效时重新打开并重采 |
| AF-RISK-SC-002 | 已按 exact commit `5bec626` 的成功 CI run 关闭为 CI-only 证据项；v1.1 Release 前须重跑 `pnpm sc:sc-002:preflight`、`pnpm ci:supply-chain:validate`、`pnpm release:supply-chain:validate` | `areaforge-supply-chain` / `areaforge-enterprise-governance` | 创建新 Release 或改 Actions/依赖审计前；承接 task `0035` |
| AF-RISK-SC-003 | 已关闭为证据项；`packages/db` 已串行化 Prisma pg adapter transaction query，后续升级 `pg` / Prisma adapter 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke | `areaforge-supply-chain` / `areaforge-sre-ops` | 升级 `pg` / Prisma adapter 前 |
| AF-RISK-SC-004 | 已 `closed-evidence`：规范化 `Protect main` readback、受控 PR `#18`、validator/preflight 与人工 closeout 已齐；v1.1 Release admission 仍要求同一维护窗口内 fresh readback + controlled PR，重采要求不自动改变 residual 状态 | `areaforge-enterprise-governance` / `areaforge-supply-chain` | 新 Release admission、ruleset/required check/bypass 漂移、readback 过期或 validator 失败时重采；满足重新打开条件时再走人工决策 |
| AF-RISK-OPS-003 | 服务器、域名、Nginx 或端口迁移需单独 runbook 和证据 | `areaforge-sre-ops` | 基础设施迁移前 |
| AF-RISK-OPS-004 | 已 `closed-evidence`：`v0.1.9` alert preview、匹配的 manual-window drill、validator/preflight 与人工 closeout 已齐；外部接收人和 metrics dashboard 未产品化仍是能力边界，不等于该 residual 未关闭 | `areaforge-observability` | 新版本 alert preview 漂移、drill 失配、接收人 ACK 缺失或 validator 失败时重新打开 |
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
| AF-RISK-SC-004 | `tasks/backlog/0023-github-main-protection.md`、`tasks/active/0035-v11-batch11-minor-release.md` | 历史远端实施已 `closed-evidence`；Batch 11 只承接 v1.1 admission 所需 fresh readback/controlled PR，不自动改变 residual 状态 |
| AF-RISK-UX-001 | `tasks/active/0024-ux-residual-closure-review.md`、`tasks/active/0037-v12-release-preparation.md` | active；v1.2 任务只重采 current-bound 体验证据，不自动改变 residual 状态 |
| AF-RISK-DATA-001 | `tasks/done/0029-v11-batch5-resources-import-confirm.md` | Batch 5 已完成；生命周期已接受，residual 不自动关闭 |
| AF-RISK-SC-002 | `tasks/active/0035-v11-batch11-minor-release.md`、`tasks/active/0037-v12-release-preparation.md` | active；v1.2 PR/Release 前须重采匹配 commit 的 CI/供应链证据；不自动改变 residual 状态 |

其他 residual 的 `taskRefs=[]`。`AF-RISK-REL-001` 使用已有历史 accepted exception，不使用 task promotion waiver；接受例外不等于 executable task，也不授权 patch 自动应用。
