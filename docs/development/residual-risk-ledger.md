# 残余风险台账

## 目标

本文件只记录会影响后续发布、生产运维、安全、供应链或真实体验判断的残余项。它不是普通 backlog，也不表示当前 docs 100% 功能未完成。

机器可读索引见 `docs/development/residual-risk-ledger.json`。当前 schema V2 由 `pnpm residuals:validate` 校验与本文、任务索引和任务 metadata 同步。

状态类型遵循 `.codex/skills-src/areaforge-residual-ledger/references/classification.md`：

- `current-blocker`
- `deferred-work`
- `accepted-exception`
- `monitoring-gap`
- `release-follow-up`
- `historical-reference`
- `template-marker`
- `closed-evidence`

schema V2 为每个 item 增加：

- `taskRefs`：已提升的 active/backlog/done 任务路径；引用必须存在，并在任务 YAML 的 `residualRiskIds` 中反向绑定同一 residual。
- `taskPromotionWaiver`：可立即执行但暂不提升任务时的限时人工豁免；当前所有 item 均为 `null`。
- `acceptedException`：仅 `accepted-exception` 可使用的结构化接受事实；其他类型必须为 `null`。接受事实必须绑定接受人、时间、来源、到期日、重新打开条件和 canonical `basisHash`，不得从当前状态或 validator 结果推导新接受事实。

`scripts/quality/residual-ledger-common.ts` 是 schema V2 的权威只读 reader。`operability-status`、handoff、support bundle preview、release closeout、review-due、task doctor、operations lifecycle、residual evidence 和三个长期运营 preflight 均先通过该 reader；缺失、V1、未知字段、无效 task binding、过期 waiver 或 basis hash 漂移必须 fail closed，不能按空台账或部分 item 继续投影。撤销、过期或被替代的 accepted exception 仍是合法历史状态，但必须进入待处理或发布阻断，不能继续视为有效接受。

`pnpm residuals:promotion-preview` 只读展示每项 residual 是已由 active task 承接、由限时 waiver 支撑、仅绑定 backlog/done task、尚未可执行，还是 accepted exception 已失效。它不推断目标 task 路径，不创建或移动 task，不修改 `executableNow`、waiver、exception 或台账，也不构成 promotion 授权。

## 编号规则

- `AF-RISK-OPS-*`：生产运维、备份、smoke、update-agent、基础设施。
- `AF-RISK-REL-*`：发布、自动更新、回滚和 release evidence。
- `AF-RISK-SC-*`：供应链、签名、依赖、SBOM/provenance。
- `AF-RISK-UX-*`：真实体验、可用性、端到端体验证据。
- `AF-RISK-AI-*`：AI provider、隐私、费用、fallback。
- `AF-RISK-DATA-*`：数据生命周期、留存、导出、撤销/删除边界。

## 当前残余项

