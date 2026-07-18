# 验证矩阵

## 原则

验证从改动范围出发，选择最小充分集合。不要因为任务小就不验证，也不要每次都默认跑最大集合。

不能运行的验证必须说明原因。没有验证，不宣称完成。

涉及 `pnpm ops:status` 或 `pnpm ops:handoff` 输出格式时，默认 JSON、对应 `*:validate <json>` 和 `--summary` 人读摘要都要运行；JSON 是机器接口，摘要只用于维护窗口快速阅读，不能替代 validator、live evidence 或长期运营 gate。`sourceSnapshot.protectedPathFingerprint` 和 `releaseEvidenceGaps` 是 `ops:status` JSON 契约的一部分，`ops:handoff` 和 `ops:long-term:snapshot` 也必须保留同一 fingerprint 绑定。变更 protected path 集合、fingerprint 算法、release evidence gap 摘要或对应 validator 时，至少运行 `pnpm ops:status`、`pnpm ops:status:validate <operability-status.json>`、`pnpm ops:status:selftest`、`pnpm ops:status:validate:selftest`、`pnpm ops:handoff`、`pnpm ops:handoff:validate <operational-handoff.json>`、`pnpm ops:handoff:selftest`、`pnpm ops:handoff:validate:selftest`、`pnpm ops:long-term:snapshot:selftest`、`pnpm ops:readonly-side-effect:selftest`、`pnpm docs:readiness` 和 `git diff --check`。

`ops:handoff:validate` 默认必须返回 `bindingStatus: current`；格式合法但 source hash 或 protected fingerprint 已漂移的记录必须失败。`--shape-only` 仅用于历史归档并返回 `bindingStatus: unavailable`，不能支持当前维护、release 或生产健康声明。

涉及 `pnpm ops:backup-restore:preview` 输出格式时，validator 必须校验 `blockingGaps` 与 `evidenceInventory` 完全派生一致，并保留 metadata-only、no-secret、no-server-command 边界；`releaseEvidenceBundleHash` 必须和三类 backup hash 一起进入机器可读缺口清单。schema v2 必须绑定 package、生成/校验实现、Release record、可选 restore drill record 和组合 `sourceSetHash`；生成期间输入变化必须失败，默认 validator 必须重新生成完整 current preview，并在记录修改/删除/symlink 替换、package/实现漂移或派生内容篡改时失败并输出 `bindingStatus: current`。历史 schema v1/v2 只允许显式 `--shape-only`，输出 `bindingStatus: unavailable`；至少运行 `pnpm ops:backup-restore:preview:selftest`、真实 preview 生成、默认 validator、`pnpm quality:operability:typecheck` 和 `git diff --check`。

涉及目录责任、路径分级、`governance:changed-paths` 或 `governance:protected-path-review:*` 时，至少运行 `pnpm governance:changed-paths --summary`、`pnpm governance:changed-paths:selftest`、`pnpm governance:protected-path-review:selftest`、`pnpm ops:readonly-side-effect:selftest`、`pnpm governance:preflight`、`pnpm docs:readiness`、`pnpm docs:completion` 和 `git diff --check`。路径报告只能从已见路径推导 routine/protected-path/high-risk 审阅级别，不能提供高风险确认或生产证据；审阅记录校验只约束字段、fingerprint 形态、decision consistency 与 no-write safety facts，不读取 git diff，也不证明工作区干净或所有路径已被审阅。

涉及 residual schema V2、task promotion 或 accepted exception 时，至少运行 `pnpm residuals:validate:selftest`、`pnpm residuals:validate`、`pnpm tasks:doctor:selftest`、`pnpm tasks:doctor`、`pnpm residuals:review-due:selftest`、`pnpm residuals:promotion-preview:selftest`、`pnpm residuals:promotion-preview`、`pnpm docs:readiness` 和 `git diff --check`。权威 reader/validator 必须校验每个 item 的 exact keys、`taskRefs` 与 task YAML `residualRiskIds` 双向绑定、`executableNow=true` 的 active task/有效 waiver 支撑，以及 accepted exception 的状态、来源、到期日、重新打开条件和 canonical `basisHash`；所有 status/support/release/governance 消费者必须 fail closed，不得把 V1、无效或部分台账投影为成功。promotion preview 只能形成只读人工复核输入，不得生成目标路径、创建/移动任务、修改台账或自动关闭 residual。

## 路径到验证

