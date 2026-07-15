# AreaForge Docs

`docs/` 是 AreaForge 的源事实目录。后续开发、评审、实现和部署优先以这里的文档为准。

## 产品

- `product/charter.md`：产品定位和边界。
- `product/prd.md`：产品需求文档。
- `product/feature-scope.md`：版本范围和功能分期。
- `product/roadmap.md`：阶段路线图。

## 架构

- `architecture/overview.md`：系统分层总览。
- `architecture/project-structure.md`：monorepo 目录结构。
- `architecture/data-model.md`：核心数据模型。
- `architecture/api-surface.md`：API 与服务边界。
- `architecture/auth-security.md`：认证、安全和高风险边界。
- `architecture/ai-boundary.md`：AI 调用边界。
- `architecture/file-storage.md`：附件存储策略。
- `architecture/deployment.md`：部署架构。

## 模块

`modules/` 记录具体业务模块设计。第一版优先实现：今日作战台、任务计划、专注计时、考纲进度、笔记资料、复盘、任务债务、反假学习、恢复模式。第二阶段增强项也要在模块文档中保留入口，如全真模拟、周审判、月复盘、长期 AI 阶段调整。

当前模块入口：

- `modules/dashboard.md`：今日作战台。
- `modules/tasks.md`：任务计划。
- `modules/timer.md`：专注计时。
- `modules/check-in.md`：打卡与连续性。
- `modules/review.md`：晚间复盘。
- `modules/syllabus-map.md`：考纲进度树与作战地图。
- `modules/notes.md`：笔记与资料。
- `modules/discipline-engine.md`：鞭策引擎。
- `modules/task-debt.md`：任务债务。
- `modules/recovery-mode.md`：恢复模式。
- `modules/anti-fake-study.md`：反假学习。
- `modules/mastery-proof.md`：掌握证明。
- `modules/analytics.md`：数据统计。
- `modules/emotion-state.md`：情绪与状态。
- `modules/motivation.md`：动机封存与唤醒。
- `modules/stage-levels.md`：阶段称号。
- `modules/simulation-exam.md`：全真模拟。
- `modules/periodic-reports.md`：周审判与月复盘。
- `modules/ai-stage-adjustment.md`：AI 阶段调整。

## UX

- `ux/dashboard-states.md`：作战台状态。
- `ux/focus-timer.md`：专注计时交互。
- `ux/recovery-mode.md`：恢复模式体验。
- `ux/dynamic-theme.md`：动态主题。
- `ux/brand-assets.md`：品牌素材包、深浅色图标、横向 Logo 和接入边界。

## 决策

- `adr/0001-tech-stack.md`：技术栈。
- `adr/0002-private-web-first.md`：私有 Web 优先。
- `adr/0003-postgresql-primary-state.md`：PostgreSQL 主状态源。
- `adr/0004-ai-adapter-boundary.md`：AI 适配边界。

## 开发

