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

## 当前残余项

| ID | 类型 | 复核时间 | 当前影响 | 可立即执行 | 关闭条件 | 所需证据 | Owner |
|---|---|---|---|---|---|---|---|
| AF-RISK-OPS-001 | current-blocker | 2026-07-17 | 2026-07-11/12 生产只读 fallback 已补齐 smoke 账号和权限收紧的 smoke password file，并形成可人工复核证据；`v0.1.7` 生产 updater apply 时 extra smoke 通过；post-`v0.1.7` 只读 evidence bundle 已保存但状态为 `needs_attention`，因为 redacted update-agent status 和 production readonly smoke record 尚未重新采集入仓库；台账尚未按维护者人工复核关闭 | 否 | 服务器配置 `AREAFORGE_EXTRA_SMOKE_COMMAND`、smoke 账号和权限收紧的 smoke 密码文件；最近一次生产版本对应的只读 smoke 通过、redacted update-agent status、operational evidence bundle 和 OPS-001 收口包齐全；生产更新后必须重采或明确降级旧证据为历史 | `docs/development/ops-001-production-readonly-attempt-20260711.md`、`docs/development/ops-001-production-readonly-20260711/prod-readonly-smoke-record.txt`、`docs/development/ops-001-production-readonly-20260711/redacted-update-status.json`、`docs/development/ops-001-production-readonly-20260711/operational-evidence-bundle.json`、`docs/development/ops-001-production-readonly-20260711/ops-001-closure-packet.txt`、`docs/development/release-v0.1.7-record.md`、`docs/development/operational-evidence-bundle-v0.1.7-20260712.json`、后续 post-`v0.1.7` redacted smoke/status/OPS-001 closure packet、`pnpm smoke:prod-readonly:validate` 通过、`pnpm update-agent:status:validate` 通过、`pnpm ops:evidence:bundle:validate` 通过、`pnpm ops:ops-001:closure:validate` 通过、`pnpm ops:ops-001:preflight` 返回 `ready_for_human_close` | `areaforge-sre-ops` / `areaforge-qa-smoke` |
| AF-RISK-OPS-002 | deferred-work | 2026-08-10 | 写入型生产 smoke 策略已有非执行草案；仍缺专用账号、用户确认、清理策略和受控记录 | 否 | 明确 smoke 账号、允许写入范围、清理策略、失败处理方式并获确认后，完成至少一次受控记录 | 确认记录、测试账号、写入对象 ID、清理或保留说明、smoke 结果 | `areaforge-qa-smoke` / `areaforge-security-governance` |
| AF-RISK-REL-001 | accepted-exception | 2026-08-10 | `AREAFORGE_AUTO_APPLY=none` 是当前安全默认；patch 自动应用尚未启用 | 否 | 用户明确确认 patch 自动应用，且签名、备份、extra smoke、rollback target 和 manifest policy 同时满足 | 确认记录、updater env 摘要、release manifest、smoke 和 rollback evidence | `areaforge-release-operator` / `areaforge-sre-ops` |
| AF-RISK-SC-001 | deferred-work | 2026-08-10 | `v0.1.7` 签名 GitHub Release 已生成 SBOM/provenance、`SHA256SUMS`、`SHA256SUMS.sig` 和 GHCR digest 证据，且已由服务器侧 updater 应用到生产；`pnpm release:supply-chain:validate` 已通过，并且带 `AREAFORGE_SC002_RELEASE_RECORD=docs/development/release-supply-chain-v0.1.7.md` 运行 `pnpm sc:sc-002:preflight` 可返回 `ready_for_sc001_sc002_review`；台账尚未按维护者人工复核关闭 | 否 | 维护者人工复核 `v0.1.7` 签名 Release 供应链记录和发布记录后，明确关闭或继续保留该 residual；生产 apply 不自动关闭该 residual，后续修改 Release workflow、签名策略、依赖审计或创建新 Release 前重新复核 | `docs/development/release-supply-chain-v0.1.7.md`、`docs/development/release-v0.1.7-record.md`、GitHub Release run `29179904808` 成功、SBOM asset、provenance asset、`SHA256SUMS` 覆盖记录、cosign `Verified OK`、服务器 updater apply 记录、`pnpm release:supply-chain:validate` 通过、带当前 release record 路径的 `pnpm sc:sc-002:preflight` 返回 `ready_for_sc001_sc002_review`；`pnpm ops:long-term:gate` 仅用于整体长期运营完成声明，不作为 SC-001 关闭条件 | `areaforge-supply-chain` |
| AF-RISK-SC-002 | current-blocker | 2026-07-18 | 旧 CI-only 记录只覆盖 checkpoint `b9bbfa2072a79318fc93f6e9497fe4f4b3da29b7`；当前 checkout 已修改 CI/Release workflow、OPS-005 门禁和 Release admission，尚无匹配 commit 的远端成功 CI 或签名 Release 供应链记录，不能复用旧证据 | 否 | 当前 checkout 推送后取得匹配 commit 的成功 GitHub CI run，重新生成并校验 CI-only record；若进入 Release，再补匹配签名 Release 供应链记录。任何 commit mismatch、未 pin action 或 high/critical 漏洞继续 fail closed | 当前 commit 的 GitHub Actions run URL/conclusion、`expectedGitCommit` 与 `gitCommit` 一致的 CI supply-chain record、`pnpm ci:supply-chain:validate`、`pnpm sc:sc-002:preflight` 返回 `ready_for_sc002_review`；签名 Release 另需 `pnpm release:supply-chain:validate` | `areaforge-supply-chain` / `areaforge-enterprise-governance` |
| AF-RISK-SC-003 | closed-evidence | 2026-10-10 | 本地 UX smoke 曾复现 `pg` transaction client query queue deprecation；`packages/db` 已对 Prisma pg adapter transaction query 进行串行化，增强后的 trace 覆盖 representative include 路径且无 warning | 否 | 后续升级 `pg` / `@prisma/adapter-pg` 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke；若 warning 复现则重新打开 | `pnpm why pg --recursive` 只有 `pg@8.22.0`；临时 PostgreSQL 16 库 `pnpm db:migrate:deploy` 通过；`NODE_OPTIONS=--trace-deprecation pnpm pg:trace-deprecation` matchedWarningCount=0；`NODE_OPTIONS=--trace-deprecation pnpm smoke:local-ux` 通过且 server log 无 deprecation warning | `areaforge-supply-chain` / `areaforge-sre-ops` |
| AF-RISK-SC-004 | current-blocker | 2026-07-18 | GitHub `main` 当前没有 branch protection/ruleset；仓库内 CI 和 Release admission 已增强，但失败检查的 PR 仍可能被有权限者合并，本地 preflight 不能证明远端合并门禁存在 | 否 | 经单独远端治理确认后，为 `main` 配置 required PR、`ci / verify` required status check、禁止 force push/delete，并读取回 GitHub ruleset/branch protection；用一个受控 PR 证明失败检查不能合并、通过检查可以合并 | `tasks/backlog/0023-github-main-protection.md`、GitHub branch protection/ruleset readback、required check 名称、受控 PR 合并门禁证据、`pnpm governance:preflight`、匹配 commit 的 CI supply-chain record | `areaforge-enterprise-governance` / `areaforge-supply-chain` |
| AF-RISK-OPS-003 | deferred-work | 2026-09-10 | 未来服务器、域名、Nginx 或端口迁移会影响公网 health 和 updater 状态 | 否 | 新迁移 runbook、备份、Nginx/compose hash、health、rollback 记录齐全 | 迁移记录、release/update evidence、DNS/TLS 检查 | `areaforge-sre-ops` |
| AF-RISK-OPS-004 | monitoring-gap | 2026-08-10 | 告警阈值已有非执行策略；2026-07-11 manual-window alert preview 和告警/恢复演练记录保留为历史输入；post-`v0.1.7` alert preview 已保存为 `docs/development/ops-004-alert-preview-v0.1.7-20260712.json`，matching drill 已保存为 `docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt`，带当前 preview/drill 环境变量运行 `pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`；metrics dashboard 和外部告警接收人仍未产品化，台账关闭仍待维护者人工复核 | 否 | 配置外部告警接收人或人工值班窗口，完成一次与当前版本 alert preview 匹配的告警/恢复演练记录，并通过 OPS-004 证据预检；历史 manual-window 证据只能作为参考输入；`ready_for_human_close` 不自动关闭台账 | `docs/development/ops-004-alert-preview-20260711.json`、`docs/development/ops-004-alert-drill-20260711-manual-window.txt`、`docs/development/ops-004-alert-preview-v0.1.7-20260712.json`、`docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt`、`pnpm alert:drill:validate` 通过、带当前 preview/drill 路径的 `pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`、值班窗口或外部接收人说明、恢复记录 | `areaforge-observability` |
| AF-RISK-OPS-005 | current-blocker | 2026-07-20 | 当前 checkout 已实现 schema V2、用户确认 snapshot binding、目标 Release/manifest/digest、rollback source record/target、TTL、idempotency/hash、no-clobber atomic publish、directory fsync uncertain 契约、processing reconciliation、不可变 decision history、legacy mutation fail-closed 和共享 production-state lock；本地 fixture 已覆盖恶意 request/claim ID、execution boundary 后崩溃重启和真实 rollback/policy 锁竞争。Release workflow 已增加签名后 strict assets/manifest/cosign 校验，生产证据 validator 已绑定实际 redacted rejection/history/operational JSON；但该实现尚未进入匹配签名 Release 或生产部署，线上 `v0.1.7` 不能据此宣称具备 V2 stale-request 防护 | 否 | 保留已通过的本地 V2 证据；创建匹配提交的签名 Release并取得完整 assets；随后通过独立生产部署确认暂停 timer、隔离旧队列、部署匹配 Web/agent、V2 check 验证并恢复 timer；取得 24 小时内 fresh redacted decision history 后人工复核 | `docs/development/update-request-expected-before-design.md`、`docs/development/ops-005-expected-before-production-evidence-template.md`、`tasks/active/0019-update-request-expected-before-binding.md`、`pnpm ops:ops-005:local:selftest` 覆盖 no-clobber / directory-sync-uncertain / 恶意 ID / 崩溃重启 / 真实锁竞争，`pnpm shellcheck:updater` / `pnpm github-release-updater:preflight` 通过、后续匹配签名 Release record + assets 通过 strict assets/checksum/cosign 校验、生产部署记录、V2 check、实际 redacted rejection/history/operational 文件 path+hash 绑定、至少一条 `executionAttempted=no` 的 `EXPECTED_BEFORE_MISMATCH`、shared-lock/processing reconciliation 证据、`AREAFORGE_AUTO_APPLY=none` 证明、`pnpm ops:ops-005:evidence:validate <record> <release-record> <release-assets-dir>` 通过、`pnpm ops:ops-005:preflight` 返回 `ready_for_ops005_human_review` | `areaforge-security-governance` / `areaforge-release-operator` / `areaforge-sre-ops` |
| AF-RISK-OPS-006 | current-blocker | 2026-07-22 | 当前单管理员模型没有数据库级“最多一个活跃 StudySession”约束；start 检查与 create 分离，end 和部分 task mutation 未统一使用 expected-status CAS，并发请求可能产生重复活跃计时、重复分钟累加或状态 last-write-wins。只读 data-integrity doctor 已提供发现入口，但不修复根因 | 否 | 独立确认后完成 additive active-session uniqueness migration、task/session CAS、事务内单次副作用和 409 映射；临时 PostgreSQL 并发测试、doctor before/after 和全量检查通过；签名 Release 与生产 migration/deploy 分开确认 | `docs/development/data-integrity-doctor.md`、`tasks/active/0020-business-state-concurrency.md`、`pnpm ops:data-integrity:selftest`、临时 PostgreSQL 并发记录、migration 校验、`pnpm db:validate`、`pnpm check`、匹配签名 Release、独立生产部署记录和 fresh redacted doctor JSON | `areaforge-security-governance` / `areaforge-sre-ops` / `areaforge-validation-driver` |
| AF-RISK-OPS-007 | deferred-work | 2026-08-15 | 附件服务先写最终文件再提交 Attachment metadata，崩溃窗口仍可能留下 file-only orphan；现有补偿和只读 reconciliation 只能事后发现 | 否 | 独立确认后完成 staging file/fsync、PENDING -> READY 写入意图或等价原子协议、崩溃注入测试、旧附件兼容和备份/恢复说明；不自动清理历史孤儿 | `tasks/backlog/0021-attachment-staging-intent.md`、附件 crash-window fixture、migration/无 migration 方案、attachment reconciliation summary、backup/restore 与 rollback 边界、`pnpm risk:preflight`、`pnpm check` | `areaforge-file-storage-safety` / `areaforge-security-governance` |
| AF-RISK-OPS-008 | deferred-work | 2026-08-15 | updater 在 backup、migration、switch、smoke 中途被强杀时缺少 append-only 阶段日志；维护窗口没有 root-only hold/drain 状态，暂停 timer 和停止领取新请求仍依赖人工步骤 | 否 | 独立确认后完成 root-only atomic phase journal、启动时只读 reconciliation、hold/drain 状态投影和崩溃/竞争 selftest；Web runtime 不获得控制权，生产 timer/队列变更另行确认 | `tasks/backlog/0022-updater-phase-journal-hold.md`、阶段状态机设计、kill-point fixture、hold/drain claim selftest、shellcheck、updater preflight、匹配签名 Release 和独立生产部署证据 | `areaforge-sre-ops` / `areaforge-observability` / `areaforge-security-governance` |
| AF-RISK-UX-001 | monitoring-gap | 2026-07-24 | local UX smoke guardrail selftest 已通过；共享 UX evaluator 当前将最新记录判为 `invalid`，原因是记录的 git commit、product experience source hash 和 runtime identity 已不匹配当前 checkout。`ops:status` 与 `ops:handoff` 现在直接投影该四态结果，不再复述旧台账中的通过声明。生产体验仍未被本地证据证明，窄屏任务选择器仍有 polish follow-up | 是 | 重新启动当前 checkout runtime，采集 fresh desktop/mobile 旅程和 runtime probe，生成 current-bound review 并通过 validator；随后由维护者 reaffirm `keep-open` 或另行授权 residual 台账更新。任何生产体验声明仍需独立生产证据 | current-bound product experience review、runtime probe JSON、desktop/mobile screenshot evidence、`pnpm smoke:local-ux:selftest`、`pnpm experience:review:validate`、`pnpm ops:status:validate`、`pnpm ops:handoff:validate`、现有 keep-open review；本地证据不证明生产写入体验 | `areaforge-product-experience` / `areaforge-qa-smoke` |