| 改动范围 | 最小验证 |
|---|---|
| `docs/**`、`README.md`、`AGENTS.md` | `rg` 检查旧引用和入口路径，`pnpm docs:readiness`，`git diff --check`；若涉及完成声明、运行时写边界、release/ops/UX 残余项，补跑对应专项预检或记录校验；若新增完成声明记录，运行 `pnpm completion:evidence:validate <record>` |
| `assets/brand/**`、`scripts/brand/**`、`scripts/quality/brand-assets-validate.ts`、`docs/ux/brand-assets.md` | 运行 `pnpm brand:validate`；SVG 运行 `xmllint --noout`；PDF 用 `pdfinfo` 并渲染抽查；检查没有 `.DS_Store` 等元数据文件；运行 `pnpm docs:readiness` 和 `git diff --check`；若接入 Web favicon、PWA manifest 或 UI，再按 `apps/web/**` 运行 typecheck、lint、build 和桌面/移动截图验证 |
| `docs/deployment/operator-onboarding.md`、`scripts/quality/operator-onboarding-preflight.ts`、自托管上手入口 | `pnpm operator:onboarding:preflight`，`pnpm docs:readiness`，`pnpm ops:readiness`，`pnpm skills:validate`，`git diff --check` |
| `tasks/**`、`workflow/**` | 检查对应 `docs/**` 源事实是否存在，`pnpm tasks:doctor`，`pnpm docs:readiness`，`git diff --check`；若 task 绑定 residual，补跑 `pnpm residuals:validate`，确认 `taskRefs` 与 `residualRiskIds` 双向一致 |
| `.codex/skills-src/**`、`.agents/skills/**` | `pnpm skills:validate`，`git diff --check`；若 skill 改变企业治理、发布、运维、观测、事故、安全、上传/附件存储、供应链、残余风险、AI 或文档同步口径，补跑 `pnpm docs:readiness` 和 `pnpm risk:preflight` |
| `package.json`、`pnpm-workspace.yaml` | `pnpm install --frozen-lockfile` 或说明无法运行原因，`pnpm check`；涉及 `pg` / Prisma adapter 时补跑 `pnpm pg:trace-deprecation` |
| `SECURITY.md`、`.github/dependabot.yml`、`.github/pull_request_template.md`、`.gitleaksignore`、`docs/development/dependency-policy.md`、`docs/development/external-capability-admission.md`、`scripts/quality/secret-scan.ts`、`scripts/quality/governance-preflight.ts` | `pnpm secrets:scan`，`pnpm governance:preflight`，`pnpm docs:readiness`，`git diff --check`；Gitleaks 误报只允许按已核验 fingerprint 放行，不允许按整个文件、目录或规则放行 |
| `SUPPORT.md`、`.github/ISSUE_TEMPLATE/**`、`.github/pull_request_template.md`、`docs/development/support-intake.md`、`docs/development/support-bundle-preview.md`、`.codex/skills-src/areaforge-public-maintenance/**`、`scripts/quality/support-intake-preflight.ts`、`scripts/ops/support-bundle-preview.ts`、`scripts/quality/support-bundle-preview-validate.ts`、`scripts/quality/support-bundle-preview.selftest.ts`、`scripts/ops/backup-restore-preview.ts`、`scripts/quality/backup-restore-preview-validate.ts`、`scripts/quality/backup-restore-preview.selftest.ts` | `pnpm support:intake:preflight`，`pnpm ops:support:bundle-preview:selftest`，`pnpm ops:backup-restore:preview:selftest`，`pnpm governance:preflight`，`pnpm docs:readiness`，`pnpm skills:validate`，`git diff --check` |
| `scripts/quality/backup-restore-preview-source.ts`、backup/restore preview current source binding | `pnpm ops:backup-restore:preview:selftest`、真实 preview 生成和默认 validator、`pnpm quality:operability:typecheck`、`pnpm ops:readonly-side-effect:selftest`、`pnpm docs:readiness`、`git diff --check`；负向矩阵必须覆盖 record 修改/删除/symlink、package/实现漂移、派生内容重写和生成中途输入变化，历史 `--shape-only` 只能返回 `bindingStatus: unavailable` |
| `docs/development/error-recovery-matrix.md`、`docs/development/error-recovery-matrix.json`、`scripts/quality/error-recovery-matrix-validate.ts`、`scripts/quality/error-recovery-matrix-validate.selftest.ts` | `pnpm error-recovery:validate`、`pnpm error-recovery:selftest`、`pnpm enterprise:operability:preflight`、`pnpm docs:readiness`、`pnpm residuals:validate`、`pnpm check`、`git diff --check`；矩阵通过只证明错误提示、恢复动作、诊断入口、副作用边界和 residual 重新开启条件存在，不证明生产动作或 residual 关闭 |
| `docs/development/operations-lifecycle.md`、`docs/development/operations-lifecycle.json`、`scripts/quality/operations-lifecycle-validate.ts`、`scripts/quality/operations-lifecycle-validate.selftest.ts` | `pnpm ops:lifecycle:selftest`、`pnpm ops:lifecycle:validate`、`pnpm ops:lifecycle:typecheck`、`pnpm ops:readiness`、`pnpm maintenance:cadence:preflight`、`pnpm enterprise:operability:preflight`、`pnpm docs:readiness`、`git diff --check`；通过只证明 SLO 来源、incident transition、capability lifecycle、residual 绑定和只读安全事实一致，不证明生产 SLO、事故处置或真实退役完成 |
| `docs/development/post-release-observation-template.json`、`docs/development/post-release-observation-v*.json`、`scripts/quality/post-release-observation-validate.ts`、`scripts/ops/post-release-observation-status.ts`、Release 后 D14/D30 观察记录 | `pnpm release:post-observation:validate:selftest`、`pnpm release:post-observation:status:selftest`、`pnpm release:post-observation:validate <record>`、`pnpm release:post-observation:status <record>`、`pnpm ops:lifecycle:validate`、`pnpm maintenance:cadence:preflight`、`pnpm enterprise:operability:preflight`、`pnpm docs:readiness`、`git diff --check`。validator 严格校验 `mode=post_release_observation`、release identity、release record `{path,sha256}`、UTC 日历 D14/D30、观察项 status/summary/evidence、派生 checkpoint/overall gate 和五项 safetyFacts；status 只投影 `pending_observation`、`needs_attention`、`blocked`、`ready_for_human_review`，不证明生产健康、观测已执行或 residual 关闭 |
| `docs/development/governance-register.md`、`docs/development/governance-register.json`、`scripts/quality/governance-register-validate.ts`、`scripts/quality/governance-register-validate.selftest.ts` | `pnpm governance:register:selftest`、`pnpm governance:register:validate`、`pnpm governance:preflight`、`pnpm ops:status:selftest`、`pnpm docs:readiness`、`git diff --check`；通过只证明权威路径、accountable owner、已有 package script 门禁和复审触发器一致，不证明引用命令已执行、lifecycle 状态、生产激活或 residual 关闭 |
| `docs/development/operational-readiness.md`、`docs/development/support-bundle-preview.md`、`docs/development/production-smoke-alerting-strategy.md`、`docs/development/production-readonly-smoke-record-template.md`、`docs/development/ops-001-closure-packet-template.md`、`docs/development/ops-001-production-readonly-attempt-*.md`、`docs/development/alert-drill-record-template.md`、`docs/development/residual-risk-ledger.md`、`docs/development/residual-risk-ledger.json`、`docs/development/residual-closure-review-template.md`、`scripts/quality/ops-readiness-preflight.ts`、`scripts/quality/residual-ledger-validate.ts`、`scripts/quality/residual-evidence-preflight.ts`、`scripts/quality/residual-evidence-preflight.selftest.ts`、`scripts/quality/residual-closure-review-validate.ts`、`scripts/quality/residual-closure-review-validate.selftest.ts`、`scripts/ops/operability-status.ts`、`scripts/quality/operability-status-validate.ts`、`scripts/quality/operability-status-validate.selftest.ts`、`scripts/quality/operability-status.selftest.ts`、`scripts/ops/operational-handoff.ts`、`scripts/quality/operational-handoff-validate.ts`、`scripts/quality/operational-handoff-validate.selftest.ts`、`scripts/quality/operational-handoff.selftest.ts`、`scripts/quality/ops-readonly-side-effect.selftest.ts`、`scripts/ops/long-term-evidence-snapshot.ts`、`scripts/quality/long-term-evidence-snapshot-validate.ts`、`scripts/quality/long-term-evidence-snapshot.selftest.ts`、`scripts/ops/support-bundle-preview.ts`、`scripts/quality/support-bundle-preview-validate.ts`、`scripts/quality/support-bundle-preview.selftest.ts`、`scripts/ops/backup-restore-preview.ts`、`scripts/quality/backup-restore-preview-validate.ts`、`scripts/quality/backup-restore-preview.selftest.ts`、`scripts/ops/ops001-evidence-preflight.ts`、`scripts/quality/ops001-evidence-preflight.selftest.ts`、`scripts/quality/ops001-blocked-record-validate.ts`、`scripts/quality/ops001-blocked-record.selftest.ts`、`scripts/ops/generate-ops001-fallback-closure.ts`、`scripts/quality/ops001-fallback-closure.selftest.ts`、`scripts/ops/ops004-alert-evidence-preflight.ts`、`scripts/quality/ops004-alert-evidence-preflight.selftest.ts`、`scripts/ops/residual-review-due.ts`、`scripts/quality/prod-readonly-smoke-validate.ts`、`scripts/quality/prod-readonly-smoke-validate.selftest.ts`、`scripts/quality/prod-readonly-smoke-config-preflight.ts`、`scripts/quality/prod-readonly-smoke-config-preflight.selftest.ts`、`scripts/ops/generate-prod-readonly-smoke-record.ts`、`scripts/quality/prod-readonly-smoke-record.selftest.ts`、`scripts/ops/generate-ops001-closure-packet.ts`、`scripts/quality/ops001-closure-packet-validate.ts`、`scripts/quality/ops001-closure-packet.selftest.ts`、`scripts/quality/alert-drill-validate.ts`、`scripts/quality/alert-drill-validate.selftest.ts`、`scripts/ops/generate-alert-drill-record.ts`、`scripts/quality/alert-drill-record.selftest.ts`、`scripts/ops/operational-readiness-summary.ts`、`scripts/quality/operational-readiness-summary.selftest.ts`、`scripts/ops/operational-evidence-bundle.ts`、`scripts/quality/operational-evidence-bundle-validate.ts`、`scripts/quality/operational-evidence-bundle-validate.selftest.ts`、`scripts/ops/operational-alert-preview.ts` | `pnpm ops:readiness`，`pnpm ops:status`，`pnpm ops:status:validate <operability-status.json>`，`pnpm ops:status:validate:selftest`，`pnpm ops:status:selftest`，`pnpm ops:handoff`，`pnpm ops:handoff:validate <operational-handoff.json>`，`pnpm ops:handoff:validate:selftest`，`pnpm ops:handoff:selftest`，`pnpm ops:readonly-side-effect:selftest`，`pnpm ops:long-term:snapshot:selftest`，`pnpm ops:support:bundle-preview:selftest`，`pnpm ops:backup-restore:preview:selftest`，`pnpm ops:ops-001:preflight`，`pnpm ops:ops-001:preflight:selftest`，`pnpm ops:ops-001:blocked:selftest`，`pnpm ops:ops-001:fallback:selftest`，`pnpm ops:ops-001:fallback:finalize:selftest`，`pnpm ops:ops-004:preflight`，`pnpm ops:ops-004:preflight:selftest`，`pnpm residuals:validate`，`pnpm residuals:evidence:preflight:selftest`，`pnpm residuals:evidence:preflight`，`pnpm residuals:closure:selftest`，`pnpm residuals:review-due`，`pnpm ops:readiness:summary`，`pnpm ops:readiness:summary:selftest`，`pnpm ops:evidence:bundle`，`pnpm ops:evidence:bundle:selftest`，`pnpm ops:ops-001:closure:selftest`，`pnpm ops:alert:preview`，`pnpm smoke:prod-readonly:selftest`，`pnpm smoke:prod-readonly:config:selftest`，`pnpm smoke:prod-readonly:record:selftest`，`pnpm alert:drill:selftest`，`pnpm alert:drill:record:selftest`，`pnpm docs:readiness`，`git diff --check`；若形成 OPS-001 blocked record，运行 `pnpm ops:ops-001:blocked:validate <ops001-blocked-record.txt>` 和 `AREAFORGE_OPS001_BLOCKED_RECORD=<record> pnpm ops:ops-001:preflight`；若形成 fallback redacted 输出目录，运行 `AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=<manifest> pnpm ops:ops-001:fallback:finalize <dir> <out>`；若形成真实证据包，运行 `pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>`、`pnpm ops:ops-001:preflight` 和 `pnpm ops:ops-001:closure:validate <ops-001-closure-packet.txt>`；若形成长期证据快照，运行 `pnpm ops:long-term:snapshot:validate <long-term-evidence-snapshot.json>`，并保留 `needs_live_evidence` 不能证明生产健康；若形成告警演练证据，运行 `pnpm alert:drill:validate <alert-drill-record.txt>` 和 `pnpm ops:ops-004:preflight`；若形成 residual 人工复核记录，运行 `pnpm residuals:closure:validate <residual-closure-review-record>`，且该记录保持 `closesResidual=no`，不等于台账已关闭；若形成支持包预览，运行 `pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>`；若形成备份/恢复证据预览，运行 `pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>` |
| `docs/development/product-experience-review-record-template.md`、`scripts/quality/product-experience-review-discovery.ts`、`scripts/quality/product-experience-review-validate.ts`、`scripts/quality/product-experience-review-validate.selftest.ts`、`scripts/ops/operability-status.ts`、`scripts/ops/operational-handoff.ts`、`scripts/ops/long-term-operability-live-gate.ts`、本地 UX smoke 与 `docs/ux/**` | `pnpm experience:review:selftest`、`pnpm smoke:local-ux:selftest`、`pnpm ops:long-term:gate:selftest`、`pnpm ops:status:selftest`、`pnpm ops:status:validate:selftest`、`pnpm ops:handoff:selftest`、`pnpm ops:handoff:validate:selftest`、`pnpm docs:readiness`、`pnpm residuals:validate`、`pnpm skills:validate`、`git diff --check`；共享 evaluator 必须按 invalid 优先于 stale 的顺序投影 `fresh/stale/invalid/missing`，status/handoff V2 只能继承这一份结果，不能从 residual `currentImpact` 推断。真实记录仍需 `ux-source-v2`、14 天新鲜度/300 秒未来偏差、current runtime identity 和 desktop/mobile 证据；若改 UI，补跑真实浏览器/Playwright smoke。 |
| `docs/development/completion-evidence-checklist.md`、`scripts/quality/completion-evidence-validate.ts`、`scripts/quality/completion-evidence-validate.selftest.ts`、`scripts/quality/worktree-validation-fingerprint.ts`、`scripts/quality/worktree-validation-fingerprint.selftest.ts`、`docs/development/runtime-write-boundary.md` | `pnpm completion:evidence:fingerprint:selftest`、`pnpm completion:evidence:selftest`；schema V2 记录先运行 `pnpm completion:evidence:validate <record> --print-current-fingerprint`，写回 HEAD/worktree/changed paths/commands/profile fingerprint 后运行默认 validator；历史 V1 只能 `--shape-only`；再运行 `pnpm docs:readiness`、`pnpm risk:preflight`、`pnpm ops:readiness`、`pnpm skills:validate`、`git diff --check`；若改变 release/update 口径，补跑 `pnpm release:train:preflight` |
| `docs/development/long-term-operability-control-plane.md`、`docs/development/support-bundle-preview.md`、`docs/deployment/backup-restore.md`、`scripts/quality/enterprise-operability-preflight.ts`、`scripts/ops/operability-status.ts`、`scripts/quality/operability-status-validate.ts`、`scripts/quality/operability-status-validate.selftest.ts`、`scripts/ops/operational-handoff.ts`、`scripts/quality/operational-handoff-validate.ts`、`scripts/quality/operational-handoff-validate.selftest.ts`、`scripts/quality/ops-readonly-side-effect.selftest.ts`、`scripts/ops/long-term-evidence-snapshot.ts`、`scripts/quality/long-term-evidence-snapshot-validate.ts`、`scripts/quality/long-term-evidence-snapshot.selftest.ts`、`scripts/ops/support-bundle-preview.ts`、`scripts/ops/backup-restore-preview.ts`、`scripts/quality/backup-restore-preview-validate.ts`、`scripts/quality/backup-restore-preview.selftest.ts`、长期运营控制面入口 | `pnpm enterprise:operability:preflight`，`pnpm maintenance:cadence:preflight`，`pnpm release:train:preflight`，`pnpm ops:readiness`，`pnpm ops:status`，`pnpm ops:status:validate <operability-status.json>`，`pnpm ops:status:validate:selftest`，`pnpm ops:status:selftest`，`pnpm ops:handoff`，`pnpm ops:handoff:validate <operational-handoff.json>`，`pnpm ops:handoff:validate:selftest`，`pnpm ops:handoff:selftest`，`pnpm ops:readonly-side-effect:selftest`，`pnpm ops:long-term:snapshot:selftest`，`pnpm ops:support:bundle-preview:selftest`，`pnpm ops:backup-restore:preview:selftest`，`pnpm residuals:validate`，`pnpm residuals:review-due`，`pnpm residuals:closure:selftest`，`pnpm docs:readiness`，`pnpm skills:validate`，`git diff --check`；若保存 residual 人工复核记录，运行 `pnpm residuals:closure:validate <record>`；若需要固定当前证据与缺口，运行 `pnpm ops:long-term:snapshot > <snapshot.json>` 和 `pnpm ops:long-term:snapshot:validate <snapshot.json>`；若需要固定备份/恢复证据缺口，运行 `pnpm ops:backup-restore:preview > <backup-restore-preview.json>` 和 `pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>` |
| `scripts/ops/long-term-operability-live-gate.ts`、`scripts/quality/long-term-operability-live-gate.selftest.ts`、长期运营完成声明 gate | `pnpm ops:long-term:gate:selftest`，`pnpm enterprise:operability:preflight`，`pnpm ops:status`，`pnpm ops:status:selftest`，`pnpm docs:readiness`，`pnpm skills:validate`，`git diff --check`；若用于实际长期运营完成声明，运行 `pnpm ops:long-term:gate`，缺 OPS-001、OPS-004、OPS-005、可校验 Release 发布记录、签名 Release 供应链或新鲜 UX 证据时该命令应失败 |
| `apps/web/lib/system/product-experience-contract.ts`、`scripts/quality/product-experience-source.ts`、`apps/web/lib/system/runtime-identity-core.ts`、`apps/web/lib/system/runtime-identity-development.ts`、`apps/web/lib/system/runtime-identity.ts`、`apps/web/next.config.ts`、`scripts/ops/generate-runtime-identity.ts`、`scripts/ops/product-experience-runtime-probe.ts`、`/api/health` runtime identity、体验记录 runtime binding | `pnpm experience:runtime:selftest`、`pnpm release:runtime-identity:selftest`、`pnpm experience:review:selftest`、`pnpm github-release-updater:preflight:selftest`、`pnpm github-release-updater:preflight`、`pnpm release:workflow:policy:selftest`、`pnpm quality:operability:typecheck`、`pnpm check`、`git diff --check`；真实复核先运行 `pnpm experience:runtime:probe <baseUrl> <repo-relative-output.json>`，再运行 record hash/validate。health route 只能依赖纯 identity core 和固定 production identity 文件；Git/worktree 指纹只允许在开发启动配置或 CLI/selftest 中计算，且实现必须位于 Web runtime 扫描范围外。缺失、损坏、runtime mode 错误或与 `APP_VERSION` 冲突的 immutable identity 必须使 health 返回 503。 |
| `scripts/ops/long-term-evidence-snapshot.ts`、`scripts/quality/long-term-evidence-snapshot-validate.ts`、`scripts/quality/long-term-evidence-snapshot.selftest.ts`、长期运营只读证据快照 | `pnpm ops:long-term:snapshot:selftest`，`pnpm ops:long-term:snapshot > <snapshot.json>`，`pnpm ops:long-term:snapshot:validate <snapshot.json>`，`pnpm enterprise:operability:preflight`，`pnpm ops:readiness`，`pnpm ops:status`，`pnpm ops:handoff`，`pnpm docs:readiness`，`pnpm skills:validate`，`git diff --check`；schema v3 必须包含 dataIntegrity check/path/file hash/internal doctorHash/freshness/nextCommand，UX check 必须继承共享 evaluator 的四态、同一注入时钟、expected version、安全命令和 record hash，禁止 subprocess 二次判定或读取 workspace 外 UX 路径。默认 validator 必须返回 `bindingStatus: current`，v1/v2 只允许 `--shape-only` 且不可 ready。缺 doctor、OPS-001 或 backup hash 时快照保持 `needs_live_evidence`；validator 通过不等于生产健康、并发根因修复或 residual 关闭 |
| `docs/development/maintenance-cadence.md`、`scripts/quality/maintenance-cadence-preflight.ts`、维护节奏入口 | `pnpm maintenance:cadence:preflight`，`pnpm ops:readiness`，`pnpm ops:status`，`pnpm ops:status:validate:selftest`，`pnpm ops:status:selftest`，`pnpm ops:handoff`，`pnpm ops:handoff:validate:selftest`，`pnpm ops:handoff:selftest`，`pnpm ops:backup-restore:preview:selftest`，`pnpm residuals:validate`，`pnpm residuals:review-due`，`pnpm docs:readiness`，`pnpm skills:validate`，`git diff --check` |
| `docs/development/maintenance-window-record-template.md`、`docs/development/maintenance-window-index.json`、`scripts/ops/generate-maintenance-window-record.ts`、`scripts/quality/maintenance-window-record.selftest.ts`、`scripts/quality/maintenance-window-record-validate.ts`、`scripts/quality/maintenance-window-record-validate.selftest.ts`、`scripts/ops/maintenance-window-index.ts`、`scripts/quality/maintenance-window-index-common.ts`、`scripts/quality/maintenance-window-index-validate.ts`、`scripts/quality/maintenance-window-index.selftest.ts` | `pnpm maintenance:window:record:selftest`，`pnpm maintenance:window:selftest`，`pnpm maintenance:window:index:selftest`，`pnpm maintenance:window:index:validate docs/development/maintenance-window-index.json`，`pnpm maintenance:cadence:preflight`，`pnpm enterprise:operability:preflight`，`pnpm docs:readiness`，`git diff --check`；若形成真实维护窗口记录，运行 `pnpm maintenance:window:validate <record>`，完整重建索引后再校验，禁止保留部分索引或把索引当成维护动作证据 |
| `docs/development/incident-record-template.md`、`docs/development/incident-index.json`、`docs/development/rollback-proof-record-template.md`、`scripts/ops/generate-incident-record.ts`、`scripts/quality/incident-record-validate.ts`、`scripts/quality/incident-record-validate.selftest.ts`、`scripts/ops/incident-index.ts`、`scripts/quality/incident-index-common.ts`、`scripts/quality/incident-index-validate.ts`、`scripts/quality/incident-index.selftest.ts`、`scripts/quality/rollback-proof-record-validate.ts`、`scripts/quality/rollback-proof-record-validate.selftest.ts`、`.codex/skills-src/areaforge-incident-response/**` | `pnpm incident:record:selftest`，`pnpm incident:index:selftest`，`pnpm incident:index:validate docs/development/incident-index.json`，`pnpm rollback:proof:selftest`，`pnpm ops:status:selftest`，`pnpm ops:status:validate:selftest`，`pnpm ops:handoff:selftest`，`pnpm ops:handoff:validate:selftest`，`pnpm ops:readonly-side-effect:selftest`，`pnpm ops:readiness`，`pnpm maintenance:cadence:preflight`，`pnpm enterprise:operability:preflight`，`pnpm docs:readiness`，`pnpm skills:validate`，`git diff --check`；若形成真实事故记录，运行 `pnpm incident:record:validate <record>`，只有 `resolved + postIncidentReview=yes` 的记录可进入历史索引并完整重建；若实际执行 rollback，另运行 `pnpm rollback:proof:validate <record>`，`ready-for-human-review` 不等于自动重新开放更新通道 |
| `docs/development/restore-drill-record-template.md`、`scripts/quality/restore-drill-validate.ts`、`scripts/quality/restore-drill-validate.selftest.ts`、`docs/deployment/backup-restore.md`、`scripts/ops/backup-restore-preview.ts`、`scripts/quality/backup-restore-preview-validate.ts`、`scripts/quality/backup-restore-preview.selftest.ts` | `pnpm restore:drill:selftest`，`pnpm ops:backup-restore:preview:selftest`，`pnpm operator:onboarding:preflight`，`pnpm maintenance:cadence:preflight`，`pnpm enterprise:operability:preflight`，`pnpm ops:readiness`，`pnpm docs:readiness`，`git diff --check`；若形成真实恢复演练记录，运行 `pnpm restore:drill:validate <record>`；若形成备份/恢复证据预览，运行 `pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>` |
| `docs/development/update-agent-status-record-template.md`、`scripts/ops/generate-update-agent-status-record.ts`、`scripts/quality/update-agent-status-record.selftest.ts`、`scripts/quality/update-agent-status-validate.ts`、`scripts/quality/update-agent-status-validate.selftest.ts`、update-agent redacted status 交接入口 | `pnpm update-agent:status:record:selftest`，`pnpm update-agent:status:selftest`，`pnpm github-release-updater:preflight`，`pnpm ops:readiness`，`pnpm enterprise:operability:preflight`，`pnpm docs:readiness`，`git diff --check`；若形成真实 redacted status JSON，运行 `pnpm update-agent:status:record <status.json> > <record.json>` 和 `pnpm update-agent:status:validate <record.json>`；用于当前版本 OPS-001 或长期运营证据时，带 `AREAFORGE_UPDATE_AGENT_EXPECTED_VERSION=<version>`，需要新鲜度门禁时再带 `AREAFORGE_UPDATE_AGENT_MAX_AGE_SECONDS=<seconds>` |
| `prisma/schema.prisma`、`prisma/migrations/**` | `pnpm db:validate`，涉及 migration 时补充迁移和回滚说明 |
| `packages/core/**` | 相关单元测试，至少 `pnpm typecheck` |
| `packages/db/**` | `pnpm db:generate`、`pnpm typecheck`，涉及查询行为时补测试或手动验证 |
| `packages/ai/**` | AI 输出 schema 校验测试，本地回退路径验证 |
| `packages/storage/**`、`docs/architecture/file-storage.md`、`.codex/skills-src/areaforge-file-storage-safety/**` | 上传策略测试，大小、MIME、路径穿越边界验证；涉及附件、`UPLOAD_DIR`、对账、备份/恢复或迁移时补跑 `pnpm risk:preflight`、相关 upload/download smoke 和 docs gates |
| `apps/web/**` UI | `pnpm check`，可启动时用浏览器或截图检查主要页面；涉及版本中心请求边界时补跑 `pnpm update-center:request-guard:selftest` 和 `pnpm github-release-updater:preflight`；涉及核心学习闭环、附件、模拟、阶段或版本中心体验时，在本地临时库上补跑 `pnpm smoke:local-ux`；用于体验收口或 release/update 交接时，按 `docs/development/product-experience-review-record-template.md` 留下记录并运行 `pnpm experience:review:validate <record>` |
| `docs/development/update-request-expected-before-design.md`、`apps/web/lib/system/update-center.ts`、`apps/web/lib/system/update-center-health.ts`、`apps/web/app/api/system/update-requests/route.ts`、`ops/update-agent/areaforge-update-agent.sh`、`ops/github-release-updater/areaforge-updater.sh` 的 shared-lock/target-identity 接口、update request fixture/selftest | 确认前只运行 docs/risk/governance gates；确认后运行 `pnpm ops:ops-005:local:selftest`，覆盖 V2 schema、safe-integer Release ID、三类 domain-separated hash、queued status 与 rollback availability binding、TTL 初始/最终边界、双重 expected-before、target identity、`TARGET_VERSION_NOT_NEWER`、durability/网络不确定重试 key 复用、idempotency conflict、processing reconciliation 与多 request ambiguity、decision -> status -> claim cleanup 的 fsync 恢复、root inode 原子替换失败、shared lock、legacy、重复/矛盾 marker、atomic publish 和 zero-side-effect，并补跑 `pnpm shellcheck:updater`、`pnpm github-release-updater:preflight`、Web typecheck/lint、`pnpm check`、`pnpm governance:preflight`、`pnpm risk:preflight`、`git diff --check`。本地通过不授权生产 timer、队列、agent 部署、updater apply、rollback 或策略变化；脏工作树不得绑定为 Release commit。 |
| `docs/development/ops-005-expected-before-production-evidence-template.md`、`scripts/ops/ops005-evidence-preflight.ts`、`scripts/quality/ops005-evidence-preflight.selftest.ts`、`scripts/quality/ops005-production-evidence-validate.ts`、`scripts/quality/ops005-production-evidence-validate.selftest.ts`、OPS-005 生产证据记录 | `pnpm ops:ops-005:evidence:selftest`、`pnpm ops:ops-005:preflight:selftest`、`pnpm ops:ops-005:preflight`、`pnpm release:supply-chain:selftest`、`pnpm release:workflow:policy:selftest`、`pnpm github-release-updater:preflight:selftest`、`pnpm ops:long-term:gate:selftest`、`pnpm ops:long-term:snapshot:selftest`、`pnpm ops:readonly-side-effect:selftest`、`pnpm ops:readiness`、`pnpm enterprise:operability:preflight`、`pnpm maintenance:cadence:preflight`、`pnpm docs:readiness`、`pnpm residuals:validate`、`git diff --check`；signed Release 阶段和独立 production evidence validator 都必须提供 assets 目录并通过 strict assets/checksum/cosign 校验。若形成生产证据记录，运行 `pnpm ops:ops-005:evidence:validate <record> <release-record> <release-assets-dir>`，并要求 24 小时 freshness、生产 web digest 与签名 Release 一致、生产 agent/updater hash 与该 Release commit checkout 一致、实际 redacted rejection/history/operational 文件 path+hash 绑定、成功零执行 V2 check、shared lock/reconciliation 证据和至少一条 `executionAttempted=no` rejection。`ready_for_ops005_human_review` 不自动关闭 residual。 |
| `docs/development/data-integrity-doctor.md`、`scripts/ops/data-integrity-doctor.ts`、`scripts/quality/data-integrity-doctor-validate.ts`、`scripts/quality/data-integrity-doctor.selftest.ts`、业务数据完整性只读诊断 | `pnpm ops:data-integrity:selftest`、`pnpm ops:status:selftest`、`pnpm ops:handoff:selftest`、`pnpm ops:long-term:gate:selftest`、`pnpm ops:long-term:snapshot:selftest`、`pnpm ops:readiness`、`pnpm enterprise:operability:preflight`、`pnpm maintenance:cadence:preflight`、`pnpm residuals:validate`、`pnpm docs:readiness`、`pnpm check`、`git diff --check`；真实记录使用只读数据库账号运行 doctor 和 validator，再以 `AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD=<record>` 生成 schema v3 snapshot 并通过默认 current-binding validator。validator 通过不修复数据或关闭 OPS-006。 |
| `docs/development/ops-006-business-state-concurrency-design.md`、`apps/web/lib/study/concurrency.ts`、session/task/simulation/debt-reorder/CheckIn 写路径、canonical migration、`scripts/quality/ops006-concurrency-preflight*`、`scripts/quality/ops006-concurrency-runtime*`、OPS-006 本地并发证据链 | `pnpm quality:operability:typecheck`、`pnpm ops:ops-006:preflight:selftest`、`pnpm ops:ops-006:runtime:validate:selftest`、`pnpm ops:ops-006:runtime:validate <record>`、带 fresh doctor/runtime 环境变量的 `pnpm ops:ops-006:preflight:strict`、`pnpm ops:data-integrity:selftest`、before/after doctor validator、`pnpm db:generate`、`pnpm db:validate`、隔离 PostgreSQL `pnpm db:migrate:deploy` 与 runtime selftest、Web typecheck/lint、`pnpm check`、`pnpm risk:preflight`、`pnpm docs:readiness`、`git diff --check`；V2 `local_concurrency_verified` 必须绑定 canonical migration、24 小时内 `configured_read_only_query` doctor、隔离 PostgreSQL runtime record、当前实现文件以及 task/design/确认包 source hash。strict 通过只证明 `local_verified`，不授权签名 Release、生产 migration/deploy、历史修复或 residual 关闭；附件状态不参与 OPS-006 session/task 判定。 |
| `docs/development/ops-007-attachment-crash-window-design.md`、`scripts/quality/ops007-attachment-preflight.ts`、`scripts/quality/ops007-attachment-preflight.selftest.ts`、`scripts/quality/attachment-crash-window-validate.ts`、`scripts/quality/attachment-crash-window-validate.selftest.ts`、`scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json`、OPS-007 确认前静态 preflight | `pnpm quality:operability:typecheck`、`pnpm ops:ops-007:preflight:selftest`、状态投影 `pnpm ops:ops-007:preflight`、确认边界断言 `pnpm ops:ops-007:preflight:strict`、`pnpm attachment:crash-window:selftest`、`pnpm attachment:crash-window:validate scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json`、`pnpm attachment:reconciliation:summary:selftest`、`pnpm risk:preflight`、`pnpm docs:readiness`、`git diff --check`；`evidenceClass: protocol_preimage_candidate` 分别绑定 task/design/high-risk packet/current schema/fixture file hash、fixture 内部 hash 和组合 `sourceBindingHash`。该只读证据不修改或证明 Attachment migration、runtime、filesystem、backup/restore、上传目录或 production；未经高风险实施确认，strict 必须非零退出。确认后另跑临时 PostgreSQL/上传目录 kill-point、fsync、O_NOFOLLOW 和 reconciliation 行为测试。 |
| `docs/development/ops-008-updater-phase-journal-design.md`、`scripts/quality/ops008-updater-preflight.ts`、`scripts/quality/ops008-updater-preflight.selftest.ts`、`scripts/quality/updater-phase-journal-validate.ts`、`scripts/quality/updater-phase-journal-validate.selftest.ts`、`scripts/quality/updater-maintenance-control-validate.ts`、`scripts/quality/updater-maintenance-control-validate.selftest.ts`、OPS-008 checked-in fixtures | `pnpm ops:ops-008:preflight:typecheck`、`pnpm ops:ops-008:preflight:selftest`、状态投影 `pnpm ops:ops-008:preflight`、确认边界断言 `pnpm ops:ops-008:preflight:strict`、`pnpm updater:phase-journal:selftest`、`pnpm updater:phase-journal:validate scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json`、`pnpm updater:maintenance-control:selftest`、drained/active-claim-waiting/production-lock-waiting 三份 fixture validate、`pnpm shellcheck:updater`、`pnpm github-release-updater:preflight`、`pnpm docs:readiness`、`git diff --check`；`evidenceClass: runtime_preimage_candidate` 只绑定 task/design/确认包、当前 updater/update-agent 脚本和 4 份 phase-journal/3 份 maintenance fixture 的 source hash 与 `OPS-008-PREFLIGHT-CONTRACT-V1`。phase event 必须逐事件绑定 operation/Release identity，reconciliation 必须保留截至 uncertain started 的完整阶段前缀，terminal 使用 started/applied。candidate 完整不证明 journal durability、hold/claim 锁顺序、timer 状态或生产行为；未经高风险实施确认，strict 必须非零退出。 |
| `infra/**`、`docker-compose*.yml` | `docker compose config`，部署文档同步检查 |
| `.github/workflows/**`、`ops/github-release-updater/**`、`ops/update-agent/**`、Release admission/identity/policy、供应链和 updater 脚本 | `pnpm secrets:scan`、`pnpm release:admission:selftest`、`pnpm release:identity:probe:selftest`、`pnpm release:workflow:policy`、`pnpm release:workflow:policy:selftest`、`pnpm audit:all`、`pnpm audit:prod`、`pnpm shellcheck:updater`、`pnpm github-release-updater:preflight`、`pnpm update-center:request-guard:selftest`、`pnpm governance:preflight`、`pnpm ops:readiness`；涉及 expected-before V2、processing reconciliation 或 shared production-state lock 时运行 `pnpm ops:ops-005:local:selftest`；涉及供应链记录校验时运行 `pnpm release:supply-chain:selftest`、`pnpm release:supply-chain:record:selftest`、`pnpm ci:supply-chain:selftest` 和 `pnpm sc:sc-002:preflight:selftest`；不可变身份探测只有明确 absent 才能继续，exists 或 probe failure 都必须阻断 |
| `docs/development/release-train.md`、`scripts/quality/release-train-preflight.ts`、Release train 入口 | `pnpm release:train:preflight`，`pnpm release:admission:selftest`，`pnpm release:identity:probe:selftest`，`pnpm release:workflow:policy`，`pnpm release:workflow:policy:selftest`，核对 default-branch ancestry、全部 workspace version、tag-bound concurrency、channel 白名单和不可变身份三态 fail-closed，`pnpm github-release-updater:preflight`，`pnpm governance:preflight`，`pnpm ops:readiness`，`pnpm docs:readiness`，`pnpm skills:validate`，`git diff --check` |
| `docs/development/github-main-protection-record-template.md`、`scripts/quality/github-main-protection-validate.ts`、`scripts/ops/sc004-main-protection-preflight.ts`、SC-004 本地证据链 | `pnpm sc:sc-004:validate:selftest`、`pnpm sc:sc-004:preflight:selftest`、`pnpm ops:status:selftest`、`pnpm ops:handoff:selftest`、`pnpm ops:readiness`、`pnpm governance:preflight`、`git diff --check`；真实 readback/controlled PR 记录必须绑定 `ci / verify`、PR URL/number/head SHA、failure/success check conclusion 和 Actions run URL，再运行 `pnpm sc:sc-004:validate <readback.json> <controlled-pr.json>` 与带环境变量的 `pnpm sc:sc-004:preflight`。本地通过不修改 GitHub 设置、不创建 PR、不关闭 residual。 |
| Release evidence redacted export、fallback finalizer、release record 修订稿 | `pnpm ops:ops-001:fallback:selftest`、`pnpm release:evidence:redacted-export:selftest`、`pnpm release:evidence:redacted-export:record:selftest`、`pnpm ops:ops-001:fallback:finalize:selftest`；真实 redacted export 目录先运行 `pnpm release:evidence:redacted-export:validate <dir>`，再生成 draft record 并运行 `pnpm release:evidence:validate <draft-record> <attachment.csv> <attachment-summary.json>`；redacted update export 不替代附件双向对账。 |
| `scripts/ops/release-closeout-audit.ts`、`scripts/quality/release-closeout-audit-validate.ts`、`scripts/quality/release-closeout-audit.selftest.ts`、Release/supply-chain/operational evidence/post-release observation/residual 跨记录一致性 | `pnpm release:closeout:audit:selftest`、`pnpm release:closeout:audit -- --version <X.Y.Z> > <audit.json>`、`pnpm release:closeout:audit:validate <audit.json>`、`pnpm release:post-observation:validate <record>`、`pnpm ops:readonly-side-effect:selftest`、`pnpm ops:status:selftest`、`pnpm ops:handoff:selftest`、`pnpm ops:readiness`、`pnpm enterprise:operability:preflight`、`pnpm maintenance:cadence:preflight`、`pnpm docs:readiness`、`git diff --check`；audit 必须将真实阻塞、过期缺证据和合法等待精确投影到 `blockedBy`、`attentionBy`、`pendingBy`，且只能诊断 identity/hash/residual/rollback/observation 不一致，不得修改历史记录或关闭 residual。 |
| `.env.example`、配置解析 | 配置 schema 覆盖检查，敏感字段不入库检查 |
| 高风险包确认前准备 | `pnpm risk:preflight`，确认只读护栏、配置键、文档引用和危险默认值 |
| `scripts/ops/operational-evidence-bundle.ts`、`scripts/quality/operational-evidence-source.ts`、`scripts/quality/operational-evidence-bundle-validate.ts`、`scripts/quality/operational-evidence-bundle-validate.selftest.ts`、运营证据 bundle current binding | `pnpm ops:evidence:bundle:selftest`，`pnpm ops:evidence:bundle > <bundle.json>`，`pnpm ops:evidence:bundle:validate <bundle.json>`，`pnpm quality:operability:typecheck`，`pnpm ops:readonly-side-effect:selftest`，`pnpm docs:readiness`，`git diff --check`；schema v2 默认 validator 必须输出 `bindingStatus: current`，修改、删除、symlink 替换任一显式证据输入，或 package/实现/readiness 配置漂移时必须失败；历史 schema v1/v2 只允许显式 `--shape-only`，current binding 不证明生产健康 |

