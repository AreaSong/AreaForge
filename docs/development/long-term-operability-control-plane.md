# Long-Term Operability Control Plane

## 目标

本文件定义 AreaForge 从“当前功能已完成”进入“产品可长期运营”后的控制面。它把 release 决策、维护节奏、真实体验、残余风险、供应链、生产只读证据和 repo-local skills 串成一条可复核链路。

它不是发布授权，不执行生产 deploy、backup、restore、migration、updater apply、rollback、server command 或生产写入；也不把本地验证、历史截图、readiness 预览或 evidence bundle 说成真实生产健康。

## 当前结论

- Package A-E 和 docs 100% 当前范围已完成，源事实见 `docs/development/docs-100-completion-record.md`。
- 线上版本源事实为 `0.1.5` / `v0.1.5` / `https://forge.areasong.top/`，生产发布记录见 `docs/development/package-e-remote-github-release-record.md`。
- 自动更新当前安全默认是 `AREAFORGE_AUTO_APPLY=none`；Web 版本中心只提交受控请求，服务器侧 updater 执行高风险动作。
- 当前长期运营未完全关闭的不是“功能未完成”，而是生产证据和复核窗口：`AF-RISK-OPS-001` 仍需生产只读证据，`AF-RISK-SC-001` 仍需下一次签名 Release 的 SBOM/provenance 证据，`AF-RISK-UX-001` 仍需按 14 天窗口复核；`AF-RISK-SC-002` 已有 CI-only `closed-evidence`，只有在 GitHub Actions、依赖审计策略、Release workflow、供应链记录校验或新 Release 前需要重跑复核。
- 当前 `NOT-READY` 完成声明证据见 `docs/development/long-term-operability-not-ready-20260711.txt`；它通过 `pnpm completion:evidence:validate`，只证明完成声明边界和阻塞项记录完整，不替代 `pnpm ops:long-term:gate`、生产 smoke、签名 Release 证据或 residual 人工关闭。

## 从 AreaMatrix 和 AreaFlow 借鉴的轻量机制

AreaForge 只借鉴能直接增强长期运营的机制，不搬运完整 task-loop 或重型版本执行系统。

| 来源 | 借鉴点 | AreaForge 落点 |
|---|---|---|
| AreaMatrix workflow | 版本计划和 residual index 分层，残余项不替代源事实 | `workflow/README.md`、`docs/development/residual-risk-ledger.md` |
| AreaMatrix CI governance | 本地等价门禁和远端门禁分开，不用普通 CI 证明正式发布 | `.github/workflows/ci.yml`、`.github/workflows/release.yml`、`docs/development/release-train.md` |
| AreaMatrix release | tag、分发证据、外部条件和阻断项分开 | `docs/development/production-release-runbook.md`、`docs/development/release-record-template.md` |
| AreaFlow completion audit | 完成声明必须绑定证据、hash、review 和安全事实 | `docs/development/completion-evidence-checklist.md` |
| AreaFlow ops readiness | 只读 readiness 不执行 smoke、迁移、备份、服务控制或生产写入 | `docs/development/operational-readiness.md` |
| AreaFlow support bundle preview | 先 metadata-only preview，默认排除 secret、日志、附件、用户内容和远程上传 | `docs/development/support-bundle-preview.md`、`pnpm ops:support:bundle-preview` |
| AreaFlow web write gate | Web 默认只显示受控状态和请求，不获得服务器命令能力 | `docs/development/runtime-write-boundary.md`、`docs/deployment/github-release-updater.md` |
| AreaFlow security boundary | 关闭的能力要明确列成 forbidden actions | `docs/security/file-ai-safety.md`、`docs/development/high-risk-confirmation-packets.md` |

不建议搬运：

