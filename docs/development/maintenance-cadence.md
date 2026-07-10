# Maintenance Cadence

## 目标

本文件定义 AreaForge 长期运营的维护节奏：每天、每周、每月、每次 release、incident 后应检查哪些只读信号，哪些证据可以用于交接，哪些 residual risk 到期必须复核。

它不是自动运维授权，不执行生产 deploy、backup、restore、migration、updater apply、rollback、server command 或生产写入。Readiness、support bundle preview、alert preview、evidence bundle 和 preflight 只能解释当前证据，不等于 apply，也不能单独关闭 residual risk。

## 维护原则

- 证据优先：所有健康、发布、回滚和企业级就绪结论都要有时间戳、来源、命令或记录。
- 只读优先：日常维护默认只运行 read-only preflight、support bundle preview、readiness summary、evidence bundle、alert preview 和 redacted record validator。
- 残余风险可见：缺失证据必须落到 `AF-RISK-*`，不要散落在自然语言里。
- 到期复核：每个 residual 的 `reviewAt` 到期后，要更新影响、关闭条件、所需证据或风险接受理由。
- 不把预览当执行：`ops:support:bundle-preview` 不导出支持包，`ops:alert:preview` 不发送通知，`ops:evidence:bundle` 不证明缺失信号健康，`release:train:preflight` 不创建 Release。
- 不把本地当生产：本地 smoke、CI、dry-run 和历史记录不能替代远端生产证据。

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
pnpm ops:status
pnpm ops:support:bundle-preview
pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>
pnpm ops:readiness:summary
pnpm ops:evidence:bundle
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
pnpm maintenance:window:record
pnpm maintenance:window:validate <maintenance-window-record.md|txt>
pnpm ops:ops-001:preflight
pnpm ops:ops-001:closure:validate <ops-001-closure-packet.txt>
pnpm ops:alert:preview
pnpm ops:ops-004:preflight
```

## 每周检查

每周目标是确认公共项目和运营证据没有漂移。

建议项：

- `pnpm maintenance:cadence:preflight`
- `pnpm ops:handoff`
- `pnpm ops:status`
- `pnpm enterprise:operability:preflight`
- `pnpm support:intake:preflight`
- `pnpm ops:support:bundle-preview:selftest`
- `pnpm operator:onboarding:preflight`
- `pnpm release:train:preflight`
- `pnpm governance:preflight`
- `pnpm ops:readiness`
- `pnpm residuals:validate`
- `pnpm residuals:review-due`
- `pnpm docs:readiness`
- `pnpm audit:prod`
- `pnpm shellcheck:updater`
- `pnpm sc:sc-002:preflight`
- 如需留存交接记录，先保存 `pnpm residuals:review-due`、`pnpm ops:readiness:summary`、`pnpm ops:evidence:bundle` 和 `pnpm ops:alert:preview` 的 redacted 输出，可用 `pnpm maintenance:window:record` 生成草稿，再运行 `pnpm maintenance:window:validate <record>`。

每周还应复核：

- GitHub issues 是否有 P0/P1、安全、ops support 或 release/supply-chain 阻塞。
- 公开 issue 和贡献者 PR 是否已按 `areaforge-public-maintenance` 路由到 support、security、SRE、release、supply-chain、AI、UX 或 docs owner。
- Dependabot/依赖更新是否需要进入 dependency policy。
- `pnpm residuals:review-due` 是否显示存在到期或即将到期的 `reviewAt`。
- `pnpm ops:handoff` 是否仍把可立即执行项、release follow-up 和不可声称的生产健康边界说清楚。
- `AF-RISK-OPS-001`、`AF-RISK-SC-002` 这类可在下一次 release/update 后关闭的证据是否已有新记录；OPS-001 需要生产只读 smoke、update-agent status、evidence bundle 和 `pnpm ops:ops-001:closure:validate` 通过后再人工复核关闭；SC-002 先跑 `pnpm sc:sc-002:preflight`，再用 CI-only `pnpm ci:supply-chain:validate` 或签名 Release `pnpm release:supply-chain:validate` 复核。
- 生成 OPS-001 收口包前先运行 `pnpm ops:ops-001:preflight`；它只读本地 redacted 证据文件并返回 `needs_evidence`、`ready_to_generate_packet`、`ready_for_human_close` 或 `invalid`，不执行生产 smoke、不生成收口包、不改 residual 台账。
- 关闭 `AF-RISK-OPS-004` 前先运行 `pnpm ops:ops-004:preflight`；它只读已保存的 alert preview 和告警演练记录，校验两者 hash 对齐并返回 `needs_evidence`、`ready_to_generate_record`、`ready_for_human_close` 或 `invalid`，不发送通知、不调用外部接收人、不改 residual 台账。
- `AF-RISK-UX-001` 是否仍有 14 天内 desktop/mobile 体验复核记录；当前 2026-07-10 本地记录已关闭该项，过期、release/update 或体验改动后必须重跑，否则体验健康重新降级为 `warn`。

## 每月或每个维护窗口

每月目标是证明备份、恢复、告警和自托管路径仍可交接。

建议项：

- 抽查备份库存：数据库 dump、uploads archive、env/config、compose、Nginx 副本及 hash。
- 在非生产或临时环境演练恢复；附件对账必须保持 `report_only`。
- 验证 `docs/deployment/operator-onboarding.md` 是否仍能指导新操作者。
- 复核 `docs/development/support-intake.md` 和 issue 模板是否仍能阻止公开敏感信息。
- 完成一次 desktop/mobile 产品体验复核，或记录为什么本维护窗口沿用/重新打开 `AF-RISK-UX-001`。
- 若有告警接收人或人工值班窗口，完成一次告警/恢复演练并运行 `pnpm alert:drill:validate <record>`；关闭 OPS-004 前再用 `pnpm ops:ops-004:preflight` 核对 alert preview 和演练记录是否匹配。
- 完成一次非生产或临时环境恢复演练记录，并运行 `pnpm restore:drill:validate <record>`；该记录不授权生产 restore。

月度检查不自动执行生产 restore，不删除备份，不移动上传目录，不修复 metadata。

## 每次 Release

Release 前后按 `docs/development/release-train.md` 执行。

额外确认：

- tag、package version、GitHub Release、manifest、SBOM、provenance、`SHA256SUMS` 和 signature 一致。
- Web/migration image 使用不可变 digest。
- 生产更新完成后有 health、update-agent、authenticated smoke 或明确 `AF-RISK-OPS-001`。
- release record 写入 `pnpm ops:evidence:bundle` 的 `bundleHash` 和 `pnpm ops:alert:preview` 的告警预览结论。
- 若要关闭 `AF-RISK-SC-002`，可使用 `pnpm sc:sc-002:preflight` 和 `pnpm ci:supply-chain:validate` 通过的 CI-only 记录；若要同时关闭 `AF-RISK-SC-001`，必须有 `pnpm sc:sc-002:preflight` 和 `pnpm release:supply-chain:validate` 通过的签名 Release 记录。
- 若要声明本次 release/update 后真实体验健康，必须有 `pnpm experience:review:validate` 通过的 desktop/mobile 体验记录；否则保留 `AF-RISK-UX-001`。

## Incident 后

Incident 后目标是保留证据、恢复服务、避免同类问题重复。

步骤：

1. 冻结 redacted evidence：health、update-agent、logs、release identity、backup freshness、smoke、alert preview。
2. 判断是否需要 rollback、roll-forward、restore 或 hold；生产写动作必须重新确认。
3. 恢复后记录 post-incident readiness summary 和 evidence bundle。
4. 按 `docs/development/incident-record-template.md` 填写 redacted incident record，并运行 `pnpm incident:record:validate <record>`。
5. 若形成后续风险，写入 residual ledger 或对应任务，不只留在聊天记录。
6. 若涉及安全，转 `SECURITY.md` 私密路径。

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