## Package B Batch 0 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 0 后，才允许修改 `prisma/schema.prisma` 和生成 migration。实现后至少运行：

- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：开始计时、结束计时、active session、dashboard、analytics、reports。
- 页面烟测：首页结束一次计时后刷新，仍能看到有效/低转化状态和收口文本。

注意：Batch 0 获确认后，`pnpm risk:preflight` 已调整为允许 Batch 0 字段存在，继续阻止 Batch 1-6 未确认模型越界。

## Package B Batch 1 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 1 后，才允许新增 `CheckIn` 模型、生成 migration 和改写快照读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：结束计时、保存复盘、任务 `create/update/complete/defer/drop/recover/split/convert-review` 后当日 `CheckIn` 被 upsert；计划日变化必须刷新旧学习日和新学习日；dashboard、analytics、reports 优先读快照，缺失日期 fallback 正常。
- active session 烟测：无关联任务开始计时但未结束时，首页可以实时展示正在运行的时长，但不得创建或改写 `CheckIn`；若关联任务从 `TODO` 改为 `IN_PROGRESS`，只允许刷新任务计划日的任务状态口径，不得写入未结束 session 时长；结束计时后才固化到日快照。
- 页面烟测：首页、`/analytics`、`/reports` 刷新后连续性、低效天和低转化提示保持一致。

