# Maintenance Cadence

## 目标

本文件定义 AreaForge 长期运营的维护节奏：每天、每周、每月、每次 release、incident 后应检查哪些只读信号，哪些证据可以用于交接，哪些 residual risk 到期必须复核。

它不是自动运维授权，不执行生产 deploy、backup、restore、migration、updater apply、rollback、server command 或生产写入。Readiness、support bundle preview、alert preview、evidence bundle、long-term evidence snapshot 和 preflight 只能解释当前证据，不等于 apply，也不能单独关闭 residual risk。

## 维护原则

- 证据优先：所有健康、发布、回滚和企业级就绪结论都要有时间戳、来源、命令或记录。
- 只读优先：日常维护默认只运行 read-only preflight、support bundle preview、readiness summary、evidence bundle、long-term evidence snapshot、alert preview 和 redacted record validator。
- 残余风险可见：缺失证据必须落到 `AF-RISK-*`，不要散落在自然语言里。
- 到期复核：每个 residual 的 `reviewAt` 到期后，要更新影响、关闭条件、所需证据或风险接受理由。
- 不把预览或快照当执行：`ops:support:bundle-preview` 不导出支持包，`ops:alert:preview` 不发送通知，`ops:evidence:bundle` 不证明缺失信号健康，`ops:long-term:snapshot` 不证明 live gate 通过或 residual 已关闭，`release:train:preflight` 不创建 Release。
- 不把本地当生产：本地 smoke、CI、dry-run 和历史记录不能替代远端生产证据。
- 新鲜度降级：维护窗口记录会写入 `evidenceFreshnessStatus`、`evidenceFreshnessMaxAgeSeconds` 和 `latestEvidenceCheckedAt`；证据为 `stale` 或 `unknown` 时，`result` 不能是 `pass`。
- 历史索引可重建：`pnpm maintenance:window:index` 每次完整扫描已验证的维护窗口记录并向 stdout 输出确定性 JSON；保存的 `maintenance-window-index.json` 只是可重建投影，不是新的源事实，不包含执行队列、恢复点或写入能力。任一记录损坏、hash 漂移、符号链接或重复 `windowId` 都会 fail closed，不输出部分索引。

## 当前已执行窗口

- `2026-07-13` 周维护窗口：记录与 redacted 输入见 [`maintenance-window-20260713-weekly-production/`](maintenance-window-20260713-weekly-production/maintenance-window.txt)，确定性历史投影见 [`maintenance-window-index.json`](maintenance-window-index.json)。公网 health、TLS 和 Release identity 可验证；update-agent、authenticated smoke 和 backup freshness 仍缺当前证据，因此记录结果为 `warn`，并继续保留 `AF-RISK-OPS-001`、`AF-RISK-OPS-004`、`AF-RISK-UX-001`。该记录证明维护节奏已实际运行一次，不证明生产完整健康、备份/恢复执行、updater apply 或 residual 关闭。

## 每日检查

日常目标是发现线上明显退化和证据过期，不做写入。

建议项：

- Public health：`GET /api/health` 或 `pnpm ops:readiness:summary`。
- Authenticated read-only smoke：确认是否有 24 小时内通过记录；没有时保留 `AF-RISK-OPS-001`。
- Update-agent：确认 blocker、timer、signature required、current/latest version 和 auto apply policy。
- Backup freshness：确认数据库、uploads、env/config 备份 hash 新鲜；缺失时 release/update/migration/rollback 进入 blocked。
- Disk/certificate：确认磁盘容量和 TLS 证书剩余天数；`pnpm ops:readiness:summary` 会对 HTTPS base URL 自动采集证书到期时间，磁盘仍需服务器侧或 redacted 证据。
- Alert preview：`pnpm ops:alert:preview`，记录 wouldNotify、owner 和 recommendedAction；它不替代真实告警。

推荐命令：

