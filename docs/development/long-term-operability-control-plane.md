# Long-Term Operability Control Plane

## 目标

本文件定义 AreaForge 从“当前功能已完成”进入“产品可长期运营”后的控制面。它把 release 决策、维护节奏、真实体验、残余风险、供应链、生产只读证据和 repo-local skills 串成一条可复核链路。

它不是发布授权，不执行生产 deploy、backup、restore、migration、updater apply、rollback、server command 或生产写入；也不把本地验证、历史截图、readiness 预览或 evidence bundle 说成真实生产健康。

## 当前结论

- Package A-E 和 docs 100% 当前范围已完成，源事实见 `docs/development/docs-100-completion-record.md`。
- 线上版本源事实为 `0.1.7` / `v0.1.7` / `https://forge.areasong.top/`，当前生产发布记录见 `docs/development/release-v0.1.7-record.md`；`docs/development/package-e-remote-github-release-record.md` 保留 `v0.1.5` 历史记录。
- 自动更新当前安全默认是 `AREAFORGE_AUTO_APPLY=none`；Web 版本中心只提交受控请求，服务器侧 updater 执行高风险动作。
- 当前长期运营未完全关闭的不是“功能未完成”，而是生产证据、复核窗口和更新控制面：`v0.1.7` 已生产 apply 且公网 health 通过；`AF-RISK-OPS-001` 在 `v0.1.7` 更新前已有生产只读 smoke / update-agent / evidence bundle / closure packet 证据，更新时 extra smoke 通过，post-`v0.1.7` operational evidence bundle 已保存但仍是 `needs_attention`，更新后的 redacted smoke/status/closure packet 仍需重新采集；`AF-RISK-OPS-005` 已完成 expected-before V2 设计与确认包，但本地代码、签名 Release 和生产部署均未执行；`AF-RISK-SC-001` 已有 `v0.1.7` 签名 Release SBOM/provenance/checksum/signature 和生产 apply 证据，但台账尚未人工关闭；`AF-RISK-UX-001` 已新增本地 `0.1.7` desktop/mobile 复核记录，但不证明生产写入型 smoke 或真实用户数据体验；`AF-RISK-SC-002` 已有 CI-only `closed-evidence`，只有在 GitHub Actions、依赖审计策略、Release workflow、供应链记录校验或新 Release 前需要重跑复核。
- 当前 `NOT-READY` 完成声明证据见 `docs/development/long-term-operability-not-ready-20260711.txt`；它通过 `pnpm completion:evidence:validate`，只证明完成声明边界和阻塞项记录完整，不替代 `pnpm ops:long-term:gate`、生产 smoke、签名 Release 证据或 residual 人工关闭。当前 `v0.1.7` 只读长期证据快照见 `docs/development/long-term-evidence-snapshot-v0.1.7-20260712.json`，状态为 `needs_live_evidence`；它证明 OPS-001、OPS-004、release evidence record、供应链、UX 和运行信号缺口已被 hash 绑定，不证明生产健康或 residual 关闭。具体 `snapshotHash` 以快照文件和 `pnpm ops:long-term:snapshot:validate` 输出为准，避免源文档自引用导致 hash 漂移。

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
| Release closeout audit | `pnpm release:closeout:audit -- --version <X.Y.Z>`、`pnpm release:closeout:audit:validate <audit>` | 指定版本 Release、供应链、运行证据、rollback target 和 residual 的跨记录一致性 | 修改历史记录、自动关闭 residual、执行生产动作 |
| 供应链 | `pnpm sc:sc-002:preflight`、`pnpm ci:supply-chain:validate`、`pnpm release:supply-chain:validate`、GitHub Release assets | CI Actions pinning、`pnpm audit:prod`、SBOM、provenance、checksum、signature 证据 | 业务功能体验 |
| 运营 readiness | `pnpm ops:readiness:summary`、`pnpm ops:evidence:bundle` | health、update-agent、backup、cert、smoke 等证据摘要 | 缺失信号健康 |
| 长期证据快照 | `pnpm ops:long-term:snapshot`、`pnpm ops:long-term:snapshot:validate` | 当前 checkout 绑定的 OPS-001、OPS-004、OPS-005、release evidence record、签名 Release 供应链、UX 和运行信号证据路径、hash、状态和缺口 | live gate 通过、生产健康、residual 自动关闭 |
| 支持包预览 | `pnpm ops:support:bundle-preview` | 公开支持和维护交接所需的 metadata-only 版本、文档、residual 和 redaction 边界 | support export、生产健康、用户数据内容 |
| 运营交接 | `pnpm ops:handoff` | 当前版本、离线控制面、due residual、release follow-up、`boundaryStops`、下一步只读命令和 claim boundary | 真实生产健康、updater apply、secret 读取授权或 residual 自动关闭 |
| 长期运营 live gate | `pnpm ops:long-term:gate` | OPS-001、OPS-004、OPS-005、可校验 Release 发布记录、签名 Release 供应链和新鲜 UX 证据是否全部达到可人工复核关闭状态 | 自动收集生产证据、自动关闭 residual、创建 Release、执行服务器命令 |
| 真实体验 | `pnpm smoke:local-ux`、`pnpm experience:review:validate` | 桌面/移动核心旅程是否可理解、可完成 | 生产写入 smoke 或所有真实数据 |
| 残余风险 | `pnpm residuals:validate`、`pnpm residuals:review-due` | 哪些结论会被降级、何时复核、如何关闭 | 自动关闭风险 |
| Skills | `.codex/skills-src/**`、`pnpm skills:validate` | Codex 执行时该读谁、怎么验证、何时停下确认 | 产品源事实 |

