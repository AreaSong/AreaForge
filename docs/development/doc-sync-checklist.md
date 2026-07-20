# 文档同步检查清单

## 目标

防止 `docs/`、`README.md`、`AGENTS.md`、`tasks/`、`workflow/` 之间出现源事实漂移。

## 源事实顺序

1. `docs/product/**`：产品定位、范围、路线图。
2. `docs/architecture/**`：工程结构、数据、API、部署、文件存储、AI 边界。
3. `docs/modules/**`：业务模块行为。
4. `docs/ux/**`：页面状态和交互。
5. `docs/security/**`：高风险边界。
6. `docs/development/**`：开发顺序、验证和工作流。
7. `workflow/versions/**`：版本计划。
8. `tasks/**`：执行任务。

## 必查项

- 新功能是否有 `docs/modules/**` 或 `docs/product/**` 落点。
- 新 API 是否同步 `docs/architecture/api-surface.md`。
- 新表或字段是否同步 `docs/architecture/data-model.md`。
- 品牌素材、Logo、图标或静态资产入口变化是否同步 `assets/brand/brand-manifest.json`、`docs/architecture/project-structure.md`、`docs/ux/brand-assets.md` 和必要的 README 导航，并准确区分当前 checkout 已接入、线上版本已发布与生产已更新三种状态。
- 上传、附件、AI、认证、部署变化是否同步安全文档。
- 上传、附件、`UPLOAD_DIR`、文件对账、备份/恢复或上传目录迁移变化是否同步 `docs/architecture/file-storage.md`、`docs/security/file-ai-safety.md`、`docs/deployment/backup-restore.md` 和 `areaforge-file-storage-safety`。
- 附件对账证据变化是否同步生产 release runbook、release record template 和 validation matrix；CSV/summary 的路径、status、CSV SHA256、summary canonical hash、`fileOnlyCount`、`unsafeEntryCount` 与 `report_only` 边界是否一致。
- 备份/恢复证据预览、`blockingGaps`、root-only backup hash、恢复演练记录、rollback target 或 current source binding 口径变化时，是否同步 `docs/deployment/backup-restore.md`、`docs/development/operational-readiness.md`、`docs/development/maintenance-cadence.md`、README 和验证矩阵，并运行 `pnpm ops:backup-restore:preview:selftest`、真实 preview 默认校验、`pnpm quality:operability:typecheck` 和 `git diff --check`；schema v2 默认 validator 是否返回 `bindingStatus: current`，历史 `--shape-only` 是否保持 `bindingStatus: unavailable`。
- 功能更新若进入线上，是否按 `docs/development/release-record-template.md` 同步 release tag、GitHub Release、GHCR digest、线上 health、update-agent 状态、回滚目标、`pnpm ops:evidence:bundle` 的 `bundleHash`、`pnpm ops:evidence:bundle:validate` 的校验结论、`pnpm ops:alert:preview` 的告警预览结论和残余风险。
- 签名 Release 后若提交 redacted evidence、UX review 或 residual 关闭状态，是否按 `docs/development/release-evidence-closeout-contract.md` 运行 `pnpm release:closeout:binding:selftest`，并逐提交确认 Release 源提交到当前干净 HEAD 之间只有精确白名单 evidence/status 100644 文件；merge、删除、任意 task/design 路径、symlink/executable、敏感内容及任何产品源码、migration、workflow、updater、依赖或运行配置变化是否转入新 Release，而不是伪装成 closeout。
- 生产 Release 记录落定后，是否复制 version、releaseTag、`releasedAt`、`gitCommit` 并绑定 release record `{path,sha256}`，按 UTC 日历日精确计算 D14/D30，并从 `post-release-observation-template.json` 新建独立版本 observation 记录；未执行项是否保持 `pending_observation`、非空摘要、`observedAt=null` 和空 `evidence`，且没有改写历史 release record、复制状态到 lifecycle 或自动关闭 residual。
- 维护窗口、release/update 前后或 Codex 线程交接时，是否先用 `pnpm ops:handoff` 生成只读交接摘要，并明确它不替代 live readiness、smoke、update-agent、备份或 rollback 证据。
- 新增、修改或移除维护窗口记录后，是否用 `pnpm maintenance:window:index` 完整重建 `docs/development/maintenance-window-index.json`，并通过 `pnpm maintenance:window:index:validate` 证明记录集合、原始文件 hash、排序和 `latestWindowId` 未漂移；索引是否仍明确不是源事实或执行队列。
- 新增、修改或移除事故记录后，是否用 `pnpm incident:index` 完整重建 `docs/development/incident-index.json`，并通过 `pnpm incident:index:validate` 证明全部源记录、active/resolved 分组、原始文件 hash、排序和 `latestIncidentId` 未漂移；是否保持未解决记录绑定 residual、`resolved` 必须 `postIncidentReview=yes`，并明确索引不是实时处置授权、生产无事故证明或 residual 关闭证据。
- 实际 rollback 后是否同时同步 incident/release/update 事实和 `rollback-proof-record`，并运行 `pnpm rollback:proof:validate`；是否明确 `ready-for-human-review` 不会自动重新开放更新通道、执行 restore 或关闭 residual。
- OPS-006 active-session uniqueness、CAS、结束计时副作用或 CheckIn 锁契约变化时，是否同步 `ops-006-business-state-concurrency-design.md`、`data-integrity-doctor.md`、`tasks/active/0020-business-state-concurrency.md`、API/data-model 文档、validation matrix 和 residual 台账；本地并发测试不得替代签名 Release 或生产 migration/deploy 证据。
- OPS-005/006 联合 rollout 或终态证据变化时，是否同步 high-risk confirmation packet、release train、production runbook、OPS-005 evidence template、OPS-006 production template、active tasks 0019/0020、residual ledger、operational readiness、README/workflow current state，以及 versioned Release/supply-chain/production evidence/post-observation records；签名资产、基础 rollout、controlled-write probe 和 residual 关闭是否保持四个独立确认边界。
- OPS-007 staging/write-intent、附件状态、O_NOFOLLOW、reconciliation 或备份截面变化时，是否同步 file storage、安全、backup/restore、任务、fixture、validation matrix 和 residual 台账；不得把新协议 reconciliation 扩大成历史 orphan 自动清理。
- OPS-008 journal、backup fsync barrier、hold/drain、queue-control lock 或 reconciliation exit 变化时，是否同步 updater 部署文档、runtime write boundary、任务、fixture、CI/Release validate gate 和 residual 台账；Web runtime 仍不得获得 hold/clear 或服务器命令权限。
- 公开支持、自托管排障或维护交接需要可贴出的诊断摘要时，是否优先使用 `docs/development/support-bundle-preview.md`、`pnpm ops:support:bundle-preview` 和 `pnpm ops:support:bundle-preview:validate`，并明确它是 metadata-only preview，不是 support export、生产健康或 residual 关闭证据。
- 完成声明是否使用 schema V2，并按 `docs/development/completion-evidence-checklist.md` 说清 summary、claimScope、evidenceUri、证据等级、新鲜验证、未验证项、阻断项、Release 需求、doesNotProve 和 residual risk IDs；是否先用 `--print-current-fingerprint` 绑定当前 HEAD、完整工作树内容、changed paths、commands/profile，再通过默认 `pnpm completion:evidence:validate <record>`；历史 V1 是否仅使用 `--shape-only` 且没有升级为当前证据；任何校验均不替代真实运行、Release、生产 smoke 或长期运营 live gate。
- 写动作或运行时能力变化是否按 `docs/development/runtime-write-boundary.md` 标明 R0-R4 等级，避免把 preview、local smoke、update request 或草稿说成生产 apply。
- 功能更新若准备进入线上，是否先按 `docs/development/release-train.md` 固定版本、验证、Release 资产、供应链记录、updater 证据、smoke、回滚目标和停止条件。
- 签名 Release 若用于补齐或复核 `AF-RISK-SC-001`，是否先使用 `docs/development/high-risk-confirmation-packets.md` 的签名 Release 证据闭环确认包，并确认它不包含生产 updater apply、backup/restore、migration、rollback 或 residual 台账关闭；`v0.1.7` 证据已存在但台账仍需人工复核。
- 生产 SSH 只读导出若用于补齐 `AF-RISK-OPS-001`，是否先使用 `docs/development/high-risk-confirmation-packets.md` 的生产只读证据导出确认包，并确认它不包含 updater apply、backup/restore、migration、rollback、写入型 smoke、secrets 读取/打印/复制或 residual 台账关闭。
- 功能更新、维护节奏、release 决策、skill owner 边界或 residual 复核口径变化，是否同步 `docs/development/long-term-operability-control-plane.md`，并运行 `pnpm enterprise:operability:preflight` 和 `pnpm ops:status` 检查离线状态投影。
- SLO、incident transition、capability lifecycle、deprecation/retirement 或其证据来源变化时，是否同步 `docs/development/operations-lifecycle.md`、`docs/development/operations-lifecycle.json`、长期运营控制面、readiness、维护节奏和验证矩阵，并运行 `pnpm ops:lifecycle:selftest`、`pnpm ops:lifecycle:validate`、`pnpm ops:lifecycle:typecheck`；不得把 validator 通过写成生产 SLO 达成或实际退役完成。
- D14/D30 observation 模板或记录变化时，是否运行 `pnpm release:post-observation:validate:selftest`、`pnpm release:post-observation:status:selftest`、实际记录 validate/status；是否只使用 `pending_observation`、`needs_attention`、`blocked`、`ready_for_human_review` 状态投影，并确保 lifecycle 只声明通用 capability，没有复制具体版本 observation 运行状态。
- 若要声明“产品可长期运营”，是否运行 `pnpm ops:long-term:gate`，并确认 OPS-001、OPS-004、OPS-005、OPS-006 production evidence、与 OPS-006 after-doctor 同 SHA/hash 的 data-integrity record、可校验 Release 发布记录、strict 签名 Release 供应链和新鲜 UX 证据均达到可人工复核关闭状态；该 gate 不自动收集证据、不执行生产动作、不修改 residual 台账。
- Release/update 后若需要交接当前证据与缺口，是否保存 schema v3 `pnpm ops:long-term:snapshot` 输出，显式绑定 fresh data-integrity doctor，并通过默认 current-binding `pnpm ops:long-term:snapshot:validate <snapshot.json>`；历史 v1/v2 是否仅使用 `--shape-only`。快照只能证明当前证据路径、hash、状态和缺口绑定正确，不能替代 live gate、生产 smoke、update-agent、备份 hash、告警演练、并发写修复或 residual 关闭。
- 新签名 Release 若用于关闭或复核供应链残余项，是否按 `docs/development/release-supply-chain-record-template.md` 记录 SBOM/provenance、checksum/signature、Actions pinning 和 `pnpm audit:prod`，同时配置 record/assets 通过 `pnpm sc:sc-002:preflight` 与 `pnpm release:supply-chain:validate <record> <release-assets-dir> --strict`。
- 生产运维、发布、自动更新或长期运营状态变化，是否同步 `docs/development/operational-readiness.md`、`docs/development/residual-risk-ledger.md` 和对应 ops/release 文档。
- residual schema V2 变化时，是否确保每个 item 都包含 `taskRefs`、`taskPromotionWaiver`、`acceptedException`；任务引用是否存在并与 task YAML `residualRiskIds` 双向一致，`executableNow=true` 是否由 active task 或有效 waiver 支撑，accepted exception 是否只来自可追溯历史事实并绑定 canonical `basisHash`；status、handoff、support、release closeout、review-due、doctor、lifecycle、evidence 和 preflight 是否统一使用权威 V2 reader 并在 V1/无效台账上 fail closed。
- residual 新增或移除 task binding 时，是否同步 `tasks/indexes/residuals.md`、`tasks/README.md` 和对应 task；人工 closure review 是否仍保持 `closesResidual=no`，没有自动修改台账的 `type`、`reviewAt`、`executableNow` 或关闭状态。
- residual promotion 口径变化时，是否运行 `pnpm residuals:promotion-preview:selftest` 和实际 preview；输出是否仍明确 `writesTask=false`、`writesLedger=false`，且没有推断目标路径或提供自动 apply。
- Release record、供应链记录、operational evidence bundle、rollback target 或 release-relevant residual 变化后，是否运行 `pnpm release:closeout:audit -- --version <X.Y.Z>` 并用 `pnpm release:closeout:audit:validate <audit.json>` 校验，确认跨记录 hash/identity 不漂移。
- 保存或复用 `ops:handoff` JSON 时，是否用默认 `pnpm ops:handoff:validate <handoff.json>` 校验 current binding；`--shape-only` 只允许历史归档形态检查，不得用于当前维护交接。
- OPS-005 expected-before 契约、preflight、validator、Release 或生产证据变化，是否同步 `docs/development/ops-005-expected-before-production-evidence-template.md`、`docs/development/update-request-expected-before-design.md`、状态/交接投影和长期 gate/snapshot；validator 通过不得自动关闭 residual。
- 日常维护节奏、证据新鲜度或 residual 复核规则变化，是否同步 `docs/development/maintenance-cadence.md`、`docs/development/operational-readiness.md`、验证矩阵和相关 observability/residual skill。
- 自托管上手、公开分发或首次操作者路径变化，是否同步 `docs/deployment/operator-onboarding.md`、`README.md`、`docs/README.md`、`apps/web/README.md`、验证矩阵和相关 SRE/release skill。
- 生产只读 smoke 记录若进入仓库或运维交接摘要，是否使用 `docs/development/production-readonly-smoke-record-template.md` 并通过 `pnpm smoke:prod-readonly:validate`。
- 告警/恢复演练记录若进入仓库或运维交接摘要，是否使用 `docs/development/alert-drill-record-template.md` 并通过 `pnpm alert:drill:validate`。
- 事故记录若进入仓库或运维交接摘要，是否使用 `docs/development/incident-record-template.md` 并通过 `pnpm incident:record:validate`。
- 例行恢复演练记录若进入仓库或运维交接摘要，是否使用 `docs/development/restore-drill-record-template.md` 并通过 `pnpm restore:drill:validate`，且不把演练记录当成生产 restore 授权。
- 周/月维护窗口记录若进入仓库或运维交接摘要，是否使用 `docs/development/maintenance-window-record-template.md` 并通过 `pnpm maintenance:window:validate`。
- Update-agent redacted status JSON 若作为 readiness 输入或交接证据，是否使用 `docs/development/update-agent-status-record-template.md` 并通过 `pnpm update-agent:status:validate`。
- `AF-RISK-OPS-001` 关闭证据若进入仓库或运维交接摘要，是否先用 `pnpm ops:ops-001:preflight` 检查 redacted 证据链，再使用 `docs/development/ops-001-closure-packet-template.md` 并通过 `pnpm ops:ops-001:closure:validate`；预检和生成收口包都不得自动修改 residual 台账。
- `AF-RISK-SC-002` CI-only 证据若进入仓库或运维交接摘要，是否先运行 `pnpm sc:sc-002:preflight`，再使用 `docs/development/ci-supply-chain-record-template.md` 并通过 `pnpm ci:supply-chain:validate`；不要把 CI-only 证据当成 `AF-RISK-SC-001` 的 SBOM/provenance Release 证据。
- residual 人工复核结论若进入仓库或维护交接摘要，是否使用 `docs/development/residual-closure-review-template.md` 并通过 `pnpm residuals:closure:validate <record>`；记录是否使用结构化 `validatorOutcome`、绑定权威 V2 residual type、引用真实存在的仓库证据且无重复字段；该记录必须保持 `closesResidual=no`，不能替代台账更新或 `pnpm residuals:validate`。
- 真实产品体验复核记录若进入仓库或 release/update 交接摘要，是否使用 `docs/development/product-experience-review-record-template.md`、`ux-source-v2` 指纹和新鲜度窗口并通过 `pnpm experience:review:validate`；若未绑定实际运行实例，是否明确保留 UX residual。
- 若变更长期运营 workflow 或 skill，是否同步 `.codex/skills-src/**`、`.agents/skills/**`、`README.md`、`AGENTS.md` 和相关验证/残余风险入口，并运行 `pnpm skills:validate`。
- 若变更 repo-local skill，是否同步对应 `agents/openai.yaml`，确认 `display_name`、`short_description` 和 `default_prompt` 仍覆盖 `SKILL.md` 的触发语义。
- 若涉及数据导出、数据留存、删除权、用户迁移、隐私生命周期、AI 历史或费用记录留存变化，是否按安全/文件/AI/SRE owner 共同高风险确认处理，而不是仅靠 skill 文案或普通 docs 更新。
- 若变更公开项目治理、依赖、CI、PR 模板或安全披露入口，是否同步 `SECURITY.md`、`.github/**`、`docs/development/dependency-policy.md`、`README.md` 和验证矩阵，并运行 `pnpm secrets:scan`、`pnpm governance:preflight`。
- 若变更目录责任、审阅分级、R0-R4 路由、protected path 集合或工作区审阅口径，是否同步 `docs/development/governance-boundary-matrix.md`、`docs/development/protected-path-review-record-template.md`、`scripts/quality/governance-preflight.ts` 和验证矩阵；路径报告运行 `pnpm governance:changed-paths --summary`，受保护路径人工审阅记录须通过 `pnpm governance:protected-path-review:validate`，两者都不能当成生产健康、完整仓库审阅或后续工作区干净的证明。
- 若治理权威路径、accountable owner、package script 门禁或复审触发器变化，是否同步 `docs/development/governance-register.json`，运行 `pnpm governance:register:selftest`、`pnpm governance:register:validate` 和 `pnpm governance:preflight`；不得在登记册中复制 status、lifecycle、residual、due 或关闭条件。
- 若变更公开支持、issue 模板、ops support、贡献者 PR 或 triage 规则，是否同步 `SUPPORT.md`、`.github/ISSUE_TEMPLATE/**`、`docs/development/support-intake.md`、`.codex/skills-src/areaforge-public-maintenance`、`README.md`、`docs/README.md` 和验证矩阵，并运行 `pnpm support:intake:preflight`；若 skill 改动，补跑 `pnpm skills:validate`。
- 若引入或扩大 subagent、MCP、Browser/Computer Use、自动化、部署插件或远程运维工具，是否同步 `docs/development/external-capability-admission.md`，并确认没有绕过 Web runtime 服务器命令禁区。
- README 是否只导航，不承载更深规则。
- AGENTS 是否只放协作规则和高风险边界，不替代详细设计。
- `tasks/**` 是否引用对应源事实。
- `workflow/versions/**` 是否有入口条件、范围、不包含和验收标准。

## 旧内容检查

完成拆分或迁移后，应检查：

- 旧顶层方案文件名无残留引用。
- 同一功能没有在多个文档中定义不同规则。
- 暂缓项没有被写进当前版本验收标准。
- 历史讨论没有变成当前产品事实。

## 推荐命令

```bash
rg -n "AreaForge产品""方案|AreaForge工程结构""方案|产品""方案\\.md|工程结构""方案\\.md" README.md AGENTS.md docs tasks workflow
find docs tasks workflow -maxdepth 3 -type f | sort
git diff --check
pnpm docs:readiness
pnpm docs:completion
```

## 完成标准

- 入口路径一致。
- 源事实和执行任务能互相追踪。
- 暂缓项、当前范围和第二阶段增强没有冲突。
- 未发现旧文件名或旧路径残留。