- `development/setup.md`：本地开发准备。
- `development/testing.md`：验证策略。
- `development/implementation-order.md`：实现顺序。
- `development/pre-code-closure.md`：开发前闭环清单。
- `development/codex-workflow.md`：轻量 Codex 协作工作流。
- `development/long-term-operability-control-plane.md`：长期运营控制面，统一 release 决策、维护窗口、真实体验、残余风险、供应链和 skill 增减规则。
- `development/long-term-operability-control-plane.md` 中的 `pnpm ops:long-term:gate`：长期运营完成声明前的严格 live evidence gate，集中校验 OPS-001、OPS-004、OPS-005、可校验 Release 发布记录、签名 Release 供应链和新鲜 UX 记录。
- `development/long-term-operability-control-plane.md` 中的 `pnpm ops:long-term:snapshot`：只读长期运营证据快照，聚合当前版本的证据路径 hash、OPS-001/OPS-004/OPS-005/release evidence record/供应链/UX/运行信号状态和缺口，不替代 live gate、生产 smoke 或 residual 人工关闭。
- `development/long-term-evidence-snapshot-v0.1.7-20260712.json`：`schemaVersion=1` 的历史非 ready 快照，状态为 `needs_live_evidence`；当前新快照使用 schema v2 并强制包含 OPS-005，该历史记录不能用于证明当前生产健康。
- `development/release-train.md`：功能进入线上时的版本、GitHub Release、签名资产、updater、smoke、回滚目标、发布记录和残余风险固定路径。
- `pnpm release:closeout:audit -- --version <X.Y.Z>`：版本级只读 closeout 交叉审计，校验 Release、供应链、运行证据、rollback target 与 residual 台账的一致性；输出需再用 `pnpm release:closeout:audit:validate <audit.json>` 校验。
- `development/completion-evidence-checklist.md`：完成声明证据清单，区分 docs、本地 smoke、浏览器复核、Release 和生产证据，并要求写清 summary、claimScope、evidenceUri 与 doesNotProve；`pnpm completion:evidence:validate <record>` 只校验完成声明记录形态，不替代真实运行、Release、生产 smoke 或长期运营 live gate。
- `development/runtime-write-boundary.md`：R0-R4 运行时写动作边界矩阵，区分只读、本地写、用户显式 Web 写、update request 和高风险生产操作。
- `development/update-request-expected-before-design.md`：版本中心请求的 expected-before、目标 Release/manifest/digest、双 hash、幂等、TTL、原子发布、processing reconciliation、共享生产状态锁、legacy fail-closed 和生产升级边界设计。
- `development/governance-boundary-matrix.md`：目录责任、R0-R4 路由、审阅分级与最小验证矩阵；它不授权生产动作。
- `development/protected-path-review-record-template.md`：受保护路径人工审阅记录模板，配套 `pnpm governance:protected-path-review:validate`，用于记录工作区审阅边界而非宣称工作区干净。
- `development/dependency-policy.md`：依赖、GitHub Actions、Docker base image 和供应链治理策略。
- `development/support-intake.md`：公开 issue、支持入口、ops support、敏感信息边界和 triage 规则。
- `.codex/skills-src/areaforge-public-maintenance`：公开 issue、贡献者 PR、支持 triage 和敏感信息边界的 Codex 工作流入口。
- `development/maintenance-cadence.md`：日常、每周、每月、Release 和 incident 后的只读维护节奏、证据新鲜度和 residual 复核规则。
- `development/maintenance-window-20260713-weekly-production/maintenance-window.txt`：首个实际周维护窗口记录及其 redacted readiness、evidence bundle、alert preview、residual review 和 preflight 输入；当前结果为 `warn`，不替代 OPS-001、备份或 residual 关闭证据。
- `development/maintenance-window-index.json`：由全部已验证维护窗口记录确定性重建的只读历史投影；每条记录绑定原始文件 SHA256，新增、损坏、重复或 hash 漂移时 validator 失败。
- `development/incident-index.json`：由全部已解决且完成复盘的事故记录确定性重建的只读历史投影；它不表示当前存在或不存在 active incident，也不替代实时信号、事故处置或 residual 关闭。
- `development/external-capability-admission.md`：subagent、MCP、自动化、浏览器控制、部署插件和远程运维工具的准入边界。
- `development/operational-readiness.md`：长期运营 readiness、信号新鲜度、状态降级、离线状态投影、`boundaryStops` 授权边界停止线、只读运营交接摘要、只读运营摘要、证据包和证据包校验入口。
- `development/data-integrity-doctor.md`：只读业务数据完整性 doctor，检查重复活跃计时、task/session 状态矛盾和可选附件 reconciliation summary；不输出对象内容、路径或密钥，也不修复数据。
- `development/production-smoke-alerting-strategy.md`：生产 smoke、写入型 smoke 确认字段、告警阈值和只读告警预览策略。
- `development/production-readonly-smoke-record-template.md`：生产只读 smoke 记录模板和 `pnpm smoke:prod-readonly:validate` 校验入口。
- `development/alert-drill-record-template.md`：告警/恢复演练记录模板、`pnpm alert:drill:validate` 校验入口和 `pnpm ops:ops-004:preflight` 证据预检入口。
- `development/ops-005-expected-before-production-evidence-template.md`：OPS-005 expected-before V2 生产证据模板，以及 `pnpm ops:ops-005:preflight` / `pnpm ops:ops-005:evidence:validate` 只读校验入口。
- `development/incident-record-template.md`：事故记录模板和 `pnpm incident:record:validate` 校验入口；已解决记录进入 `incident-*/incident-record.txt` 后，使用 `pnpm incident:index` / `pnpm incident:index:validate` 重建和校验历史索引。
- `development/rollback-proof-record-template.md`：回滚后证明模板和 `pnpm rollback:proof:validate` 校验入口；只达到人工重新开放评审，不自动开放更新通道或关闭 residual。
- `development/restore-drill-record-template.md`：例行恢复演练记录模板和 `pnpm restore:drill:validate` 校验入口。
- `development/maintenance-window-record-template.md`：维护窗口记录模板，配套 `pnpm maintenance:window:record` 生成入口和 `pnpm maintenance:window:validate` 校验入口。
- `development/update-agent-status-record-template.md`：redacted update-agent status JSON 模板、`pnpm update-agent:status:record` 生成入口和 `pnpm update-agent:status:validate` 校验入口。
- `development/ops-001-closure-packet-template.md`：`AF-RISK-OPS-001` 生产只读 smoke、update-agent status 和 evidence bundle 收口包模板，配套 `pnpm ops:ops-001:preflight`、`pnpm ops:ops-001:closure` / `pnpm ops:ops-001:closure:validate`。
- `development/support-bundle-preview.md`：metadata-only 支持包预览，配套 `pnpm ops:support:bundle-preview` / `pnpm ops:support:bundle-preview:validate`。
- `deployment/backup-restore.md` 中的 `pnpm ops:backup-restore:preview`：备份/恢复 metadata-only 证据预览，分类 root-only backup hash、恢复演练记录和 rollback target 缺口，并输出机器可读 `blockingGaps`；不证明备份存在或授权生产 restore。
- `deployment/backup-restore.md` 中的 `pnpm attachment:reconciliation` / `pnpm attachment:reconciliation:summary:selftest`：附件数据库与私有上传目录双向只读对账，绑定 CSV、summary、file-only/unsafe 计数和 hash；只报告，不清理或修复。
- `development/product-experience-review-record-template.md`：真实产品体验复核记录模板和 `pnpm experience:review:validate` 校验入口。
- `development/product-experience-review-20260710-local.md`：2026-07-10 本地 desktop/mobile 真实体验复核历史记录。
- `development/product-experience-review-v0.1.7-20260712-local.md`：2026-07-12 本地 `0.1.7` desktop/mobile 真实体验复核记录。
- `development/residual-risk-ledger.md`：影响发布、运维、安全、供应链或体验判断的残余风险 ID 台账。
- `development/residual-closure-review-template.md`：residual 人工复核记录模板，配套 `pnpm residuals:closure:validate`；记录本身保持 `closesResidual=no`，不自动修改 residual 台账。
- `development/ci-supply-chain-record-template.md`：`AF-RISK-SC-002` CI-only 供应链记录模板，配套 `pnpm ci:supply-chain:record` / `pnpm ci:supply-chain:validate` 和只读 `pnpm sc:sc-002:preflight`。
- `development/residual-risk-ledger.json`：残余风险 ID 台账的机器可读索引。
- `development/validation-matrix.md`：按改动范围选择验证。
- `development/validation-matrix.md` 中的 `pnpm risk:preflight`：高风险包确认前的只读护栏预检。
- `development/doc-sync-checklist.md`：文档同步和漂移检查。
- `development/feature-traceability.md`：功能项到代码、任务和版本的追踪矩阵。
- `development/structured-state-migration-design.md`：结构化学习状态 migration 确认设计。
- `development/attachment-upload-access-design.md`：附件上传与鉴权访问确认设计。
- `development/ai-provider-integration-design.md`：真实 AI provider 接入确认设计。
- `development/second-stage-long-term-loop-design.md`：第二阶段长期闭环确认设计。
- `development/production-release-runbook.md`：生产发布、备份与恢复确认 runbook。
- `development/release-record-template.md`：后续每个线上版本使用的标准 Release 证据记录模板。
- `development/release-supply-chain-record-template.md`：下一次签名 Release / CI 的 SBOM、provenance、签名和 Actions pinning 证据记录模板。
- `development/github-release-updater-design.md`：GitHub Release 自动更新器设计。
- `development/package-e-e1-release-record-draft.md`：Package E Batch E1 发布记录草案。
- `development/package-e-e2-restore-drill-record.md`：Package E Batch E2 发布前备份与恢复演练记录。
- `development/package-e-e3-prod-local-release-record.md`：Package E Batch E3 本机单机生产发布记录。
- `development/package-e-e3-local-release-record.md`：Package E Batch E3 本地生产模式发布演练记录。
- `development/package-e-e4-prod-local-rollback-record.md`：Package E Batch E4 本机生产回滚收口记录。
- `development/package-e-e4-local-rollback-record.md`：Package E Batch E4 本地回滚演练记录。
- `development/package-e-remote-github-release-record.md`：Package E 远端 GitHub Release 签名发布记录。
- `development/high-risk-confirmation-packets.md`：推进到 100% 前必须确认的高风险执行包。
- `development/docs-100-acceptance-evidence.md`：docs 100% 的最终验收证据矩阵。
- `development/docs-100-completion-record.md`：docs 100% 的当前完成证据台账。

