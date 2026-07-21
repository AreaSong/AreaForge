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
| AF-RISK-SC-002 | 已按 exact commit `5bec626` 的成功 CI run `29634081982` 关闭为 CI-only 证据项；record、人工复核和 clean detached worktree preflight 均通过，且明确不关闭 SC-001 | `areaforge-supply-chain` / `areaforge-enterprise-governance` | 后续修改 GitHub Actions、依赖审计、Release workflow、供应链记录工具或创建新 Release 前，重新生成匹配 commit 证据并运行 `pnpm ci:supply-chain:validate`；进入签名 Release 时补跑 `pnpm release:supply-chain:validate <record> <release-assets-dir> --strict`。匹配 CI 失败、commit mismatch、未 pin action 或 high/critical 漏洞时重新打开 |
| AF-RISK-SC-003 | 已关闭为证据项；`packages/db` 已串行化 Prisma pg adapter transaction query，后续升级 `pg` / Prisma adapter 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke | `areaforge-supply-chain` / `areaforge-sre-ops` | 升级 `pg` / Prisma adapter 前 |
| AF-RISK-SC-004 | GitHub `main` ruleset `19138434`、required PR/approval、GitHub Actions `verify`、delete/non-fast-forward 禁止和无 bypass 已读回；受控 PR `#13` 已覆盖失败/成功检查并关闭未合并。远端实施完成，residual 仍待人工 close/keep-open 决策 | `areaforge-enterprise-governance` / `areaforge-supply-chain` | 复核两份 `output/supply-chain/github-main-protection-*.json`、validator/preflight 与 ruleset/check 漂移后，维护者明确 close 或 keep-open；不得自动关闭 |
| AF-RISK-OPS-003 | 服务器、域名、Nginx 或端口迁移需单独 runbook 和证据 | `areaforge-sre-ops` | 基础设施迁移前 |
| AF-RISK-OPS-004 | 2026-07-11 manual-window alert preview 和告警/恢复演练记录保留为历史输入；post-`v0.1.7` alert preview 与 `docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt` 已匹配，带当前 preview/drill 路径运行 `pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`；外部接收人和 metrics dashboard 仍未产品化，台账关闭需维护者人工复核 | `areaforge-observability` | 建立外部告警、关闭 OPS-004 或声称完整生产健康前 |
| AF-RISK-OPS-005 | 本地 V2 expected-before、目标身份、TTL、idempotency/hash、no-clobber publish、directory fsync uncertain、processing reconciliation、不可变 decision history 和共享 production-state lock 已实现；Release workflow 已增加 strict assets/manifest/cosign 校验，生产 validator 已绑定实际 redacted rejection/history/operational JSON；尚缺匹配签名 Release、生产部署和 fresh evidence | `areaforge-security-governance` / `areaforge-release-operator` / `areaforge-sre-ops` | 先创建匹配提交的签名 Release并严格验证 record+assets；生产部署必须再次确认并暂停 timer、隔离旧队列、验证 V2 check，随后验证 JSON path+hash 和 `executionAttempted=no` rejection |
| AF-RISK-OPS-006 | partial unique index、task/session CAS、结束计时单次副作用和 CheckIn 锁已达到隔离 PostgreSQL `local_verified`；尚未进入匹配签名 Release 或生产 migration/deploy | `areaforge-security-governance` / `areaforge-sre-ops` / `areaforge-validation-driver` | 先创建匹配 exact commit 的签名 Release；生产前另行确认 fresh doctor、additive migration、health/smoke/rollback 与 after-doctor，不得从本地 pass 直接部署 |
| AF-RISK-OPS-007 | staging/write-intent 协议已在当前 checkout 本地实施并通过隔离 runtime selftest 达 `local_verified`；生产仍运行旧协议，崩溃窗口风险在生产未消除 | `areaforge-file-storage-safety` / `areaforge-security-governance` | 先创建匹配 exact commit 的签名 Release；生产 additive migration/deploy 另行确认（先跑重复 storage identity doctor 预检），不得从本地 pass 直接部署 |
| AF-RISK-OPS-008 | 本地 local_verified；生产 timer/hold/apply 与签名 Release 仍未证明 | `areaforge-sre-ops` / `areaforge-observability` / `areaforge-security-governance` | 生产 timer/hold/apply 与匹配签名 Release 仍需单独确认 |
| AF-RISK-UX-001 | local UX smoke guardrail selftest 已通过；共享 evaluator 当前将最新记录判为 `invalid`，因为 git commit、source hash 和 runtime identity 不匹配当前 checkout。残余仍 open，且生产体验未被本地证据证明，窄屏任务选择器仍有 polish follow-up | `areaforge-product-experience` / `areaforge-qa-smoke` | 启动当前 checkout runtime，重新采集 current-bound desktop/mobile review 与 runtime probe，运行 `pnpm experience:review:validate`；随后由维护者 reaffirm `keep-open` 或另行授权 residual 台账更新 |

## Task Bindings

| Residual | Task | 状态边界 |
|---|---|---|
| AF-RISK-OPS-005 | `tasks/active/0019-update-request-expected-before-binding.md` | active；等待签名 Release、独立生产部署和 fresh evidence |
| AF-RISK-OPS-006 | `tasks/active/0020-business-state-concurrency.md` | active local-verified；等待签名 Release、独立生产 migration/deploy 和 fresh evidence |
| AF-RISK-OPS-007 | `tasks/active/0021-attachment-staging-intent.md` | active local-verified；等待签名 Release、独立生产 migration/deploy 和 fresh evidence |
| AF-RISK-OPS-008 | `tasks/active/0022-updater-phase-journal-hold.md` | active local-verified；生产仍 blocked |
| AF-RISK-SC-004 | `tasks/backlog/0023-github-main-protection.md` | backlog blocked；远端实施已验证，等待维护者 residual 决策 |
| AF-RISK-UX-001 | `tasks/active/0024-ux-residual-closure-review.md` | active in-progress；只做维护者 close/keep-open 复核，不自动修改台账 |

其他 residual 的 `taskRefs=[]`。`AF-RISK-REL-001` 使用已有历史 accepted exception，不使用 task promotion waiver；接受例外不等于 executable task，也不授权 patch 自动应用。