## 证据词速查

长期运营记录必须区分证据词，避免把弱证据说成强结论：

| 证据词 | 能证明 | 不能证明 | 常用入口 |
|---|---|---|---|
| `status` | 某个本地投影、update-agent 摘要或服务响应的当前字段值 | 字段背后的生产动作已执行或所有信号健康 | `pnpm ops:status`、`pnpm update-agent:status:validate` |
| `readiness` | 进入下一步前需要的入口、文档、脚本或 redacted 信号是否齐备 | 自动执行下一步，也不等于生产健康 | `pnpm ops:readiness`、`pnpm ops:readiness:summary` |
| `handoff` | 当前 claim boundary、due residual、下一步只读命令和交接上下文 | live evidence、updater apply、backup、rollback 或 residual 关闭 | `pnpm ops:handoff` |
| `evidence bundle` | 一组运行信号、缺失证据、禁止动作和 hash 索引 | 缺失信号为健康，或 bundle hash 本身证明健康 | `pnpm ops:evidence:bundle` |
| `maintenance index` | 对全部已验证维护窗口记录做确定性排序和原始文件 hash 绑定 | 执行维护动作、证明当前生产健康或成为新的源事实 | `pnpm maintenance:window:index`、`pnpm maintenance:window:index:validate` |
| `snapshot` | 把当前证据路径、输入 hash、子预检状态和缺口绑定为只读交接记录 | live gate 通过、生产 smoke 已执行或 residual 已关闭 | `pnpm ops:long-term:snapshot` |
| `live gate` | 指定证据路径已达到可人工复核关闭门槛 | 自动采集证据、执行生产动作或修改台账 | `pnpm ops:long-term:gate` |
| `smoke` | 某个用户旅程或 API 路径在指定环境通过 | 全量 UX、数据安全、备份恢复或供应链可信 | `pnpm smoke:prod-readonly`、`pnpm smoke:local-ux` |
| `apply` | 服务器侧 updater 已实际执行更新动作并留下记录 | 仅从 Web 请求、Release 存在或离线状态推断 | `areaforge-updater.sh apply --yes --tag <tag>` 的 redacted 记录 |

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
pnpm ops:handoff:validate <operational-handoff.json>
pnpm ops:status
pnpm ops:status:validate <operability-status.json>
pnpm ops:long-term:gate
pnpm residuals:review-due
pnpm residuals:evidence:preflight
pnpm ops:support:bundle-preview
pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>
pnpm ops:readiness:summary
pnpm ops:evidence:bundle
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
pnpm ops:long-term:snapshot
pnpm ops:long-term:snapshot:validate <long-term-evidence-snapshot.json>
pnpm maintenance:window:record
pnpm maintenance:window:validate <maintenance-window-record.md|txt>
pnpm maintenance:window:index
pnpm maintenance:window:index:validate docs/development/maintenance-window-index.json
pnpm ops:ops-001:preflight
pnpm ops:alert:preview
pnpm ops:ops-004:preflight
pnpm ops:ops-005:preflight
pnpm ops:ops-005:evidence:validate <ops-005-production-evidence-record>
pnpm release:closeout:audit -- --version <X.Y.Z>
pnpm release:closeout:audit:validate <release-closeout-audit.json>
```

当 `pnpm residuals:review-due` 出现 `overdue` 或 `due_today`：

1. 先确认该 residual 是否影响当前发布、生产健康、安全、供应链或体验结论。
2. 若可立即执行且不触碰生产写入，转成当前任务或本地证据补齐。
3. 若需要生产写入、服务器命令、backup/restore、migration、updater apply、rollback 或发布动作，必须走高风险确认包。
4. 若仍是外部条件或接受例外，更新 `reviewAt`、影响、关闭条件和所需证据，不把它隐藏在聊天记录里。

`pnpm ops:status` 输出 AreaFlow-style 离线长期运营状态投影：控制面文件、package scripts、residual 分类、due-soon 项、下一步证据和安全事实。输出包含 `sourceSnapshot.controlPlaneSourceHash`，用于把状态投影绑定到当前控制面源文件集合；也包含 `sourceSnapshot.protectedPathFingerprint`，用同一组受保护路径、聚合 sha256 和 `doesNotProve` 把只读副作用 guard 的输入显式记录下来。`protectedPathFingerprint` 只证明投影绑定到了这组 protected paths，不证明生产健康、仓库全路径无变更或 `git status` 干净。顶层 `doesNotProve` 机器可读地声明该投影不能证明生产健康、updater apply、Release 创建、backup/restore/migration/rollback 执行或 residual risk closure。保存 JSON 后用 `pnpm ops:status:validate <operability-status.json>` 校验机器契约，维护窗口只需快速阅读时可用 `pnpm ops:status --summary` 输出人读摘要；机器校验、归档或后续生成器仍使用默认 JSON。它不连接生产、不读取密钥、不执行服务器命令、不写 `.areaforge/status.json` 或任何生产状态；生产健康仍必须靠 `pnpm ops:readiness:summary`、smoke、update-agent、备份和 release evidence 证明。

`ops:status` 的 `boundaryStops` 记录当前授权边界会阻止哪些证据闭环。当前稳定停止线是 post-`v0.1.7` OPS-001 证据包、`release-v0.1.7-record.md` backup SHA256、`AF-RISK-OPS-005` expected-before 本地实施与生产部署的两阶段确认，以及 residual 关闭决策。`update_request_expected_before` stop 明确区分本地代码实施确认、签名 Release 确认和生产 timer/队列/Web/agent 部署确认，不能用一次笼统授权替代。它把“当前还能跑的本地只读 validator”和“未来需要的显式确认”分开；不会授权服务器命令、不会授权读取/打印/复制/提交 secrets，也不会把 blocker 证据升级成完成证据。

`pnpm ops:readonly-side-effect:selftest` 是只读控制面的副作用回归检查。它会清空当前进程中的 `AREAFORGE_*` 环境变量后运行 `ops:status`、`ops:handoff`、`ops:support:bundle-preview`、`ops:backup-restore:preview`、维护窗口索引与已解决事故索引的生成/校验/selftest、`residuals:evidence:preflight`、`residuals:closure:selftest`、`ops:ops-001:preflight`、`ops:ops-004:preflight`、`ops:long-term:snapshot`、completion/release evidence validator selftests、变更路径/受保护路径审阅 selftests 和 Web 版本中心请求 guard selftest，校验输出里的 `safetyFacts` 或 selftest completion token，并比对关键文档/台账文件 hash 与 `git status --short`。它与 `sourceSnapshot.protectedPathFingerprint` 复用同一组 protected paths，并会复算 fingerprint，防止状态投影声明的保护路径集合和实际副作用检查分叉。它只证明这些本地只读入口和 validator selftests 没有改仓库，不证明生产健康、updater apply、备份、恢复、migration、rollback、OPS-001/OPS-004 收口、告警发送或 residual 关闭。

`pnpm ops:handoff` 输出只读运营交接摘要，把 `ops:status` 中的 current blocker、boundary stop、可执行 residual、due residual、release-relevant residual、可声称/不可声称内容和下一步命令整理到 `read_only_operational_handoff` JSON。保存 JSON 后用 `pnpm ops:handoff:validate <operational-handoff.json>` 校验交接契约；维护窗口或人工交接只需快速判断下一步时可用 `pnpm ops:handoff --summary`；需要保存证据或被脚本消费时仍使用默认 JSON。输出会继承 `controlPlaneSourceHash`、`protectedPathFingerprint` 和 `doesNotProve`，便于交接时复核它绑定到哪一组源事实和哪一组只读 protected paths，以及它不能替代哪些 live evidence 或高风险授权。它不访问网络、不写交接文件、不执行生产动作；维护窗口、release 前后或 Codex 线程交接时优先先看它，再决定是否需要 live readiness、evidence bundle、smoke 或高风险确认。

`ops:handoff:validate` 默认执行 current-binding 校验：重建当前 checkout 的 `controlPlaneSourceHash` 与 `protectedPathFingerprint.hash`；fresh handoff 必须返回 `bindingStatus: current`，格式合法但已过期的 handoff 必须返回 `bindingStatus: stale` 并失败。仅对历史归档可使用 `--shape-only`，此时 `bindingStatus: unavailable`，不得支持当前维护、release 或生产健康声明。

维护者形成 residual close / keep-open / downgrade / reopen 结论时，先用 `docs/development/residual-closure-review-template.md` 保存人工复核记录，并运行 `pnpm residuals:closure:validate <record>`。该记录只证明复核结论、证据 URI、validator 摘要、重新打开条件和 `doesNotProve` 完整；它必须保持 `closesResidual=no`，不自动修改 `docs/development/residual-risk-ledger.md` 或 `docs/development/residual-risk-ledger.json`。

`pnpm ops:long-term:gate` 是完成声明前的严格 live evidence gate。它复用 OPS-001、OPS-004、OPS-005、Release 发布记录、SC-002 和体验复核校验器，只读取本地 redacted 证据文件、发布记录和体验记录；默认要求 `AF-RISK-OPS-001` 返回 `ready_for_human_close`、`AF-RISK-OPS-004` 返回 `ready_for_human_close`、`AF-RISK-OPS-005` 返回 `ready_for_ops005_human_review`、`pnpm release:evidence:validate` 通过、签名 Release 供应链返回 `ready_for_sc001_sc002_review`，并且 `AF-RISK-UX-001` 体验记录的 `appVersion` 等于当前 package version、在 14 天内且通过 `pnpm experience:review:validate`。当前仓库默认绑定 `docs/development/release-v0.1.7-record.md`、`docs/development/release-supply-chain-v0.1.7.md`、`docs/development/ops-004-alert-preview-v0.1.7-20260712.json`、`docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt` 和 `docs/development/product-experience-review-v0.1.7-20260712-local.md`；不会再用 2026-07-11 历史 OPS-004 drill 或 2026-07-10 旧 UX 记录支撑当前完成声明。当前 OPS-004 已达到 `ready_for_human_close`，但 OPS-005 尚未本地实施，必须继续阻断完成声明。如设置 `AREAFORGE_OPS004_ALERT_PREVIEW` / `AREAFORGE_OPS004_ALERT_DRILL_RECORD` / `AREAFORGE_OPS005_PRODUCTION_EVIDENCE` / `AREAFORGE_LONG_TERM_RELEASE_RECORD` / `AREAFORGE_SC002_RELEASE_RECORD` / `AREAFORGE_LONG_TERM_UX_RECORD`，则优先使用显式路径。该命令缺证据时会退出失败，用于阻止“长期运营已完成”的过度声明；它不联网、不 SSH、不读取密钥、不创建 Release、不执行 updater、不备份、不恢复、不运行 migration、不写生产，也不修改 residual 台账。

`pnpm ops:long-term:snapshot` 是长期运营证据的只读快照入口。它会调用现有 control-plane、OPS-001、OPS-004、OPS-005、release evidence、SC 和 UX 校验器，默认只绑定当前 `v0.1.7` 的 release record、签名 Release 供应链记录、post-`v0.1.7` alert preview 和 matching drill、`0.1.7` UX 记录和当前 operational evidence bundle；不会默认读取 2026-07-11 的历史 OPS-001/OPS-004 收口记录。输出 schema v2 `read_only_long_term_evidence_snapshot` JSON，包含 `snapshotHash`、`controlPlaneSourceHash`、`protectedPathFingerprint`、输入证据 sha256、八项 check 状态、release evidence 中 `releaseEvidenceBundleHash` 与三类备份 hash 的状态、运行信号七类 inventory、`doesNotProve`、`forbiddenActions` 和 `safetyFacts`。仓库中的 `long-term-evidence-snapshot-v0.1.7-20260712.json` 是 schema v1 历史非 ready 证据；validator 只允许其 protected paths 为当前集合的安全子集，且不允许升级为 ready。它用于维护交接和说明“当前缺什么证据”，不会联网、SSH、读取密钥、执行服务器命令、创建 Release、下载资产、执行 updater、备份、恢复、migration、生产写入或修改 residual 台账；即使 validator 通过，也只证明记录形态、protected path 绑定和缺口绑定正确，不证明生产健康。

`pnpm ops:support:bundle-preview` 输出 metadata-only 支持包预览，把公开支持可用的版本、文档、命令名、residual ID、关闭条件、claim boundary 和 redaction/safety facts 聚合为可校验 JSON。它不导出支持包、不包含用户内容、不联网、不写生产；公开 issue 或自托管排障优先使用该预览，release/incident 证据冻结仍使用 `pnpm ops:evidence:bundle`。

可交接记录使用以下模板和只读校验：

| 记录 | 模板 | 校验命令 | 不能替代 |
|---|---|---|---|
| 维护窗口 | `docs/development/maintenance-window-record-template.md`；历史投影为 `docs/development/maintenance-window-index.json` | `pnpm maintenance:window:validate <record>`；`pnpm maintenance:window:index:validate docs/development/maintenance-window-index.json` | release record、真实生产写入证据；索引不替代源记录 |
| 事故 | `docs/development/incident-record-template.md`；已解决历史投影为 `docs/development/incident-index.json` | `pnpm incident:record:validate <record>`；`pnpm incident:index:validate docs/development/incident-index.json` | 高风险确认、生产修复动作本身、active incident 状态或 residual 关闭；索引不替代源记录 |
| 回滚后证明 | `docs/development/rollback-proof-record-template.md` | `pnpm rollback:proof:validate <record>` | rollback 执行授权、restore、自动重新开放更新通道或 residual 关闭 |
| 恢复演练 | `docs/development/restore-drill-record-template.md` | `pnpm restore:drill:validate <record>` | 生产 restore 授权 |
| Update-agent status | `docs/development/update-agent-status-record-template.md` | `pnpm update-agent:status:validate <record.json>` | updater check/apply、策略变更 |
| OPS-001 证据预检 | `docs/development/ops-001-closure-packet-template.md` | `pnpm ops:ops-001:preflight` | 生产 smoke 执行、收口包生成、自动关闭 residual |
| OPS-001 阻塞记录 | `docs/development/ops-001-production-readonly-attempt-20260711.md` | `pnpm ops:ops-001:blocked:validate <record>` | 生产 smoke 通过、收口包生成、长期运营完成 |
| OPS-001 收口包 | `docs/development/ops-001-closure-packet-template.md` | `pnpm ops:ops-001:closure:validate <record>` | 自动关闭 residual、备份/告警/供应链健康 |
| OPS-004 告警证据预检 | `docs/development/alert-drill-record-template.md` | `pnpm ops:ops-004:preflight` | 发送通知、调用外部接收人、自动关闭 residual |
| OPS-005 expected-before 生产证据 | `docs/development/ops-005-expected-before-production-evidence-template.md` | `pnpm ops:ops-005:preflight`、`pnpm ops:ops-005:evidence:validate <record>` | V2 本地实施、签名 Release、生产部署或自动关闭 residual |
| Release closeout audit | 指定版本 Release、供应链、运行证据和 residual 台账 | `pnpm release:closeout:audit:validate <audit>` | 修订历史记录、自动关闭 residual、生产健康 |
| 附件双向对账 | 发布/恢复副本中的 Attachment metadata、上传文件、孤儿和 unsafe entry | `pnpm attachment:reconciliation:summary:selftest`、`pnpm release:evidence:validate <record> <csv> <summary>` | 自动清理、metadata 修复、并发写入期间的快照一致性、生产 restore 授权 |
| 长期运营证据快照 | 本文件和当前证据路径 | `pnpm ops:long-term:snapshot:validate <snapshot>` | live gate 通过、生产健康、自动关闭 residual |
| 长期运营 live gate | 本文件、Release 发布记录和各 residual 证据记录 | `pnpm ops:long-term:gate` | 自动收集证据、自动执行生产动作、自动关闭 residual |

`pnpm ops:readiness:summary` 和 `pnpm ops:evidence:bundle` 会输出 `freshness` 字段，按默认 14 天窗口给每个可定位时间的信号标记 `fresh`、`stale` 或 `unknown`。`unknown` 不会被自动当成失败，但不能支持生产健康完成声明；release、update、migration 或 rollback 仍必须按对应 scope 要求补齐 live evidence。OPS-001 authenticated read-only smoke 另有更严格的 24 小时 smoke proof freshness gate：`pnpm smoke:prod-readonly:validate` 会拒绝超期记录，因此旧 smoke record 只能作为历史证据，不能支撑 `ready_for_human_close`。

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

- `AF-RISK-OPS-001`：当前 post-`v0.1.7` OPS-001 尚未达到 `ready_for_human_close`；`docs/development/operational-evidence-bundle-v0.1.7-20260712.json` 已保存但仍是 `needs_attention`，更新后的 redacted update-agent status、production readonly smoke record 和 OPS-001 closure packet 仍需重新采集后再进入人工关闭复核。2026-07-11/12 生产只读 fallback 目录 `docs/development/ops-001-production-readonly-20260711/` 只作为历史 / pre-update 证据保留；`v0.1.7` 更新时服务器 extra smoke 通过，但不能替代 post-update OPS-001 证据包。
- `AF-RISK-OPS-002`：写入型生产 smoke 仍需专用账号、确认、清理策略和受控记录。
- `AF-RISK-REL-001`：`AREAFORGE_AUTO_APPLY=none` 是已接受安全默认，启用 patch 自动应用需另行关闭证据。
- `AF-RISK-SC-001`：`v0.1.7` 签名 Release 的 SBOM/provenance 资产、校验记录和生产 apply 记录；关闭台账前复核 `docs/development/release-supply-chain-v0.1.7.md` 和 `docs/development/release-v0.1.7-record.md`，并明确 residual 关闭不是生产更新的副作用。
- `AF-RISK-SC-002`：已关闭为 CI-only 证据项；后续 GitHub Actions、依赖审计策略、Release workflow、供应链记录工具或新 Release 变更前重新复核。CI-only 证据不关闭 `AF-RISK-SC-001`。
- `AF-RISK-SC-003`：后续升级 `pg` / `@prisma/adapter-pg` 前重跑 deprecation trace 和本地 UX smoke。
- `AF-RISK-OPS-003`：未来服务器、域名、Nginx 或端口迁移需单独 runbook 和证据。
- `AF-RISK-OPS-004`：2026-07-11 manual-window 告警证据在 `v0.1.7` 更新后只作为历史输入；post-`v0.1.7` alert preview 与 matching alert drill 已保存，`pnpm ops:ops-004:preflight` 返回 `ready_for_human_close`。关闭台账仍需要维护者人工复核；该证据不证明外部告警接收人、metrics dashboard 或完整生产健康。
- `AF-RISK-OPS-005`：update request mutation 缺 expected-before、目标 Release/manifest/digest、TTL、idempotency/hash、processing reconciliation 和共享 production-state lock。当前只完成 `docs/development/update-request-expected-before-design.md`、active task 与确认包；本地实现、Release 和生产部署必须分开确认，任何 validator 通过都不能替代生产 V2 check 和 redacted decision evidence。
- `AF-RISK-UX-001`：2026-07-10 本地体验记录是历史关闭证据；2026-07-12 已新增本地 `0.1.7` desktop/mobile 复核记录；每次 release/update、体验改动或 14 天维护窗口前仍需重跑真实体验复核。

## 本地预检

修改长期运营控制面、release 决策、维护节奏、residual 复核、product experience 复核、skill owner 边界或对应脚本后运行：

```bash
pnpm enterprise:operability:preflight
```

该预检只检查文档、scripts、package scripts、skills、入口链接和证据词纪律是否保留长期运营控制面；它会拦截把 preview/status/snapshot/health 写成生产健康证明、把 `ready_for_human_close` 写成 residual 自动关闭、或把 Web runtime 写成可执行服务器命令的明显漂移。它不连接生产、不读取密钥、不执行 Docker、不备份、不恢复、不运行 migration、不创建 GitHub Release、不执行 updater apply、不写生产。