```bash
pnpm enterprise:operability:preflight
pnpm ops:handoff
pnpm ops:handoff:validate <operational-handoff.json>
pnpm ops:handoff --summary
pnpm ops:status
pnpm ops:status:validate <operability-status.json>
pnpm ops:status --summary
pnpm ops:long-term:gate
pnpm residuals:evidence:preflight
pnpm residuals:closure:validate <residual-closure-review-record.md|txt>
pnpm ops:support:bundle-preview
pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>
pnpm ops:backup-restore:preview
pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>
pnpm ops:readiness:summary
pnpm ops:evidence:bundle
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
pnpm ops:long-term:snapshot
pnpm ops:long-term:snapshot:validate <long-term-evidence-snapshot.json>
DATABASE_URL=<read-only-url> pnpm ops:data-integrity:doctor -- --attachment-summary <attachment-reconciliation-summary.json>
pnpm ops:data-integrity:validate <data-integrity-doctor.json>
pnpm maintenance:window:record
pnpm maintenance:window:validate <maintenance-window-record.md|txt>
pnpm maintenance:window:index
pnpm maintenance:window:index:validate docs/development/maintenance-window-index.json
pnpm ops:ops-001:preflight
pnpm ops:ops-001:closure:validate <ops-001-closure-packet.txt>
pnpm ops:alert:preview
pnpm ops:ops-004:preflight
pnpm ops:ops-005:preflight
pnpm ops:ops-005:evidence:validate <ops-005-production-evidence-record>
pnpm release:closeout:audit -- --version <X.Y.Z>
pnpm release:closeout:audit:validate <release-closeout-audit.json>
```

## 每周检查

每周目标是确认公共项目和运营证据没有漂移。

建议项：

- `pnpm maintenance:cadence:preflight`
- `pnpm ops:handoff:validate:selftest`
- `pnpm ops:status:validate:selftest`
- `pnpm ops:handoff --summary`
- `pnpm ops:status --summary`
- `pnpm enterprise:operability:preflight`
- `pnpm support:intake:preflight`
- `pnpm ops:support:bundle-preview:selftest`
- `pnpm operator:onboarding:preflight`
- `pnpm release:train:preflight`
- `pnpm governance:preflight`
- `pnpm ops:readiness`
- `pnpm residuals:validate`
- `pnpm residuals:evidence:preflight:selftest`
- `pnpm residuals:evidence:preflight`
- `pnpm residuals:closure:selftest`
- `pnpm residuals:review-due`
- `pnpm docs:readiness`
- `pnpm audit:prod`
- `pnpm shellcheck:updater`
- `AREAFORGE_SC002_RELEASE_RECORD=docs/development/release-supply-chain-v0.1.7.md pnpm sc:sc-002:preflight`
- 如需留存交接记录，先保存 `pnpm residuals:review-due`、`pnpm ops:readiness:summary`、`pnpm ops:evidence:bundle`、`pnpm ops:long-term:snapshot` 和 `pnpm ops:alert:preview` 的 redacted 输出，可用 `pnpm maintenance:window:record` 生成草稿，再运行 `pnpm maintenance:window:validate <record>`。生成器会从 readiness/evidence bundle/alert preview 推导 freshness；缺失或过期证据会把维护窗口结果保持在 `warn`、`fail` 或 `blocked`，不能作为 `pass` 交接。
- 新增维护窗口记录后，用 `pnpm maintenance:window:index > docs/development/maintenance-window-index.json` 完整重建索引，再运行 `pnpm maintenance:window:index:validate docs/development/maintenance-window-index.json`；索引 validator 会重新扫描全部源记录，不能用旧索引掩盖新增、损坏或漂移记录。

每周还应复核：

