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
- `development/validation-matrix.md`：按改动范围选择验证。
- `development/validation-matrix.md` 中的 `pnpm risk:preflight`：高风险包确认前的只读护栏预检。
- `development/doc-sync-checklist.md`：文档同步和漂移检查。
- `development/feature-traceability.md`：功能项到代码、任务和版本的追踪矩阵。
- `development/structured-state-migration-design.md`：结构化学习状态 migration 确认设计。
- `development/attachment-upload-access-design.md`：附件上传与鉴权访问确认设计。
- `development/ai-provider-integration-design.md`：真实 AI provider 接入确认设计。
- `development/second-stage-long-term-loop-design.md`：第二阶段长期闭环确认设计。
- `development/production-release-runbook.md`：生产发布、备份与恢复确认 runbook。
- `development/package-e-e1-release-record-draft.md`：Package E Batch E1 发布记录草案。
- `development/package-e-e2-restore-drill-record.md`：Package E Batch E2 发布前备份与恢复演练记录。
- `development/package-e-e3-prod-local-release-record.md`：Package E Batch E3 本机单机生产发布记录。
- `development/package-e-e3-local-release-record.md`：Package E Batch E3 本地生产模式发布演练记录。
- `development/package-e-e4-prod-local-rollback-record.md`：Package E Batch E4 本机生产回滚收口记录。
- `development/package-e-e4-local-rollback-record.md`：Package E Batch E4 本地回滚演练记录。
- `development/high-risk-confirmation-packets.md`：推进到 100% 前必须确认的高风险执行包。
- `development/docs-100-acceptance-evidence.md`：docs 100% 的最终验收证据矩阵。
- `development/docs-100-completion-record.md`：docs 100% 的当前完成证据台账。

## 部署

- `deployment/docker-compose.md`：Docker Compose 策略。
- `deployment/backup-restore.md`：备份与恢复。

## 安全

- `security/threat-model.md`：第一版威胁模型。
- `security/file-ai-safety.md`：文件上传、附件访问和 AI 调用安全边界。

## 执行与版本

`docs/` 负责源事实，`tasks/` 负责轻量执行拆分，`workflow/` 负责版本规划。若三者冲突，优先级为：

1. `docs/product/**` 与 `docs/architecture/**`
2. `docs/modules/**`、`docs/ux/**`、`docs/development/**`
3. `workflow/versions/**`
4. `tasks/**`