| ID | 类型 | 复核时间 | 当前影响 | 可立即执行 | 关闭条件 | 所需证据 | Owner |
|---|---|---|---|---|---|---|---|
| AF-RISK-OPS-001 | closed-evidence | 2026-10-21 | v0.1.9 生产只读 smoke、redacted update-agent status、backup-restore preview 绑定的 operational evidence bundle、OPS-001 closure packet 与 ops:ops-001:preflight=ready_for_human_close 已齐；2026-07-21 closeout 人工复核见 docs/development/residual-closure-review-20260721-ops-001-closeout.md | 否 | 后续生产版本变更或证据过期时重采只读 smoke/status/bundle/closure；preflight 不再 ready 或校验失败时重新打开 | docs/development/ops-001-production-readonly-20260721/prod-readonly-smoke-record.txt、redacted-update-status.json、operational-evidence-bundle.json、backup-restore-preview.json、ops-001-closure-packet.txt、docs/development/residual-closure-review-20260721-ops-001-closeout.md、pnpm ops:ops-001:preflight=ready_for_human_close、pnpm ops:ops-001:closure:validate 通过 | `areaforge-sre-ops` / `areaforge-qa-smoke` |
| AF-RISK-OPS-002 | deferred-work | 2026-08-10 | 写入型生产 smoke 策略已有非执行草案；仍缺专用账号、用户确认、清理策略和受控记录 | 否 | 明确 smoke 账号、允许写入范围、清理策略、失败处理方式并获确认后，完成至少一次受控记录 | 确认记录、测试账号、写入对象 ID、清理或保留说明、smoke 结果 | `areaforge-qa-smoke` / `areaforge-security-governance` |
| AF-RISK-REL-001 | accepted-exception | 2026-08-10 | AREAFORGE_AUTO_APPLY=none 是当前安全默认；patch 自动应用尚未启用 | 否 | 用户明确确认 patch 自动应用，且签名、备份、extra smoke、rollback target 和 manifest policy 同时满足 | 确认记录、updater env 摘要、release manifest、smoke 和 rollback evidence | `areaforge-release-operator` / `areaforge-sre-ops` |
| AF-RISK-SC-001 | closed-evidence | 2026-10-21 | v0.1.9 签名 Release assets 通过 --strict；evidence-only closeout 后代上 sc:sc-002:preflight=ready_for_sc001_sc002_review。人工复核见 docs/development/residual-closure-review-20260721-sc-001-closeout.md | 否 | 新 Release、签名策略/workflow 变化、strict 校验失败或 evidence-only binding 失效时重新打开 | docs/development/release-supply-chain-v0.1.9.md、output/release-v0.1.9 assets、docs/development/residual-closure-review-20260721-sc-001-closeout.md、pnpm release:supply-chain:validate --strict、pnpm sc:sc-002:preflight=ready_for_sc001_sc002_review | `areaforge-supply-chain` |
| AF-RISK-SC-002 | closed-evidence | 2026-10-18 | exact commit 5bec62608d929a796b4ca00a91aa95bdf256b27c 的 GitHub Actions CI run 29634081982 已成功；CI-only record 证明 expectedGitCommit=gitCommit、生产依赖审计、governance、Actions 40 位 SHA pinning、skills 和 release supply-chain selftest 均通过，clean detached worktree preflight 返回 ready_for_sc002_review。该关闭仅覆盖 CI-only 证据，不关闭 AF-RISK-SC-001 | 否 | 后续修改 GitHub Actions、依赖审计策略、Release workflow、供应链记录生成/校验工具或创建新 Release 前，重新生成匹配 commit 的 CI-only 或签名 Release 供应链记录；commit mismatch、未 pin action、high/critical 漏洞或匹配 CI 失败时重新打开 | `output/supply-chain/ci-run-29634081982.json`、`output/supply-chain/ci-jobs-29634081982.json`、`output/supply-chain/ci-supply-chain-5bec626.txt`（`sha256:10d0bfd7c6e2b39bd2d4d5d7cba74f9d44c9eaeaa2c79399aa4cd8f096ff9722`）、`output/supply-chain/residual-review-AF-RISK-SC-002-5bec626.txt`（`sha256:bee97b3352482f5be124a22b15bb0cbea4e40f207baf29f211f777f5c4235f95`）、`pnpm ci:supply-chain:validate` 通过、clean detached worktree `pnpm sc:sc-002:preflight` 返回 `ready_for_sc002_review` | `areaforge-supply-chain` / `areaforge-enterprise-governance` |
| AF-RISK-SC-003 | closed-evidence | 2026-10-10 | 本地 UX smoke 曾复现 pg transaction client query queue deprecation；packages/db 已对 Prisma pg adapter transaction query 进行串行化，增强后的 trace 覆盖 representative include 路径且无 warning | 否 | 后续升级 `pg` / `@prisma/adapter-pg` 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke；若 warning 复现则重新打开 | `pnpm why pg --recursive` 只有 `pg@8.22.0`；临时 PostgreSQL 16 库 `pnpm db:migrate:deploy` 通过；`NODE_OPTIONS=--trace-deprecation pnpm pg:trace-deprecation` matchedWarningCount=0；`NODE_OPTIONS=--trace-deprecation pnpm smoke:local-ux` 通过且 server log 无 deprecation warning | `areaforge-supply-chain` / `areaforge-sre-ops` |
| AF-RISK-SC-004 | closed-evidence | 2026-10-21 | 规范化 Protect main readback + controlled PR #18（ci / verify fail→pass）通过 sc:sc-004:validate 与 preflight=ready_for_human_review；2026-07-21 closeout 人工复核见 docs/development/residual-closure-review-20260721-sc-004-closeout.md | 否 | ruleset/required check/bypass 变化、readback 过期或校验失败时重新打开 | output/supply-chain/github-main-protection-readback-20260721.json、output/supply-chain/github-main-protection-controlled-pr-20260721.json、docs/development/residual-closure-review-20260721-sc-004-closeout.md、https://github.com/AreaSong/AreaForge/pull/18 | `areaforge-enterprise-governance` / `areaforge-supply-chain` |
| AF-RISK-OPS-003 | deferred-work | 2026-09-10 | 未来服务器、域名、Nginx 或端口迁移会影响公网 health 和 updater 状态 | 否 | 新迁移 runbook、备份、Nginx/compose hash、health、rollback 记录齐全 | 迁移记录、release/update evidence、DNS/TLS 检查 | `areaforge-sre-ops` |
| AF-RISK-OPS-004 | closed-evidence | 2026-10-21 | v0.1.9 alert preview 与匹配 manual-window drill 已通过 alert:drill:validate 与 ops:ops-004:preflight=ready_for_human_close；2026-07-21 closeout 人工复核见 docs/development/residual-closure-review-20260721-ops-004-closeout.md | 否 | 新版本 alert preview 变化、drill 失配、接收人 ACK 缺失或校验失败时重新打开 | docs/development/ops-004-alert-preview-v0.1.9-20260721.json、docs/development/ops-004-alert-drill-v0.1.9-20260721-manual-window.txt、docs/development/residual-closure-review-20260721-ops-004-closeout.md | `areaforge-observability` |
| AF-RISK-OPS-005 | closed-evidence | 2026-10-21 | v0.1.9 生产短维护窗采集 V2 check SUCCEEDED + EXPECTED_BEFORE_MISMATCH REJECTED（executionAttempted=false）；redacted rejection/decision-history/operational 证据包通过 ops:ops-005:evidence:validate。ops:ops-005:preflight 因 multi-residual dirty worktree 仍 needs_signed_release（非证据形态失败）。2026-07-21 closeout 人工复核见 docs/development/residual-closure-review-20260721-ops-005-closeout.md | 否 | 新 Release、expectedBefore 语义/证据模板变化、evidence:validate 失败、生产版本变化或 decision-history 过期时重新打开 | docs/development/ops-005-expected-before-v0.1.9-20260721/ops-005-expected-before-v2-20260721.txt、expected-before-rejection.json、decision-history.json、operational-evidence.json、docs/development/residual-closure-review-20260721-ops-005-closeout.md、pnpm ops:ops-005:evidence:validate 通过 | `areaforge-security-governance` / `areaforge-release-operator` / `areaforge-sre-ops` |
| AF-RISK-OPS-006 | closed-evidence | 2026-10-21 | Phase B before-doctor→deploy→probe→after-doctor 时间序齐备；controlled concurrency probe cleanupStatus=pass；smoke 账号写入型 task/timer/review+attachment+AI smoke 为 PASS；ops:ops-006:evidence:validate 通过。production:preflight 因 multi-residual dirty worktree 仍 blocked（非 doctor/smoke 证据失败）。2026-07-21 closeout 人工复核见 docs/development/residual-closure-review-20260721-ops-006-closeout.md | 否 | 新 Release、canonical concurrency 语义变化、evidence:validate 失败、生产版本变化或 before/after doctor 过期时重新打开 | docs/development/ops-006-production-evidence-v0.1.9-20260721/、docs/development/release-v0.1.9-record.md（postReleaseSmoke PASS）、output/release-v0.1.9/write-smoke-evidence/write-smoke-summary.json、docs/development/residual-closure-review-20260721-ops-006-closeout.md、pnpm ops:ops-006:evidence:validate 通过 | `areaforge-security-governance` / `areaforge-sre-ops` / `areaforge-validation-driver` |
| AF-RISK-OPS-007 | closed-evidence | 2026-10-21 | 生产 Phase B 观测 attachment staging/write-intent migration 已 apply（无 pending）、attachment reconciliation+doctor-after pass；专用生产协议记录已绑定。本地 ops:ops-007:preflight 在当前 dirty checkout 下因 runtime implementation hash drift 为 invalid，不阻断本次 observational 关账。2026-07-21 closeout 人工复核见 docs/development/residual-closure-review-20260721-ops-007-closeout.md | 否 | 新 Release、附件协议/migration 变化、生产 recon/doctor 失败、或需声称 fresh local_verified 时重新打开并刷新隔离 runtime | docs/development/ops-007-production-protocol-v0.1.9-20260721.txt、output/release-v0.1.9/phaseb-evidence/ops007-attachment-reconciliation-summary.json、ops007-doctor-after.json、docs/development/residual-closure-review-20260721-ops-007-closeout.md | `areaforge-file-storage-safety` / `areaforge-security-governance` |
| AF-RISK-OPS-008 | closed-evidence | 2026-10-21 | 生产 Phase B 观测 hold→MAINTENANCE_HOLD_ACTIVE 屏障→CAS clear→timers restored；ops:ops-008:preflight:strict=local_verified；生产 journal 记录已绑定。2026-07-21 closeout 人工复核见 docs/development/residual-closure-review-20260721-ops-008-closeout.md | 否 | 新 Release、hold/journal 语义变化、preflight:strict 不再 local_verified、或生产 hold/barrier 证据失效时重新打开 | docs/development/ops-008-production-journal-v0.1.9-20260721.txt、output/release-v0.1.9/phaseb-evidence/01-ops008-hold.txt、01b-apply-while-hold.txt、01c-ops008-clear.txt、07-timers-restored.txt、output/ops008/updater-runtime-20260721.json、docs/development/residual-closure-review-20260721-ops-008-closeout.md、pnpm ops:ops-008:preflight:strict=local_verified | `areaforge-sre-ops` / `areaforge-observability` / `areaforge-security-governance` |
| AF-RISK-UX-001 | closed-evidence | 2026-10-21 | current-bound local UX review 通过 experience:review:validate（bindingStatus=current）；desktop/mobile 截图与 runtime probe 已绑定 HEAD。本地证据不证明生产写入体验。2026-07-21 closeout 人工复核见 docs/development/residual-closure-review-20260721-ux-001-closeout.md | 否 | source fingerprint/runtime identity 漂移、体验改动后未重审、校验失败时重新打开；生产体验声明仍需独立生产证据 | docs/development/product-experience-review-20260721-v019-closeout.md、output/playwright/runtime-identity-closeout-20260721T070703Z.json、docs/development/residual-closure-review-20260721-ux-001-closeout.md | `areaforge-product-experience` / `areaforge-qa-smoke` |
| AF-RISK-DATA-001 | deferred-work | 2026-10-21 | 学习树已确认导入的规范化 Markdown 将长期留存并随数据库备份扩散；v1.1 仅提供软归档与一次性 canonical 导出，未提供物理删除、备份副本同步删除或完整账户导出。未登记接受边界前不得开放导入 confirm | 否 | 完成数据生命周期确认包：访问仅 owner、无自动过期、软归档、备份同周期、导出临时资源释放、未来删除/撤销路线、data owner/validation owner/close condition；人工接受后仍保持可重开条件 | docs/development/high-risk-confirmation-packets.md（learning-tree data lifecycle）、导入鉴权/归档/backup-restore/export fixture、redaction matrix、residual close condition | `areaforge-security-governance` / `areaforge-file-storage-safety` |

