# Workflow

`workflow/` 记录版本级推进方式，不替代 `docs/product/roadmap.md`。

## 目录

- `versions/`：版本计划和验收标准。
- `templates/`：版本计划模板。
- `references/`：流程参考资料。

## 当前版本路线

- `versions/v0.1-mvp.md`：前置主闭环。
- `versions/v0.2-first-version-risk-closures.md`：完整第一版高风险闭环。
- `versions/v0.3-structured-learning-state.md`：结构化学习状态。
- `versions/v0.4-second-stage-long-term-loop.md`：第二阶段长期闭环。
- `versions/v1.0-prod-release.md`：生产发布闭环。
- `versions/v1.1-learning-action-center.md`：学习行动中心与闭环体验，当前处于待开发讨论中（Planning），尚未实施。

当前进度：v0.1 到 v1.0 对应的当前 docs 100% 证据已闭环，表示当前产品范围中的所有非暂缓项已有实现和验证证据，不表示未来功能、跨页面体验或长期运营证据已经永久完整。Package A-E 均已完成，远端 `https://forge.areasong.top/` 已通过 GitHub Release `v0.1.7` 签名更新运行 `0.1.7`。`v1.1` 当前只是下一阶段产品体验计划，目标是把已有任务、计时、考纲、笔记、错题、复习提醒和报告组织成连续行动闭环，尚未进入业务代码实施，不能计入现有 docs 完成声明。当前 `v0.1.7` 长期证据快照仍为 `needs_live_evidence`，缺 post-update OPS-001 redacted smoke/status/evidence bundle/closure packet 和 `releaseEvidenceBundleHash` / release evidence backup hash；OPS-004 matching alert drill/preflight 已达到 `ready_for_human_close` 但未关闭 residual。`tasks/active/0019-update-request-expected-before-binding.md` 的本地 V2 请求契约已实现并通过本地门禁，下一阶段是匹配提交的签名 Release，之后再单独确认生产 timer/队列/Web/agent 部署与 redacted evidence。后续版本计划用于承接新功能、生产 extra smoke、自动策略调整或未来服务器/域名迁移。长期运营控制面以 `docs/development/long-term-operability-control-plane.md` 为总入口，离线运营状态投影用 `pnpm ops:status --summary` 快速查看或 `pnpm ops:status` 生成 JSON，维护或线程交接摘要用 `pnpm ops:handoff --summary` 快速查看或 `pnpm ops:handoff` 生成 JSON，生产运营证据以 `docs/development/operational-readiness.md` 和 `docs/development/residual-risk-ledger.md` 为入口。

## 使用规则

- 一个版本计划必须说明目标、范围、不包含、验收标准和退出条件。
- 新版本计划默认从 `workflow/templates/version-template.md` 复制，并先填 Planning Gate：目标、非目标、Exact docs、open questions、decisions、owner skill、validation profile、source docs/source baseline、residual IDs、release trigger、apply boundary、验证和回滚。
- 版本计划只描述阶段，不承载具体实现细节。
- 具体执行事项拆到 `tasks/**`。
- 每次功能发布后必须同步对应 release tag、验证结果、线上 health、update-agent 状态和残余风险。
- 发布或运维状态变化时必须同步 ops readiness、残余风险 ID 和 release workflow 证据。
- 功能进入线上前先按 `docs/development/release-train.md` 固定版本、Release 资产、验证、updater、smoke、回滚目标和发布记录证据。
- 日常维护和 residual 到期复核按 `docs/development/maintenance-cadence.md` 执行；readiness/preview/evidence bundle 不等于 apply，也不能单独关闭 residual。维护者形成 close / keep-open / downgrade / reopen 结论时，先保存 `docs/development/residual-closure-review-template.md` 格式记录并运行 `pnpm residuals:closure:validate <record>`；该记录保持 `closesResidual=no`。
- 周/月维护窗口、incident、恢复演练或 update-agent redacted status 进入仓库记录时，使用 `docs/development/maintenance-window-record-template.md`、`docs/development/incident-record-template.md`、`docs/development/restore-drill-record-template.md` 或 `docs/development/update-agent-status-record-template.md` 并运行对应 validator。新增维护窗口后完整重建并校验 `docs/development/maintenance-window-index.json`；任何通过校验的事故记录进入固定目录后，完整重建并校验 `docs/development/incident-index.json`，由索引分入 `active` 或 `resolved`。两个索引都只用于浏览和完整性检查，不进入版本执行或实时事故处置。