- GitHub issues 是否有 P0/P1、安全、ops support 或 release/supply-chain 阻塞。
- 公开 issue 和贡献者 PR 是否已按 `areaforge-public-maintenance` 路由到 support、security、SRE、release、supply-chain、AI、UX 或 docs owner。
- Dependabot/依赖更新是否需要进入 dependency policy。
- `pnpm residuals:review-due` 是否显示存在到期或即将到期的 `reviewAt`。
- `pnpm residuals:evidence:preflight` 是否仍只做 metadata-only 路径预检，并把命令、人工确认、GitHub run、后续版本证据等归类为 `nonPathRequirements`；该命令输出 `ready_for_human_review` 也不代表 residual 关闭。
- `pnpm ops:handoff --summary` 是否仍把可立即执行项、release follow-up 和不可声称的生产健康边界说清楚；需要机器可校验输出时继续使用不带 `--summary` 的 JSON。
- 保存的 handoff 是否通过默认 `pnpm ops:handoff:validate <handoff.json>` 并返回 `bindingStatus: current`；历史 `--shape-only` 结果不得进入当前维护窗口交接。
- `pnpm ops:long-term:gate` 是否仍能明确阻止缺 OPS-001、OPS-004、OPS-005、fresh data-integrity doctor、可校验 Release 发布记录、签名 Release 供应链或新鲜 UX 证据的长期运营完成声明；doctor 必须 `overall=pass`、真实执行数据库只读聚合并包含通过的附件 reconciliation。当前 `AF-RISK-OPS-006` 的数据库唯一约束和 CAS 尚未实施，因此即使本地 doctor selftest 通过也不能关闭该 blocker。
- `pnpm ops:long-term:snapshot` 是否能把当前 release evidence、供应链、UX、alert、operational bundle、OPS-001/004/005 和 fresh data-integrity doctor 绑定为 schema v3 快照，并通过默认 current-binding validator；v1/v2 仅能用 `--shape-only` 校验历史非 ready 形态，不能升级为 ready。缺 doctor 时必须显式列出 `dataIntegrity` 和 `AF-RISK-OPS-006`，该快照通过也不代表并发根因修复、生产健康或 residual 关闭。
- `pnpm ops:backup-restore:preview` 是否仍能把 release record 中的 `releaseEvidenceBundleHash`、root-only backup hash、可选恢复演练记录和 rollback target 分类为可交接 metadata，并通过 `blockingGaps` 机器可读列出会阻塞 release evidence、long-term gate、restore drill 或 rollback readiness 的缺口；该预览通过不代表备份归档存在、恢复已执行或生产 restore 已授权。
- `AF-RISK-OPS-001`、`AF-RISK-SC-001` 这类可在下一次 release/update 后进入人工复核的证据是否已有新记录；OPS-001 需要生产只读 smoke、update-agent status、evidence bundle 和 `pnpm ops:ops-001:closure:validate` 通过后再人工复核关闭；SC-001 先带当前 release 供应链记录路径跑 `pnpm sc:sc-002:preflight`，再用签名 Release `pnpm release:supply-chain:validate` 复核。`AF-RISK-SC-002` 已关闭为 CI-only 证据项，后续相关 workflow、依赖或 release 变更前重跑对应复核。
- 若维护者形成 close / keep-open / downgrade / reopen 结论，是否保存 `docs/development/residual-closure-review-template.md` 格式记录并运行 `pnpm residuals:closure:validate <record>`；该记录保持 `closesResidual=no`，不能替代后续台账更新和 `pnpm residuals:validate`。
- 生成 OPS-001 收口包前先运行 `pnpm ops:ops-001:preflight`；它只读本地 redacted 证据文件并返回 `needs_evidence`、`ready_to_generate_packet`、`ready_for_human_close` 或 `invalid`，不执行生产 smoke、不生成收口包、不改 residual 台账。
- 关闭 `AF-RISK-OPS-004` 前先运行 `pnpm ops:ops-004:preflight`；它只读已保存的 alert preview 和告警演练记录，校验两者 hash 对齐并返回 `needs_evidence`、`ready_to_generate_record`、`ready_for_human_close` 或 `invalid`，不发送通知、不调用外部接收人、不改 residual 台账。
- 复核 `AF-RISK-OPS-005` 前先运行 `pnpm ops:ops-005:local:selftest` 和 `pnpm ops:ops-005:preflight`；当前本地实现通过后应推进到 `needs_signed_release`。只有匹配签名 Release 和通过 `pnpm ops:ops-005:evidence:validate` 的生产证据齐备后，才允许进入 `ready_for_ops005_human_review`，仍不自动关闭 residual。
- 复核 `AF-RISK-OPS-006` 前先生成并校验 fresh data-integrity doctor；doctor 只负责发现，业务写路径修复仍必须按 `tasks/active/0020-business-state-concurrency.md` 独立确认。
- `AF-RISK-UX-001` 是否仍有 14 天内 desktop/mobile 体验复核记录；当前 2026-07-10 本地记录是历史证据，2026-07-12 本地 `0.1.7` 记录已补充，过期、release/update 或体验改动后必须重跑，否则体验健康重新降级为 `warn`。