## 部署

- `deployment/operator-onboarding.md`：自托管操作者从 0 部署、生产 env、管理员密码、私有上传、Release 更新器、备份恢复、smoke、告警和残余风险的上手路径。
- `deployment/docker-compose.md`：Docker Compose 策略。
- `deployment/backup-restore.md`：备份与恢复，以及 `pnpm ops:backup-restore:preview` metadata-only 证据预览边界。
- `deployment/github-release-updater.md`：GitHub Release 驱动的服务器侧受控自动更新。

## 安全

- `security/threat-model.md`：第一版威胁模型。
- `security/file-ai-safety.md`：文件上传、附件访问和 AI 调用安全边界。
- 根目录 `SECURITY.md`：安全漏洞私密报告和公开披露边界。
- 根目录 `SUPPORT.md`：公开支持入口、反馈路径和敏感信息禁止清单。
- 根目录 `CODE_REVIEW.md`：代码评审门禁、阻断项和 evidence-first 输出格式。

## 执行与版本

`docs/` 负责源事实，`tasks/` 负责轻量执行拆分，`workflow/` 负责版本规划。若三者冲突，优先级为：

1. `docs/product/**` 与 `docs/architecture/**`
2. `docs/modules/**`、`docs/ux/**`、`docs/development/**`
3. `workflow/versions/**`
4. `tasks/**`