## 任务绑定与接受例外

- `AF-RISK-OPS-005` -> `tasks/active/0019-update-request-expected-before-binding.md`
- `AF-RISK-OPS-006` -> `tasks/active/0020-business-state-concurrency.md`
- `AF-RISK-OPS-007` -> `tasks/active/0021-attachment-staging-intent.md`
- `AF-RISK-OPS-008` -> `tasks/active/0022-updater-phase-journal-hold.md`
- `AF-RISK-SC-004` -> `tasks/backlog/0023-github-main-protection.md`
- `AF-RISK-UX-001` -> `tasks/active/0024-ux-residual-closure-review.md`
- `AF-RISK-DATA-001` -> `tasks/backlog/0029-v11-batch5-resources-import-confirm.md`
- `AF-RISK-SC-002` -> `tasks/backlog/0035-v11-batch11-minor-release.md`（v1.1 Release 前须按新 commit 重采 CI/供应链证据）
- 其余 item 的 `taskRefs=[]`；当前没有 task promotion waiver。

`AF-RISK-REL-001` 的 `acceptedException` 只记录已有历史事实：AreaSong 在 `2026-07-10T19:40:59+08:00` 接受继续保持 `AREAFORGE_AUTO_APPLY=none`、不启用 patch 自动应用的当前边界，来源为 `git:4a76627add00e6fa07f5194e4252cec12a7b4e28`，到期日为 `2026-08-10`。其 scope、reason、重新打开条件和 `basisHash` 只绑定既有 `none/patch`、签名、备份、extra smoke、rollback target 与 manifest policy 边界；不表示 patch 自动应用已获授权，也不构成新的接受事实。