注意：Batch 1 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model CheckIn` 在 schema 中出现，也必须阻止 `prisma.checkIn` / `tx.checkIn` 读写路径提前出现；Batch 1 完成并更新台账后，门禁应要求 `model CheckIn` 存在，并继续阻止 Batch 2-6 未确认模型越界。

## Package B Batch 2 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 2 后，才允许新增 `StudyTask.parentTaskId`、`TaskDebtEvent`、生成 migration 和改写债务事件写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：complete、defer、drop、recover、split、convert-review、end-session 自动完成路径和模拟考试完成路径同时写入 `AuditEvent` 与 `TaskDebtEvent`；拆小任务写入 `parentTaskId`；旧任务仍按 `StudyTask.status/debtStatus/plannedDate` fallback。
- 页面烟测：首页任务区、欠账预览和 `/reports` 对旧数据与新事件账本展示一致。

注意：Batch 2 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `parentTaskId` 和 `model TaskDebtEvent` 在 schema 中出现；Batch 2 完成并更新台账后，门禁应要求 Batch 2 字段/模型存在。Batch 6 完成前，门禁继续阻止 Batch 6 未确认模型越界。

## Package B Batch 3 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 3 后，才允许新增 `RecoveryState`、生成 migration 和改写恢复状态读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：无 active 状态时 dashboard fallback 实时规则；手动和规则触发创建 active `RecoveryState`；完成或取消只更新 `RecoveryState.status/endedAt/exitCondition`；`StudyTask` 不被批量改写。
- 页面烟测：首页恢复模式刷新后持久，计时器聚焦恢复候选但任务面板保留完整任务列表；退出后恢复正常任务展示和实时 fallback。

注意：Batch 3 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model RecoveryState` 在 schema 中出现；Batch 3 完成并更新台账后，门禁应要求 `RecoveryState` 存在。Batch 6 完成前，门禁继续阻止 Batch 6 未确认模型越界。