- AreaMatrix 的完整 version-local execution queue 和 task-loop 运行机制。AreaForge 当前用轻量 `tasks/**`、`workflow/**` 和 owner skills 足够。
- AreaFlow 的完成审计数据库证明模型。AreaForge 当前以 Markdown 记录、机器校验脚本、Release asset、GHCR digest 和 production record 作为证据链。
- 桌面端服务控制、远程 worker、support bundle export、远程 telemetry 等能力。AreaForge 当前只允许 metadata-only support bundle preview，Web runtime 必须继续保持 no-web-ops 边界。

## 控制面分层

| 层 | 入口 | 证明什么 | 不能证明什么 |
|---|---|---|---|
| 源事实 | `docs/**`、`tasks/**`、`workflow/**` | 产品、架构、范围、计划和关闭条件 | 真实生产健康 |
| 本地验证 | `pnpm check`、`pnpm smoke:local-ux`、专项 selftest | 当前 checkout 的构建、类型、规则和本地旅程 | 远端生产状态 |
| Release train | `docs/development/release-train.md`、`pnpm release:train:preflight` | 功能进入线上前的版本、资产、签名、digest、记录要求 | 自动完成 tag、GitHub Release 或部署 |
| 供应链 | `pnpm sc:sc-002:preflight`、`pnpm ci:supply-chain:validate`、`pnpm release:supply-chain:validate`、GitHub Release assets | CI Actions pinning、`pnpm audit:prod`、SBOM、provenance、checksum、signature 证据 | 业务功能体验 |
| 运营 readiness | `pnpm ops:readiness:summary`、`pnpm ops:evidence:bundle` | health、update-agent、backup、cert、smoke 等证据摘要 | 缺失信号健康 |
| 支持包预览 | `pnpm ops:support:bundle-preview` | 公开支持和维护交接所需的 metadata-only 版本、文档、residual 和 redaction 边界 | support export、生产健康、用户数据内容 |
| 运营交接 | `pnpm ops:handoff` | 当前版本、离线控制面、due residual、release follow-up、下一步只读命令和 claim boundary | 真实生产健康、updater apply 或 residual 自动关闭 |
| 长期运营 live gate | `pnpm ops:long-term:gate` | OPS-001、OPS-004、签名 Release 供应链和新鲜 UX 证据是否全部达到可人工复核关闭状态 | 自动收集生产证据、自动关闭 residual、创建 Release、执行服务器命令 |
| 真实体验 | `pnpm smoke:local-ux`、`pnpm experience:review:validate` | 桌面/移动核心旅程是否可理解、可完成 | 生产写入 smoke 或所有真实数据 |
| 残余风险 | `pnpm residuals:validate`、`pnpm residuals:review-due` | 哪些结论会被降级、何时复核、如何关闭 | 自动关闭风险 |
| Skills | `.codex/skills-src/**`、`pnpm skills:validate` | Codex 执行时该读谁、怎么验证、何时停下确认 | 产品源事实 |

## 功能更新后的 Release 决策矩阵

