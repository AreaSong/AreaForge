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
- `versions/v0.1.8-long-term-operability.md`：OPS-005/006、长期证据和体验加固的本地发布候选；维护者已于 2026-07-20 决定搁置，不授权 tag、Release 或生产 rollout。
- `versions/optimization-20260720-long-term-operations.md`：2026-07-20 长期运营优化轮（非发布版本计划）：到期 residual 复核、四路独立审查修复、轻量门禁借鉴与 UX 证据重采。
- `versions/v1.1-learning-action-center.md`：学习行动中心与闭环体验，当前处于待开发讨论中（Planning），尚未实施。

当前进度快照（详情以各版本计划的状态标头为准）：

- 当前推进 `versions/optimization-20260720-long-term-operations.md` 优化轮；`v0.1.8` 发布候选已搁置，未创建 tag、GitHub Release 或生产 rollout。
- 离线运营状态用 `pnpm ops:status --summary` 查看，交接摘要用 `pnpm ops:handoff --summary`；生产运营证据与剩余缺口（含 `needs_live_evidence`、post-update OPS-001、release evidence backup hash 等）以 `docs/development/operational-readiness.md` 和 `docs/development/residual-risk-ledger.md` 为入口。
- 长期运营控制面以 `docs/development/long-term-operability-control-plane.md` 为总入口；后续版本计划用于承接新功能、生产 extra smoke、自动策略调整或服务器/域名迁移。

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