## Package B Batch 4 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 4 后，才允许新增 `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`、生成 migration 和改写考纲掌握证明读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：条件勾选、证据引用、复测 passed/failed/partial、标记 mastered 的 `evaluateMasteryProof` 拦截、无显式证据 fallback 到现有 `_count`。
- 页面烟测：`/syllabus` 条件、证据、复测、刷新后节点状态和历史 fallback 展示一致。

注意：Batch 4 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model MasteryConditionRecord`、`model MasteryEvidence` 和 `model MasteryRetest` 在 schema 中出现；Batch 4 完成并更新台账后，门禁应要求 Batch 4 模型存在。Batch 5 和 Batch 6 分别由各自批次台账解锁对应模型；复测失败或部分通过不能自动降低节点状态。

## Package B Batch 5 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 5 后，才允许新增 `SimulationExam`、`SimulationSubjectResult`、生成 migration 和改写结构化模拟考试读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：创建结构化模拟考试、保存科目结果、同一场同一科唯一性、旧 `StudyTask.type = "simulation_exam"` 只读兼容。
- 页面烟测：`/simulation` 列表、结果保存、刷新和第一次同步自测标记保持一致。

注意：Batch 5 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model SimulationExam` 和 `model SimulationSubjectResult` 在 schema 中出现；Batch 5 完成并更新台账后，门禁应要求这些模型存在，并在 Batch 6 完成前继续阻止 Batch 6 未确认模型越界；本批不自动迁移旧任务型模拟，也不自动调整阶段计划。