| 变更类型 | 是否需要 GitHub Release | 必跑本地门禁 | 额外证据 |
|---|---|---|---|
| 纯拼写、链接、历史记录标注 | 通常不需要 | `pnpm docs:readiness`、`git diff --check` | 若影响完成声明，补 `pnpm docs:completion` |
| docs 改变发布、更新、生产运维、自动策略或用户交付事实 | 需要 release train 判断；若进入线上文案或运维事实，按 Release 处理 | `pnpm release:train:preflight`、`pnpm ops:readiness`、`pnpm docs:readiness` | release record 或 residual 更新 |
| 用户可见功能、页面、API、学习闭环行为 | 需要 | `pnpm check`、`pnpm docs:readiness`、`pnpm risk:preflight` | 真实体验复核；必要时 `pnpm smoke:local-ux` |
| Prisma schema、migration、数据读写语义 | 需要 | `pnpm db:validate`、`pnpm db:generate`、`pnpm check` | 临时库 migration deploy 证据；生产 migration 另行确认 |
| 上传、附件、`UPLOAD_DIR`、文件对账、备份/恢复 | 需要 | storage/upload 专项测试、`pnpm risk:preflight`、`pnpm check` | file storage safety 审查、备份/恢复证据 |
| AI provider、prompt 最小化、fallback、限流、日志 | 需要 | AI 专项测试、`pnpm risk:preflight`、`pnpm check` | 隐私边界和日志脱敏证据 |
| updater、Docker、Nginx、备份、恢复、回滚、自动应用策略 | 需要，且生产动作高风险确认 | `pnpm github-release-updater:preflight`、`pnpm shellcheck:updater`、`pnpm ops:readiness` | backup、rollback、smoke、update-agent 证据 |
| 依赖、安全、GitHub Actions、签名、GHCR、Release workflow | 需要或至少进入 release/supply-chain review | `pnpm governance:preflight`、`pnpm audit:prod`、`pnpm release:supply-chain:selftest`、`pnpm ci:supply-chain:selftest`、`pnpm sc:sc-002:preflight:selftest` | Actions run、SBOM/provenance、signature、digest |
| repo-local skill 或治理文档 | 不一定需要线上 Release；若改变执行/交付事实则进入 release train 判断 | `pnpm skills:validate`、`pnpm governance:preflight`、`pnpm docs:readiness` | doc sync 和 residual 更新 |

Release 完成不等于生产更新完成。生产更新必须另有服务器侧 updater 或管理员执行证据。

## 维护窗口执行顺序

日常和每周维护按只读优先：

```bash
pnpm enterprise:operability:preflight
pnpm maintenance:cadence:preflight
pnpm ops:handoff
pnpm ops:status
pnpm ops:long-term:gate
pnpm residuals:review-due
pnpm ops:support:bundle-preview
pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>
pnpm ops:readiness:summary
pnpm ops:evidence:bundle
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
pnpm maintenance:window:record
pnpm maintenance:window:validate <maintenance-window-record.md|txt>
pnpm ops:ops-001:preflight
pnpm ops:alert:preview
pnpm ops:ops-004:preflight
```

当 `pnpm residuals:review-due` 出现 `overdue` 或 `due_today`：

1. 先确认该 residual 是否影响当前发布、生产健康、安全、供应链或体验结论。
2. 若可立即执行且不触碰生产写入，转成当前任务或本地证据补齐。
3. 若需要生产写入、服务器命令、backup/restore、migration、updater apply、rollback 或发布动作，必须走高风险确认包。
4. 若仍是外部条件或接受例外，更新 `reviewAt`、影响、关闭条件和所需证据，不把它隐藏在聊天记录里。

`pnpm ops:status` 输出 AreaFlow-style 离线长期运营状态投影：控制面文件、package scripts、residual 分类、due-soon 项、下一步证据和安全事实。输出包含 `sourceSnapshot.controlPlaneSourceHash`，用于把状态投影绑定到当前控制面源文件集合；也包含 `doesNotProve`，机器可读地声明该投影不能证明生产健康、updater apply、Release 创建、backup/restore/migration/rollback 执行或 residual risk closure。它不连接生产、不读取密钥、不执行服务器命令、不写 `.areaforge/status.json` 或任何生产状态；生产健康仍必须靠 `pnpm ops:readiness:summary`、smoke、update-agent、备份和 release evidence 证明。

`pnpm ops:handoff` 输出只读运营交接摘要，把 `ops:status` 中的可执行 residual、due residual、release-relevant residual、可声称/不可声称内容和下一步命令整理到 `read_only_operational_handoff` JSON。输出会继承 `controlPlaneSourceHash` 和 `doesNotProve`，便于交接时复核它绑定到哪一组源事实，以及它不能替代哪些 live evidence 或高风险授权。它不访问网络、不写交接文件、不执行生产动作；维护窗口、release 前后或 Codex 线程交接时优先先看它，再决定是否需要 live readiness、evidence bundle、smoke 或高风险确认。