## 每月或每个维护窗口

每月目标是证明备份、恢复、告警和自托管路径仍可交接。

建议项：

- 抽查备份库存：数据库 dump、uploads archive、env/config、compose、Nginx 副本及 hash。
- 保存 `pnpm ops:backup-restore:preview` 的 redacted 输出，确认 release record、`releaseEvidenceBundleHash`、root-only backup hash、恢复演练记录和 rollback target 的缺口已通过 `blockingGaps` 显式列出。
- 在非生产或临时环境演练恢复；附件对账必须保持 `report_only`。
- 验证 `docs/deployment/operator-onboarding.md` 是否仍能指导新操作者。
- 复核 `docs/development/support-intake.md` 和 issue 模板是否仍能阻止公开敏感信息。
- 完成一次 desktop/mobile 产品体验复核，或记录为什么本维护窗口沿用/重新打开 `AF-RISK-UX-001`。
- 若有告警接收人或人工值班窗口，完成一次告警/恢复演练并运行 `pnpm alert:drill:validate <record>`；关闭 OPS-004 前再用 `pnpm ops:ops-004:preflight` 核对 alert preview 和演练记录是否匹配。
- 完成一次非生产或临时环境恢复演练记录，并运行 `pnpm restore:drill:validate <record>`；该记录不授权生产 restore。
- 在静止恢复副本上运行 `pnpm attachment:reconciliation -- <UPLOAD_DIR> <csv> --summary-output <summary>`，确认 DB-only、file-only、hash/size mismatch、非法 URI、重复引用和 unsafe entry 均被报告；补跑 `pnpm attachment:reconciliation:summary:selftest`。不得在该步骤清理孤儿、移动文件或修复 metadata。

月度检查不自动执行生产 restore，不删除备份，不移动上传目录，不修复 metadata。

## 每次 Release

Release 前后按 `docs/development/release-train.md` 执行。

额外确认：

- tag、package version、GitHub Release、manifest、SBOM、provenance、`SHA256SUMS` 和 signature 一致。
- Web/migration image 使用不可变 digest。
- 生产更新完成后有 health、update-agent、authenticated smoke 或明确 `AF-RISK-OPS-001`。
- release record 写入 `pnpm ops:evidence:bundle` 的 `bundleHash` 和 `pnpm ops:alert:preview` 的告警预览结论。
- release record 同时绑定附件 reconciliation CSV/summary 的路径、status、CSV SHA256 和 summary canonical hash；`yes`、`no`、`not-applicable` 都必须有对应双向证据。
- release/update 后保存 `pnpm ops:long-term:snapshot` 输出，确认 OPS-001、OPS-004、OPS-005、fresh data-integrity doctor、release evidence record、供应链、UX 和运行信号的当前状态与缺口被 hash 绑定，并确认 validator 输出 `bindingStatus: current`；若要声明长期运营完成，仍必须让 live gate 通过。
- release/update 后运行版本级 `pnpm release:closeout:audit -- --version <X.Y.Z>`，确认 Release record、供应链 record、operational evidence bundle、rollback target 和 residual ID/type 一致；audit 的 `blocked` 或 `needs_attention` 必须保留，不能通过改写历史证据绕过。
- `AF-RISK-SC-002` 已关闭为 CI-only 证据项；若后续 workflow、依赖审计、release workflow 或供应链记录工具变更，使用 `pnpm sc:sc-002:preflight` 和 `pnpm ci:supply-chain:validate` 通过的 CI-only 记录重新复核。若要关闭 `AF-RISK-SC-001`，必须有 `pnpm sc:sc-002:preflight` 和 `pnpm release:supply-chain:validate` 通过的签名 Release 记录。
- 若要声明本次 release/update 后真实体验健康，必须有 `pnpm experience:review:validate` 通过的 desktop/mobile 体验记录；否则保留 `AF-RISK-UX-001`。
- 若要声明产品进入长期运营完成状态，必须运行 `pnpm ops:long-term:gate` 并通过；该 gate 不自动关闭 residual，只证明证据达到可人工复核门槛。