## Package B Batch 6 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 6 后，才允许新增 `StagePlan`、`StageAdjustmentDraft`、生成 migration 和改写阶段计划/阶段调整草稿读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：阶段计划创建/更新、草稿生成、驳回、确认应用、重复提交、审计记录、`canAutoApply=false`、`requiresUserConfirmation=true`、Batch 6 范围内不触发长期阶段 AI 外呼。
- 页面烟测：`/simulation` 和 `/reports` 中阶段计划、草稿边界和确认状态展示一致。

注意：Batch 6 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model StagePlan` 和 `model StageAdjustmentDraft` 在 schema 中出现；Batch 6 完成并更新台账后，门禁应要求这些模型、migration、service、API、DTO、UI 和确认边界证据存在。Batch 6 只狭窄允许阶段草稿 `confirm/reject` 写路由，用于用户显式确认后更新关联 `StagePlan` 和写审计；任何自动任务重排、批量修改任务、报告决策应用、长期 AI 外呼或生产 migration deploy 都不属于本批。

## Package A 专项验证

确认前只允许做文档、storage 纯规则和护栏准备：

- `pnpm --filter @areaforge/storage test`
- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`
- 人工扫描：`rg --files apps/web/app | rg 'attachments|upload'` 不应出现上传/下载 route。
- 人工扫描：`find apps/web/public -name uploads -o -name attachments -o -name files` 不应出现公开上传目录。
- 人工扫描：`rg 'attachment\.uri|upload://attachment' apps/web/app apps/web/components` 不应出现 UI 直链内部 metadata。
- 人工扫描：`rg 'type=\"file\"|multipart/form-data|FormData|downloadUrl|/api/attachments' apps/web/app apps/web/components apps/web/lib` 不应出现附件上传 UI、提前下载 URL 或上传调用。

用户明确确认 Package A 后，才允许新增上传/下载 route、附件服务、`/notes` 上传 UI 和真实 `UPLOAD_DIR` 写入。实现后至少运行：

