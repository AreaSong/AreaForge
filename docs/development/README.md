# development 目录索引

`docs/development/` 混合了四类性质不同的文件。本索引用分组代替物理搬迁：文件留在原位（大量脚本与历史记录按路径和 SHA256 绑定它们），读者按分组判断"这是机制还是历史"。

分层规则见 [文档同步清单](doc-sync-checklist.md) 的"文档分层规则"一节。

## 机制与门禁（长期滚动，随代码演进更新）

开发协作：

- `setup.md`：本地开发准备。
- `testing.md`：验证策略。
- `implementation-order.md`：实现顺序。
- `pre-code-closure.md`：开发前闭环清单。
- `codex-workflow.md`：轻量 Codex 协作工作流。
- `doc-sync-checklist.md`：文档同步、漂移检查与文档分层规则。
- `validation-matrix.md`：按改动范围选择验证。
- `gotchas.md`：可复用坑点库（触发/根因/规避/关联；开工前扫读、收尾时按录入门槛追加）。

治理与边界：

- `dependency-policy.md`：依赖与供应链治理策略。
- `external-capability-admission.md`：外部能力准入边界。
- `governance-boundary-matrix.md`：目录责任与审阅分级。
- `governance-register.md` / `governance-register.json`：治理权威路径中央索引。
- `runtime-write-boundary.md`：R0-R4 运行时写动作边界矩阵。
- `high-risk-confirmation-packets.md`：高风险执行确认包。
- `completion-evidence-checklist.md`：完成声明证据清单。
- `release-evidence-closeout-contract.md`：发布证据收口契约。

发布与运维机制：

- `long-term-operability-control-plane.md`：长期运营控制面总入口。
- `operations-lifecycle.md` / `operations-lifecycle.json`：SLO 与 lifecycle 只读契约。
- `release-train.md`：功能进入线上的固定发布路径。
- `production-release-runbook.md`：生产发布、备份与恢复 runbook。
- `production-smoke-alerting-strategy.md`：生产 smoke 与告警策略。
- `maintenance-cadence.md`：只读维护节奏。
- `data-integrity-doctor.md`：只读数据完整性 doctor 说明。
- `support-intake.md`：公开支持 triage 规则。
- `support-bundle-preview.md`：metadata-only 支持包预览说明。
- `error-recovery-matrix.md` / `error-recovery-matrix.json`：关键旅程错误恢复矩阵。

## 状态入口（易变，唯一允许写"当前状态"的台账）

- `operational-readiness.md`：长期运营 readiness 与信号新鲜度。
- `feature-traceability.md`：功能到实现、任务和版本的追踪矩阵（含批次证据）。
- `feature-map.md`：全项目四态功能图（done/partial/planned/wont 的视图型状态入口；冲突时以 feature-traceability 与 residual 台账为准，配套 Cursor Canvas 投影）。
- `residual-risk-ledger.md` / `residual-risk-ledger.json`：残余风险台账。
- `docs-100-completion-record.md`：docs 100% 完成证据台账。
- `maintenance-window-index.json` / `incident-index.json`：由已验证记录确定性重建的只读投影。

## 模板（新记录一律从这里复制）

- `release-record-template.md`：Release 证据记录。
- `release-supply-chain-record-template.md`：签名 Release 供应链记录。
- `ci-supply-chain-record-template.md`：CI-only 供应链记录。
- `production-readonly-smoke-record-template.md`：生产只读 smoke 记录。
- `alert-drill-record-template.md`：告警/恢复演练记录。
- `incident-record-template.md`：事故记录。
- `restore-drill-record-template.md`：恢复演练记录。
- `rollback-proof-record-template.md`：回滚后证明记录。
- `maintenance-window-record-template.md`：维护窗口记录。
- `update-agent-status-record-template.md`：redacted update-agent 状态记录。
- `ops-001-closure-packet-template.md`：OPS-001 收口包。
- `ops-005-expected-before-production-evidence-template.md`：OPS-005 生产证据。
- `ops-006-production-evidence-template.md`：OPS-006 生产证据。
- `post-release-observation-template.json`：Release 后 D14/D30 观察记录。
- `product-experience-review-record-template.md`：真实体验复核记录。
- `protected-path-review-record-template.md`：受保护路径审阅记录。
- `residual-closure-review-template.md`：residual 人工复核记录。
- `github-main-protection-record-template.md`：main 分支保护记录。

## 确认设计（确认冻结后只作历史参考，不再滚动更新）

- `structured-state-migration-design.md`：结构化学习状态 migration。
- `attachment-upload-access-design.md`：附件上传与鉴权访问。
- `ai-provider-integration-design.md`：真实 AI provider 接入。
- `second-stage-long-term-loop-design.md`：第二阶段长期闭环。
- `github-release-updater-design.md`：GitHub Release 自动更新器。
- `update-request-expected-before-design.md`：版本中心 expected-before 请求契约。
- `ops-006-business-state-concurrency-design.md`：业务并发一致性。
- `ops-007-attachment-crash-window-design.md`：附件崩溃窗口。
- `ops-008-updater-phase-journal-design.md`：updater phase journal。

## 历史记录与证据（不可变历史，不代表当前状态）

以下文件是特定时间点、特定版本的证据，很多被其他记录以 `{path, sha256}` 绑定：不改写、不搬迁、不更新内容；判断当前状态一律看上面的"状态入口"。

发布与供应链记录：

- `release-v0.1.7-record.md`、`release-supply-chain-v0.1.7.md`
- `package-e-e1-release-record-draft.md`、`package-e-e2-restore-drill-record.md`、`package-e-e3-local-release-record.md`、`package-e-e3-prod-local-release-record.md`、`package-e-e4-local-rollback-record.md`、`package-e-e4-prod-local-rollback-record.md`、`package-e-remote-github-release-record.md`
- `ci-supply-chain-20260711-7a8edca.txt`、`ci-supply-chain-20260711-b9bbfa2.txt`、`ci-supply-chain-20260711-f18f159.txt`
- `docs-100-acceptance-evidence.md`

运营与观察证据：

- `long-term-evidence-snapshot-v0.1.7-20260712.json`、`long-term-operability-not-ready-20260711.txt`
- `operational-evidence-bundle-v0.1.7-20260712.json`、`post-release-observation-v0.1.7.json`
- `ops-001-blocked-record-20260711.txt`、`ops-001-production-readonly-attempt-20260711.md`、`ops-001-production-readonly-20260711/`
- `ops-004-alert-preview-20260711.json`、`ops-004-alert-drill-20260711-manual-window.txt`、`ops-004-alert-preview-v0.1.7-20260712.json`、`ops-004-alert-drill-v0.1.7-20260712-manual-window.txt`
- `maintenance-window-20260713-weekly-production/`

复核记录：

- `product-experience-review-20260710-local.md`、`product-experience-review-v0.1.7-20260712-local.md`、`product-experience-review-20260715.md`、`product-experience-review-20260716.md`、`product-experience-review-20260716-ops-control-plane.md`、`product-experience-review-20260718-5bec626.md`、`product-experience-review-20260720-ltops.md`
- `residual-closure-review-20260716.md`、`residual-closure-review-20260720-ops-001.md`、`residual-closure-review-20260720-ops-005.md`、`residual-closure-review-20260720-sc-004.md`、`residual-closure-review-20260720-ops-006.md`

新增记录进入本目录时：从模板复制、跑对应 validator，然后把文件名补进本索引的对应分组。