## 任务绑定与接受例外

- `AF-RISK-OPS-005` -> `tasks/active/0019-update-request-expected-before-binding.md`
- `AF-RISK-OPS-006` -> `tasks/active/0020-business-state-concurrency.md`
- `AF-RISK-OPS-007` -> `tasks/backlog/0021-attachment-staging-intent.md`
- `AF-RISK-OPS-008` -> `tasks/backlog/0022-updater-phase-journal-hold.md`
- `AF-RISK-SC-004` -> `tasks/backlog/0023-github-main-protection.md`
- `AF-RISK-UX-001` -> `tasks/active/0024-ux-residual-closure-review.md`
- 其余 item 的 `taskRefs=[]`；当前没有 task promotion waiver。

`AF-RISK-REL-001` 的 `acceptedException` 只记录已有历史事实：AreaSong 在 `2026-07-10T19:40:59+08:00` 接受继续保持 `AREAFORGE_AUTO_APPLY=none`、不启用 patch 自动应用的当前边界，来源为 `git:4a76627add00e6fa07f5194e4252cec12a7b4e28`，到期日为 `2026-08-10`。其 scope、reason、重新打开条件和 `basisHash` 只绑定既有 `none/patch`、签名、备份、extra smoke、rollback target 与 manifest policy 边界；不表示 patch 自动应用已获授权，也不构成新的接受事实。

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