## 关闭规则

- 关闭残余项必须追加证据，不从“看起来没问题”关闭。
- 每个残余项必须设置 `复核时间` / `reviewAt`。到期后若仍未关闭，应更新影响、关闭条件、所需证据或风险接受理由。
- 若残余项变成当前发布或事故阻塞，应升级为 `current-blocker` 并写入任务或 incident 记录。
- 历史 release 记录中的旧限制不改写；如会误导当前状态，在当前台账中标为 historical reference 或 closed evidence。

## 人工复核关闭清单

`ready_for_human_close`、`ready_for_ops005_human_review`、`ready_for_ops006_human_review` 或 `ready_for_sc001_sc002_review` 只表示证据形态可复核，不自动关闭台账。维护者关闭、保留、降级或重新打开 `AF-RISK-OPS-001`、`AF-RISK-SC-001`、`AF-RISK-OPS-004`、`AF-RISK-OPS-005` 或 `AF-RISK-OPS-006` 前，先使用 `docs/development/residual-closure-review-template.md` 保存人工复核记录并运行：

```bash
pnpm residuals:closure:validate <residual-closure-review-record.md|txt>
```

该记录必须保持 `closesResidual: no`；它只证明人工复核结论和证据边界完整，不修改 Markdown/JSON 台账。若结论是 `reviewDecision: close`，后续仍需单独更新台账并运行 `pnpm residuals:validate`。