`pnpm ops:long-term:gate` 是完成声明前的严格 live evidence gate。它复用 OPS-001、OPS-004、SC-002 和体验复核校验器，只读取本地 redacted 证据文件和体验记录；默认要求 `AF-RISK-OPS-001` 返回 `ready_for_human_close`、`AF-RISK-OPS-004` 返回 `ready_for_human_close`、签名 Release 供应链返回 `ready_for_sc001_sc002_review`，并且 `AF-RISK-UX-001` 体验记录在 14 天内且通过 `pnpm experience:review:validate`。当前仓库已保存的 `docs/development/ops-004-alert-preview-20260711.json` 和 `docs/development/ops-004-alert-drill-20260711-manual-window.txt` 会作为 OPS-004 默认 redacted 证据；如设置 `AREAFORGE_OPS004_ALERT_PREVIEW` / `AREAFORGE_OPS004_ALERT_DRILL_RECORD`，则优先使用显式路径。该命令缺证据时会退出失败，用于阻止“长期运营已完成”的过度声明；它不联网、不 SSH、不读取密钥、不创建 Release、不执行 updater、不备份、不恢复、不运行 migration、不写生产，也不修改 residual 台账。

`pnpm ops:support:bundle-preview` 输出 metadata-only 支持包预览，把公开支持可用的版本、文档、命令名、residual ID、关闭条件、claim boundary 和 redaction/safety facts 聚合为可校验 JSON。它不导出支持包、不包含用户内容、不联网、不写生产；公开 issue 或自托管排障优先使用该预览，release/incident 证据冻结仍使用 `pnpm ops:evidence:bundle`。

可交接记录使用以下模板和只读校验：

| 记录 | 模板 | 校验命令 | 不能替代 |
|---|---|---|---|
| 维护窗口 | `docs/development/maintenance-window-record-template.md` | `pnpm maintenance:window:validate <record>` | release record、真实生产写入证据 |
| 事故 | `docs/development/incident-record-template.md` | `pnpm incident:record:validate <record>` | 高风险确认、生产修复动作本身 |
| 恢复演练 | `docs/development/restore-drill-record-template.md` | `pnpm restore:drill:validate <record>` | 生产 restore 授权 |
| Update-agent status | `docs/development/update-agent-status-record-template.md` | `pnpm update-agent:status:validate <record.json>` | updater check/apply、策略变更 |
| OPS-001 证据预检 | `docs/development/ops-001-closure-packet-template.md` | `pnpm ops:ops-001:preflight` | 生产 smoke 执行、收口包生成、自动关闭 residual |
| OPS-001 阻塞记录 | `docs/development/ops-001-production-readonly-attempt-20260711.md` | `pnpm ops:ops-001:blocked:validate <record>` | 生产 smoke 通过、收口包生成、长期运营完成 |
| OPS-001 收口包 | `docs/development/ops-001-closure-packet-template.md` | `pnpm ops:ops-001:closure:validate <record>` | 自动关闭 residual、备份/告警/供应链健康 |
| OPS-004 告警证据预检 | `docs/development/alert-drill-record-template.md` | `pnpm ops:ops-004:preflight` | 发送通知、调用外部接收人、自动关闭 residual |
| 长期运营 live gate | 本文件和各 residual 证据记录 | `pnpm ops:long-term:gate` | 自动收集证据、自动执行生产动作、自动关闭 residual |

`pnpm ops:readiness:summary` 和 `pnpm ops:evidence:bundle` 会输出 `freshness` 字段，按默认 14 天窗口给每个可定位时间的信号标记 `fresh`、`stale` 或 `unknown`。`unknown` 不会被自动当成失败，但不能支持生产健康完成声明；release、update、migration 或 rollback 仍必须按对应 scope 要求补齐 live evidence。

## Skill 增减规则

