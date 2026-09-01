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
- `versions/v0.1.8-long-term-operability.md`：OPS-005/006、长期证据和体验加固的本地发布候选；维护者已于 2026-07-20 决定搁置，范围由 v0.1.9 计划承接。
- `versions/optimization-20260720-long-term-operations.md`：2026-07-20 长期运营优化轮（非发布版本计划，已完成）：到期 residual 复核、四路独立审查修复、轻量门禁借鉴与 UX 证据重采。
- `versions/v0.1.9-long-term-operations-release.md`：v0.1.9 发布环重启：承接 v0.1.8 候选范围 + 优化轮成果，走签名 Release、生产受控更新与残余项证据重采。
- `versions/v1.1-learning-action-center.md`：学习行动中心与闭环体验；`v1.1.0` 与发布后修复 `v1.1.1` 均已发布并完成受控 production apply，`v1.1.2` 已形成稳定 Release 但尚未执行 production apply。
- `versions/v1.2-high-density-workbench.md`：高密度专业工作台、Dynamic Island、错题 v2 和 Web 共享治理的 `v1.2.0` 发布候选；第一阶段已完成本地验证、PR、CI 与 squash 合并，tag、Release 或 production apply 仍未授权。

当前进度快照（详情以各版本计划的状态标头为准）：

- 最新稳定 GitHub Release 为 `v1.1.2` / commit `5df38417b701f3511d06db235c5b94755ca03aba`；生产与回滚基线仍为 `v1.1.1` / commit `f995310e30c41270ee1e0a1c1ceeae9b6a8017eb`。
- 仓库 package version 为 `1.2.0`；PR #49 的产品代码已 squash 合并为 commit `c8b5acf241bcaada59c6b469fd562d4fe400d521`，PR CI run `33505174259` 与该 commit 的 main push CI run `33506280124` 均成功，PR #51 已完成合并状态文档收口。尚未创建 `v1.2.0` tag 或 Release；后续 tag 目标必须在独立确认时 fresh readback 当前 main HEAD，本阶段不包含 production apply。
- `versions/v1.1-learning-action-center.md` 的发布后修复已完成 SC-002/SC-004、browser/compatibility、受保护 PR、Release 资产校验和 Web 受控 production apply。更新后 Web/PostgreSQL healthy、migration 24/24、health/extra smoke PASS、journal clean；`AREAFORGE_AUTO_APPLY=none` 与 residual 状态未改变。
- 离线运营状态用 `pnpm ops:status --summary` 查看，交接摘要用 `pnpm ops:handoff --summary`；生产运营证据与残余项以 `docs/development/operational-readiness.md` 和 `docs/development/residual-risk-ledger.md` 为入口。
- 长期运营控制面以 `docs/development/long-term-operability-control-plane.md` 为总入口。

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