人工复核记录至少包含：

- reviewer 和复核日期。
- residual ID、当前类型和复核结论：close / keep-open / downgrade / reopen。
- 证据路径：生产只读 smoke、redacted update-agent status、operational evidence bundle、alert drill、release supply-chain/release record；OPS-006 还必须包含 matching Release、联合 rollout record、fresh before/after doctor、migration hash/result、health/authenticated smoke、409/单次副作用和 rollback target。
- validator 输出：对应 `pnpm ...:validate`、`pnpm ops:ops-001:preflight`、`pnpm ops:ops-004:preflight`、`pnpm ops:ops-005:preflight`、`pnpm ops:ops-005:evidence:validate`、`pnpm ops:ops-006:preflight:strict`、`pnpm ops:ops-006:runtime:validate`、`pnpm ops:ops-006:evidence:validate`、`pnpm ops:ops-006:production:preflight`、`pnpm ops:data-integrity:validate`、`pnpm sc:sc-002:preflight` 或 `pnpm ops:long-term:gate` 的通过结论。
- 重新打开条件：新 release/update、证据超过窗口、workflow/updater/签名策略变化、smoke/alert 失败或生产版本变化。
- 明确未执行事项：未执行 updater apply、backup/restore、migration、rollback、写入型 smoke 或 secrets 读取时，必须写明不能由本次复核证明。

历史记录降级规则：

- 旧 release record 只能证明当时版本的发布事实；不能证明当前 latest Release、当前生产版本或当前供应链状态。
- 旧 smoke、截图或体验记录超过新鲜窗口后只能作为 historical reference；不能支撑当前健康声明。
- 旧 blocked record 在后续 closure packet 通过后仍保留为历史尝试记录，不再作为当前 blocker 结论。
- 生产更新后，更新前的 OPS-001、OPS-004、readiness summary 和 evidence bundle 需要重新采集或明确降级为历史证据。