## Incident 后

Incident 后目标是保留证据、恢复服务、避免同类问题重复。

步骤：

1. 冻结 redacted evidence：health、update-agent、logs、release identity、backup freshness、smoke、alert preview。
2. 判断是否需要 rollback、roll-forward、restore 或 hold；生产写动作必须重新确认。
3. 恢复后记录 post-incident readiness summary 和 evidence bundle。
4. 按 `docs/development/incident-record-template.md` 填写 redacted incident record，并运行 `pnpm incident:record:validate <record>`。
5. 只有 `status=resolved` 且 `postIncidentReview=yes` 的记录才进入 `incident-*/incident-record.txt` 历史集合；完整重建 `pnpm incident:index` 并运行 `pnpm incident:index:validate docs/development/incident-index.json`。该索引只用于历史浏览和完整性检查，不表示当前没有 active incident。
6. 若实际执行 rollback，按 `docs/development/rollback-proof-record-template.md` 保存回滚后证明并运行 `pnpm rollback:proof:validate <record>`；信号不足时保持 `keep-closed`，不得自动重新开放更新通道。
7. 若形成后续风险，写入 residual ledger 或对应任务，不只留在聊天记录。
8. 若涉及安全，转 `SECURITY.md` 私密路径。

## Residual Review

复核 residual 时，遵循：

- 不从意图、旧验证或“没有搜索到问题”关闭 residual。
- `closed-evidence` 仍保留复核触发条件，例如依赖升级前重跑 `pnpm pg:trace-deprecation`。
- `accepted-exception` 必须保留范围、理由、reviewAt 和重新打开条件。
- `deferred-work` 必须说明 revisit trigger。
- `monitoring-gap` 必须说明缺失证据会让哪些结论降级。

当前必须带入维护节奏的 residual IDs：

- `AF-RISK-OPS-001`
- `AF-RISK-OPS-002`
- `AF-RISK-REL-001`
- `AF-RISK-SC-001`
- `AF-RISK-SC-002`
- `AF-RISK-SC-003`
- `AF-RISK-OPS-003`
- `AF-RISK-OPS-004`
- `AF-RISK-OPS-005`
- `AF-RISK-OPS-006`
- `AF-RISK-OPS-007`
- `AF-RISK-OPS-008`
- `AF-RISK-UX-001`

## 本地预检

修改维护节奏、ops readiness、observability、residual ledger、alert/smoke 记录、support intake 或 release train 入口后，运行：

```bash
pnpm maintenance:cadence:preflight
pnpm enterprise:operability:preflight
```

该预检只检查文档、package scripts、residual reviewAt、入口链接和 skill 引用；它不连接生产、不读取密钥、不执行 Docker、不备份、不恢复、不运行 migration、不创建 Release、不写生产。

需要单独检查 residual 到期状态时运行：

```bash
pnpm residuals:review-due
```

该命令只读取 `docs/development/residual-risk-ledger.json` 并输出 `overdue`、`due_today`、`due_soon` 和 `future` 计数；默认不失败、不改台账。维护窗口若需要硬门禁，可追加 `--fail-on-overdue`、`--fail-on-due` 或 `--fail-on-due-soon`。
