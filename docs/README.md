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
- `development/long-term-operability-control-plane.md` 中的 `pnpm ops:long-term:gate`：长期运营完成声明前的严格 live evidence gate，集中校验 OPS-001、OPS-004、签名 Release 供应链和新鲜 UX 记录。
- `development/release-train.md`：功能进入线上时的版本、GitHub Release、签名资产、updater、smoke、回滚目标、发布记录和残余风险固定路径。
- `development/completion-evidence-checklist.md`：完成声明证据清单，区分 docs、本地 smoke、浏览器复核、Release 和生产证据；`pnpm completion:evidence:validate <record>` 只校验完成声明记录形态，不替代真实运行、Release、生产 smoke 或长期运营 live gate。
- `development/runtime-write-boundary.md`：R0-R4 运行时写动作边界矩阵，区分只读、本地写、用户显式 Web 写、update request 和高风险生产操作。
- `development/dependency-policy.md`：依赖、GitHub Actions、Docker base image 和供应链治理策略。
- `development/support-intake.md`：公开 issue、支持入口、ops support、敏感信息边界和 triage 规则。
- `.codex/skills-src/areaforge-public-maintenance`：公开 issue、贡献者 PR、支持 triage 和敏感信息边界的 Codex 工作流入口。
- `development/maintenance-cadence.md`：日常、每周、每月、Release 和 incident 后的只读维护节奏、证据新鲜度和 residual 复核规则。
- `development/external-capability-admission.md`：subagent、MCP、自动化、浏览器控制、部署插件和远程运维工具的准入边界。
- `development/operational-readiness.md`：长期运营 readiness、信号新鲜度、状态降级、离线状态投影、只读运营交接摘要、只读运营摘要、证据包和证据包校验入口。
- `development/production-smoke-alerting-strategy.md`：生产 smoke、写入型 smoke 确认字段、告警阈值和只读告警预览策略。
- `development/production-readonly-smoke-record-template.md`：生产只读 smoke 记录模板和 `pnpm smoke:prod-readonly:validate` 校验入口。
- `development/alert-drill-record-template.md`：告警/恢复演练记录模板、`pnpm alert:drill:validate` 校验入口和 `pnpm ops:ops-004:preflight` 证据预检入口。
- `development/incident-record-template.md`：事故记录模板和 `pnpm incident:record:validate` 校验入口。
- `development/restore-drill-record-template.md`：例行恢复演练记录模板和 `pnpm restore:drill:validate` 校验入口。
- `development/maintenance-window-record-template.md`：维护窗口记录模板，配套 `pnpm maintenance:window:record` 生成入口和 `pnpm maintenance:window:validate` 校验入口。
- `development/update-agent-status-record-template.md`：redacted update-agent status JSON 模板、`pnpm update-agent:status:record` 生成入口和 `pnpm update-agent:status:validate` 校验入口。
- `development/ops-001-closure-packet-template.md`：`AF-RISK-OPS-001` 生产只读 smoke、update-agent status 和 evidence bundle 收口包模板，配套 `pnpm ops:ops-001:preflight`、`pnpm ops:ops-001:closure` / `pnpm ops:ops-001:closure:validate`。
- `development/support-bundle-preview.md`：metadata-only 支持包预览，配套 `pnpm ops:support:bundle-preview` / `pnpm ops:support:bundle-preview:validate`。
- `development/product-experience-review-record-template.md`：真实产品体验复核记录模板和 `pnpm experience:review:validate` 校验入口。
- `development/product-experience-review-20260710-local.md`：2026-07-10 本地 desktop/mobile 真实体验复核记录。
- `development/residual-risk-ledger.md`：影响发布、运维、安全、供应链或体验判断的残余风险 ID 台账。
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
- `deployment/backup-restore.md`：备份与恢复。
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