当前 17 个 repo-local skills 已覆盖长期运营主要 owner：

- enterprise governance
- public maintenance
- operating loop
- release operator
- QA smoke
- docs sync
- git checkpoint
- SRE ops
- observability
- incident response
- security governance
- file storage safety
- supply chain
- residual ledger
- product experience
- AI governance
- validation driver

默认不新增第 18 个 skill。只有出现新的稳定 owner 边界时才新增，例如未来需要长期管理数据导出、数据保留、删除权、用户迁移和隐私生命周期时，可新增 `areaforge-data-governance`。在此之前，数据相关工作由 `security-governance`、`file-storage-safety`、`sre-ops` 和 `residual-ledger` 联合覆盖。

优化现有 skill 时遵循：

- 源事实先写入 `docs/**`、`tasks/**` 或 `workflow/**`，skill 只做执行导航。
- 任何会改变发布、生产、AI、上传、安全或自动更新边界的 skill 文案，都要同步验证矩阵和对应 preflight。
- 每次变更 skill 时同步核对 `agents/openai.yaml` 的 `display_name`、`short_description` 和 `default_prompt`，确保自动发现入口仍覆盖 `SKILL.md` 触发语义；`pnpm skills:validate` 会检查关键触发词。
- 在 `areaforge-data-governance` 成为稳定 owner 前，数据导出、数据留存、删除权、用户迁移、隐私生命周期、AI 历史或费用记录留存变化都由 `security-governance`、`file-storage-safety`、`ai-governance`、`sre-ops` 和 `residual-ledger` 共同按高风险边界处理。
- 不能用 skill 文案降低高风险确认、签名、备份、rollback、smoke 或 residual 关闭条件。

## 当前必须持续复核的证据

- `AF-RISK-OPS-001`：当前是长期运营完成声明阻塞项。2026-07-11 只读 fallback 已留下 blocked record 和有效 redacted update-agent status，但仍缺生产 `AREAFORGE_EXTRA_SMOKE_COMMAND`、smoke email/password file 和 host `pnpm` 运行时；必须补齐生产只读 smoke 配置、最近一次通过记录、redacted update-agent status、operational evidence bundle 和 `pnpm ops:ops-001:closure:validate` 收口包。
- `AF-RISK-OPS-002`：写入型生产 smoke 仍需专用账号、确认、清理策略和受控记录。
- `AF-RISK-REL-001`：`AREAFORGE_AUTO_APPLY=none` 是已接受安全默认，启用 patch 自动应用需另行关闭证据。
- `AF-RISK-SC-001`：下一次签名 Release 的 SBOM/provenance 资产与校验记录。
- `AF-RISK-SC-002`：下一次 GitHub CI/Release run 的 Actions pinning 和 `pnpm audit:prod` 证据；先跑 `pnpm sc:sc-002:preflight`，CI-only 证据不关闭 `AF-RISK-SC-001`。
- `AF-RISK-SC-003`：后续升级 `pg` / `@prisma/adapter-pg` 前重跑 deprecation trace 和本地 UX smoke。
- `AF-RISK-OPS-003`：未来服务器、域名、Nginx 或端口迁移需单独 runbook 和证据。
- `AF-RISK-OPS-004`：外部告警接收人或人工值班窗口、告警/恢复演练记录和 `pnpm ops:ops-004:preflight` 通过证据。
- `AF-RISK-UX-001`：每次 release/update、体验改动或 14 天维护窗口前重跑真实体验复核。

## 本地预检

修改长期运营控制面、release 决策、维护节奏、residual 复核、product experience 复核、skill owner 边界或对应脚本后运行：

```bash
pnpm enterprise:operability:preflight
```

该预检只检查文档、scripts、package scripts、skills 和入口链接是否保留长期运营控制面；它不连接生产、不读取密钥、不执行 Docker、不备份、不恢复、不运行 migration、不创建 GitHub Release、不执行 updater apply、不写生产。