- `pnpm --filter @areaforge/storage test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：未登录上传/下载 `401`；允许类型成功；超大、伪造 MIME、路径穿越、软链接逃逸失败；DB 写入失败补偿删除本次文件；文件写入失败不创建 metadata。
- API 状态码矩阵：多个 `file` 字段 `400`；空文件 `400`；畸形 multipart `400`；非法 `disposition` `400`；未登录 `401`；笔记不存在或文件缺失 `404`；metadata/hash 不一致 `409`；超大文件 `413`；不安全上传目录、文件写入失败或 metadata 写入失败 `500`，且响应不包含内部路径。
- 页面烟测：`/notes` 上传、刷新后附件列表、鉴权下载和响应头。
- 对账烟测：metadata hash/size 与文件 hash/size 一致；只读对账报告 `action=report_only`。

注意：Package A 完成后，`pnpm risk:preflight` 必须改为要求上传/下载 route、`attachments-service.ts`、`/notes` 上传 UI、鉴权 `downloadApiPath` 和附件专项证据存在，同时继续阻止 public 暴露、内部 `uri` / `storedName` / 上传绝对路径泄露，以及 Package A 范围外的删除、跨对象附件、AI 解析和生产发布。

## Package C 专项验证

确认前只允许做文档、mock/fallback 测试和护栏准备：

- `pnpm --filter @areaforge/ai test`
- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Package C 后，才允许接入真实 OpenAI-compatible provider、读取真实 AI env/key 和发起外呼。实现后至少运行：

- `pnpm --filter @areaforge/ai test`
- `pnpm --filter @areaforge/ai typecheck`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- Provider 测试：`AI_ENABLED=false` fallback；配置缺失 fallback；mock 成功；超时、429、401、5xx、invalid JSON 和 schema invalid fallback；敏感字段拦截时 provider 不被调用。
- 安全扫描：客户端 bundle 搜不到 `AI_API_KEY`；日志不包含完整 prompt、完整模型响应、API Key、动机档案、完整复盘正文、完整情绪正文或附件内容。
- 标题隐私烟测：构造任务标题为 `task title may contain private content`，确认 mock provider 请求体不包含该原文；真实 provider 第一版只允许发送任务类型、科目、风险类别或脱敏占位标签。
- 成本边界烟测：首页普通 SSR 不触发真实 provider；真实外呼只能来自明确允许的 AI API 或用户显式触发入口。

注意：Package C 完成后，`pnpm risk:preflight` 必须改为要求 provider、Web 服务端 env、显式 route 触发、fallback、标题脱敏和专项测试证据存在，同时继续阻止客户端公开 AI env、首页普通 SSR 外呼、敏感上下文发送、完整 prompt/raw response 持久化、长期阶段 AI 外呼和自动覆盖记录。

## Package D 专项验证

确认前只允许做只读规则、只读 API/UI 标签和护栏准备：

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm package-d:preflight`
- `pnpm risk:preflight`
- `git diff --check`
- 人工扫描：`rg --files apps/web/app/api | rg 'debt-reorder|reports|simulation/stage|simulation/exams' | rg 'apply|confirm|reject|ai'` 不应出现未确认的长期闭环写路由；Package D Batch D1 完成后，仅 `/api/reports/periodic/decisions` 属于已确认报告决策入口；Package D Batch D2 完成后，仅 `/api/tasks/debt-reorder/decisions` 和 `/api/tasks/debt-reorder/applications` 属于已确认债务重排所选项写入口；Package D Batch D3 完成后，仅 `/api/simulation/stage-adjustment-drafts/ai` 属于已确认长期 AI 草稿显式触发入口。
- 人工扫描：`rg 'ReportSnapshot|ReportDecision|TaskReorderApplication|StagePlanApplication|AiStageAdjustment|AiCall|AiUsage|promptHash|tokenUsage|rawResponse' prisma apps/web/lib/study packages/ai/src` 不应出现未确认的应用或长期 AI 持久化面；Package D Batch D1 完成后，仅 `PeriodicReportDecision` 与 `periodicReportDecision` 属于已确认报告决策账本；Package D Batch D3 完成后，仅 `aiStageAdjustmentDraftSchema` 这类草稿 schema 命名和 `StageAdjustmentDraft.source="ai"` 写入属于已确认范围，不允许新增长期 AI 调用历史或费用账本。
- 只读回归：`GET /api/tasks/debt-reorder`、`GET /api/reports/periodic`、`GET /api/simulation/stage` 只能暴露只读建议或草稿，返回体里的建议必须保留 `canAutoApply=false` / `requiresUserConfirmation=true`；对应 GET 路径不得出现 `POST`、`PATCH`、`PUT` 或 `DELETE` 应用语义。D2 的债务重排写入只允许在 `decisions` 和 `applications` 子路由中处理用户所选项。

用户明确确认对应 Package D 批次后，才允许新增该批次范围内的任务重排应用、阶段计划应用、报告决策写入、报告快照持久化或长期 AI 阶段调整外呼。D3 已完成的长期 AI 只限显式草稿入口；D3 范围外能力仍需后续确认。实现后至少运行：

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：债务重排确认/驳回/应用、重复提交、部分失败摘要和审计记录；阶段草稿确认/驳回/应用；报告策略确认/驳回。
- 页面烟测：首页、`/reports`、`/analytics`、`/syllabus`、`/simulation` 展示确认边界和应用结果。
- 边界烟测：用户确认前不应用；D3 显式入口之外长期阶段 AI 外呼关闭；Package B 结构化模型缺失时仍有只读 fallback。

推荐批次验证：

| 批次 | 验证重点 |
|---|---|
| Batch D1 报告决策入口 | `pnpm db:generate`、`pnpm db:validate`、临时库 `pnpm db:migrate:deploy`；周/月报告确认、驳回、重复提交、审计摘要、冻结 `reportSnapshot`、下一周期草稿和只读回放；确认/驳回前后 `StudyTask`、`TaskDebtEvent`、`StagePlan`、`StageAdjustmentDraft` 不变 |
| Batch D2 债务重排确认流 | 不新增 migration；建议确认/驳回/应用、只处理所选项、`TaskDebtEvent` 和 `AuditEvent` 双证据、部分失败停止或返回跳过摘要、重复提交幂等、不自动延期/删除全部欠账 |
| Batch D3 长期阶段 AI 草稿 | 已完成：鉴权 POST-only `/api/simulation/stage-adjustment-drafts/ai`；长期 AI 最小字段清单和阶段目标摘要；禁止字段扫描；`AI_ENABLED=false` 本地规则；配置缺失 fallback；mock provider 成功写 `source="ai"`；schema invalid fallback；敏感字段拦截；客户端密钥扫描；草稿不自动应用；前后 `StudyTask`、`TaskDebtEvent` 和 `StagePlan` 不变 |
| Batch D4 长期风险和主题闭环 | 已完成：`GET /api/analytics/long-term-risks` 鉴权 GET-only；`long-term-risk-service` 调用 `summarizeLongTermRisks` 并保留 `evidenceFreshness`、`nextAction`、`canAutoApply=false`、`requiresUserConfirmation=true`；`/reports`、`/analytics`、`/syllabus`、`/notes`、`/simulation` 和首页状态主题共用同一长期风险 DTO；service/route smoke 证明业务表不变 |
| Batch D5 收口 | 已完成：`pnpm check`、`pnpm package-d:preflight`、`pnpm risk:preflight`、`pnpm docs:readiness` 通过；`pnpm docs:completion` 在 Package E E1-E4 收口后一并通过 |

注意：Package D 全部完成前，`pnpm risk:preflight` 必须继续阻止未确认批次的长期 AI 外呼和跨模块应用路径越界。Package B Batch 6 完成后，仅 `/api/simulation/stage-adjustment-drafts/:id/confirm|reject` 属于已确认的阶段草稿状态写入；Package D Batch D1 完成后，仅 `/api/reports/periodic/decisions` 属于已确认报告决策入口；Package D Batch D2 完成后，仅 `/api/tasks/debt-reorder/decisions` 和 `/api/tasks/debt-reorder/applications` 属于已确认债务重排所选项写入口；Package D Batch D3 完成后，仅 `/api/simulation/stage-adjustment-drafts/ai` 属于已确认长期 AI 草稿显式触发入口。其他 `apply/confirm/reject` 写路由、自动阶段应用、长期 AI 历史持久化和费用账本仍必须拦截。

`pnpm package-d:preflight` 采用批次感知门禁：D3 完成后只狭窄放行长期 AI 草稿 route/service 和 `source="ai"` 草稿写入；D4 完成后只狭窄放行长期风险 GET-only API、只读 service 和页面同源展示；D5 完成后要求 Package D 主状态和 `feature-traceability` 收口证据同时存在，并继续阻止 Package E 生产部署动作混入 Package D。

## Package E 专项验证

确认前只允许做文档、compose config 和护栏准备：

- `docker compose config`
- `docker compose --env-file .env.example -f docker-compose.prod.yml config`
- `pnpm package-e:preflight`
- `pnpm attachment:reconciliation:summary:selftest`
- `pnpm release:evidence:validate <release-record.md|txt> <attachment-reconciliation.csv> <attachment-reconciliation-summary.json>`
- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

注意：裸跑 `docker compose -f docker-compose.prod.yml config` 若没有生产 env，预期会因 `AUTH_SESSION_SECRET is required` 等 required production env 缺失而失败；确认前用 `.env.example` 的占位值验证 compose 结构，不代表生产密钥已准备。

用户明确确认 Package E 后，才允许生产部署、生产 migration deploy、真实备份恢复演练或服务器命令。完成后至少保留：

- 发布记录：git commit、release tag、`AREAFORGE_IMAGE`、镜像 digest、compose hash、Nginx 配置 hash、操作者和时间。
- 备份证据：PostgreSQL dump、上传目录归档、生产 `.env` 权限收紧备份、当前 compose/Nginx 配置副本。
- 恢复演练：临时库导入、临时上传目录恢复、登录、首页、任务、计时、复盘、附件 metadata/hash 对账。
- 发布后烟测：`GET /api/health`、登录、首页、任务、计时、复盘、`/syllabus`、`/notes`、`/analytics`、`/reports`；附件和真实 AI 若启用，只用小测试文件和最小测试数据。
- 回滚记录：上一镜像 tag、是否恢复数据库/上传目录、恢复耗时、失败原因、残余风险和后续修复任务。
- 发布证据记录校验：`pnpm release:evidence:validate <release-record.md|txt> <attachment-reconciliation.csv> <attachment-reconciliation-summary.json>` 通过；该命令只读发布记录、CSV 和双向 summary。CSV `action` 必须全部为 `report_only`，summary 必须覆盖 `fileOnlyCount`、`unsafeEntryCount`、非法 URI、重复引用和 hash/size mismatch，并由发布记录中的 CSV SHA256、summary canonical hash、路径和状态绑定。
- 对账三态：`yes` 要求至少一条附件且全匹配；`no` 要求 summary=`mismatch`；`not-applicable` 要求仅表头 CSV、`databaseRecordCount=0`、`uploadFileCount=0`。任何状态都不能省略 CSV 或 summary。
- 安全边界：报告必须写在 `UPLOAD_DIR` 外，不跟随输出 symlink，附件读取使用 `O_NOFOLLOW`；只保存孤儿/unsafe 文件名 SHA256，不删除、不移动、不修复 metadata。对账应运行在静止恢复副本或快照上，不证明并发写入不存在。
- 发布证据硬门禁：发布记录必须包含 `migrationRunner`、`envBackupSha256`、compose/Nginx 副本路径、回滚计划、回滚演练结果、恢复耗时、是否需要数据库/上传目录恢复和失败原因；`migrationApplied=yes` 时 `migrationRunner` 只能是 `controlled_release_workdir` 或 `one_off_migration_job`，`migrationApplied=no` 时只能是 `not-applicable`。

推荐批次验证：

| 批次 | 验证重点 |
|---|---|
| Batch E1 生产配置与发布工件预检 | 已完成：`pnpm check`、`pnpm package-e:preflight`、compose config、生产 env 清单、镜像 tag、Nginx 配置、migration deploy 执行载体草案、发布记录草案和中止条件；不执行生产部署、不运行生产 migration、不触碰生产数据库或上传目录 |
| Batch E2 发布前备份与恢复演练 | 已完成：PostgreSQL dump、上传目录归档、生产 `.env` 本地替代备份权限收紧、compose/Nginx 副本、临时库导入、临时上传目录恢复、附件 metadata/hash 对账只读 `report_only`；记录见 `docs/development/package-e-e2-restore-drill-record.md`，当前无附件记录所以 `attachmentHashMatched=not-applicable` |
| Batch E3 生产发布与 migration deploy | 已完成本机单机生产目标发布：备份点、生产 env 私有备份、一次性 migration job、10 条 migration deploy、compose 启动、`GET /api/health`、登录、首页、任务、计时、复盘、附件和 AI fallback/provider 烟测，记录见 `docs/development/package-e-e3-prod-local-release-record.md`；本地 production-mode 演练记录仍保留在 `docs/development/package-e-e3-local-release-record.md`；E3 本机批次不单独代表远端切换，远端域名 HTTPS / Nginx / GHCR Release 先由 `v0.1.5` 历史记录补齐，当前生产状态由 `v0.1.7` 发布记录补齐 |
| Batch E4 回滚演练与 Package E 收口 | 已完成本机生产目标回滚收口：上一镜像 tag、回滚步骤、回滚后 health/登录/页面/API smoke、任务/计时/复盘、附件 `report_only` 对账、是否恢复数据库/上传目录、失败原因、恢复耗时、roll-forward 和 `pnpm release:evidence:validate`，记录见 `docs/development/package-e-e4-prod-local-rollback-record.md`；早期本地机制演练记录保留在 `docs/development/package-e-e4-local-rollback-record.md` |

注意：Package E 已按本机单机生产目标完成，并已补充真实远端 `https://forge.areasong.top/` 的 GitHub Release `v0.1.5` 历史签名更新证据和当前 `v0.1.7` 生产更新证据。当前远端 AreaForge 运行在服务器 `127.0.0.1:3020`，`127.0.0.1:3000` 在该服务器上属于 Grafana；后续域名、Nginx、端口或服务器迁移仍需另列外部部署验收。

`pnpm package-e:preflight`、`pnpm risk:preflight` 和 `pnpm docs:completion` 均采用 Package E 批次感知门禁：历史 E1-E4 收口时，Package E 主状态必须在所有批次证据齐全后才能标为完成；后续发布仍必须包含明确确认、`pnpm` 验证、烟测/备份/恢复/发布/回滚证据、文档同步和残余风险。Package E 最终完成行还必须包含发布、备份、恢复、回滚、`release:evidence:validate`、`report_only`、migration deploy 执行载体、镜像 digest 和 Nginx 证据。根 `package.json` 不允许新增生产 deploy、backup、restore、`docker compose up/down` 或服务器命令脚本；现有 `db:migrate:deploy` 只能作为高风险确认后的受控执行参考。

## GitHub Release 自动更新专项验证

服务器侧 GitHub Release updater 改动至少运行：

- `pnpm audit:prod`
- `pnpm github-release-updater:preflight`
- `pnpm shellcheck:updater`
- `pnpm check`
- 如改动 Dockerfile：`docker build -f infra/docker/migration.Dockerfile .`

CI/Release workflow 还必须通过 `pnpm governance:preflight` 的 GitHub Actions pinning 检查：所有外部 `uses:` 应 pin 到 40 位 commit SHA，并保留行内版本注释以便升级审查。

验证重点：

- Release manifest 必须包含 `webImageDigest`、`migrationImageDigest`、`sbomAsset`、`provenanceAsset`、`SHA256SUMS`、`SHA256SUMS.sig` 和 `autoApply` 策略；`SHA256SUMS` 必须覆盖 manifest、SBOM、provenance 和 compose。
- updater 必须校验签名/hash、拒绝 `latest`、使用锁、发布前备份、一次性 migration image、健康 smoke 和应用镜像回滚。
- updater 日志不得打印数据库 URL、生产 `.env` 内容、密码、AI key、完整 prompt、附件内容或上传绝对路径。
- Web runtime 不得新增 updater route、Docker/backup/restore/migration 命令入口或 `docker.sock` 访问。
- `AREAFORGE_AUTO_APPLY=none` 是默认策略；patch 自动应用必须同时满足服务器配置和 manifest `autoApply.patch=true`。

当前远端 `v0.1.7` 已验证：Release asset 包含 `areaforge-release-manifest.json`、`areaforge-sbom.spdx.json`、`areaforge-provenance.json`、`docker-compose.prod.yml`、`SHA256SUMS` 和 `SHA256SUMS.sig`；服务器侧 updater 签名校验通过，Web image digest 为 `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd`；migration image digest 为 `ghcr.io/areasong/areaforge-migration:v0.1.7@sha256:c2c27da7ed85be0796d4f6535557d3759bc14975a0238b725b99c1c0e232e654`；`GET https://forge.areasong.top/api/health` 返回 `0.1.7`；服务器 updater 记录 `smokeHealth=PASS`、`extraSmoke=PASS`、`rollbackAttempted=no`。`v0.1.5` 远端签名发布记录仍作为历史基线保留；`AF-RISK-SC-001` 和 `AF-RISK-OPS-001` 台账关闭仍需维护者人工复核和 post-update redacted 证据。

## docs 100% 最终门禁

- `pnpm docs:readiness` 只证明治理结构、入口和追踪关系存在。
- `pnpm risk:preflight` 只证明 Package A-E 的护栏存在，不执行上传、后续 migration、AI 外呼、部署或备份恢复；其中 Package B 检查 Batch 0-6 字段/模型和运行时证据已存在，并继续确认没有越过已确认范围；Package C 完成后检查真实 provider、Web 服务端 env 和显式 route 触发证据已存在，同时继续检查客户端密钥禁区、AI 上下文最小化、首页普通 SSR 成本边界和 prompt/raw response 持久化禁区；Package D 还检查只读重排 API、D1 报告决策证据门禁、D2-D5 批次解锁门禁、报告/任务应用禁区、Batch 6 阶段草稿确认边界、confirm-only DTO、UI 标签和文档边界；Package E 还检查 E1-E4 批次 ledger、root scripts 运维禁区、Web ops route 禁区和生产发布 runbook 边界。
- `pnpm docs:completion` 用于最终完成验收；在 `feature-traceability` 仍有“基础版 / 待确认 / 未实现”、Package A-E 完成行缺少验证/烟测/文档同步/残余风险证据、Package B Batch 0-6 / Package D D1-D5 / Package E E1-E4 未全部完成，或缺少高风险完成记录时，预期应失败。
- 日常文档同步不要求 `pnpm docs:completion` 通过；声称 AreaForge docs 100% 完成前必须通过。

## 风险升级

以下情况必须扩大验证：

- 改动跨 `apps/web`、`packages/db`、`prisma`。
- 改动认证、会话、上传、AI、备份、部署。
- 改动会影响已有数据。
- 文档和代码出现不一致。
- 上一次验证失败或被阻塞。

## 验证报告格式

```text
改动范围:
- <scope>

改了什么:
- <summary>

为什么这样改:
- <reason>

已运行:
- <command>: <result>

未运行:
- <command>: <reason>

证据新鲜度:
- 本次运行 / CI 运行 / 历史 release 记录 / 未提供

阻断状态:
- 工程质量:
- 安全/隐私:
- 依赖/供应链:
- CI/release:
- Git checkpoint:

结果:
- PASS / FAIL / BLOCKED / NOT-READY

残余风险:
- <residual-risk-ids-or-none>
```

## 当前已知验证阻塞

仓库使用 pnpm 11.7.0，并通过 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 与 `allowBuilds` 允许 Prisma、Sharp 和相关解析依赖执行必要 build script。若当前机器仍提示 ignored builds，按 `docs/development/setup.md` 执行 `pnpm approve-builds --all` 后再跑 `pnpm check`。
