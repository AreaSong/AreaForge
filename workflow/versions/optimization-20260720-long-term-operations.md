# 2026-07-20 长期运营优化轮（非发布版本计划）

## 当前状态

- 当前版本状态：workspace 保持 `0.1.8`；`v0.1.8` 发布候选计划已由维护者于 2026-07-20 决定搁置，候选链顶点保留在 `codex/long-term-operability` 分支。
- 是否已有线上 Release：生产仍运行签名 Release `v0.1.7` / 应用版本 `0.1.7`。
- 是否需要同步 `docs/**`、`tasks/**`、`workflow/**` 和入口 README：是；本轮改动完成后按 doc-sync-checklist 收口。

## 目标

在不创建 tag、不创建 Release、不触碰生产的前提下，把当前 checkout 推进到"本地可完成的长期运营优化全部闭环"：四路独立审查（安全/代码质量/性能/真实体验）发现并修复本地缺陷，落地轻量文档与分层门禁，重采 current-bound UX 证据，并完成到期 residual 复核登记。

## Planning Gate

- 目标：本地优化闭环 + 到期 residual keep-open 复核 + current-bound UX 证据重采 + 轻量借鉴 AreaMatrix（docs 完整性检查）与 AreaFlow（Prisma 分层边界检查）。
- 非目标：不授权 tag/Release（含搁置的 `v0.1.8`）、生产 backup/migration/deploy/rollout/probe、OPS-001 服务器侧证据采集、residual 关闭决策、OPS-007/OPS-008 实施、v1.1 产品功能、`AREAFORGE_AUTO_APPLY` 策略变化。
- Exact docs：`docs/development/maintenance-cadence.md`、`docs/development/residual-risk-ledger.md`、`docs/development/validation-matrix.md`、`docs/development/doc-sync-checklist.md`、`workflow/versions/v0.1.8-long-term-operability.md`。
- Open questions：无；发布版本号留待未来 Release 决策时再定。
- Decisions：`v0.1.8` 候选搁置（维护者 2026-07-20 决定）；本轮在新分支 `codex/ltops-optimization` 推进；不搬运 AreaMatrix/AreaFlow 平台机制，只借鉴两项轻量检查。
- Owner skill：`areaforge-operating-loop` 编排；安全面 `areaforge-security-governance`，体验面 `areaforge-product-experience` / `areaforge-qa-smoke`，文档面 `areaforge-doc-sync`，验证 `areaforge-validation-driver`。
- Validation profile：常规改动 `pnpm check`；新增 script 附 selftest；docs 改动 `pnpm docs:readiness`；收口 `pnpm ops:readiness` + `pnpm residuals:validate`。
- Source docs：`docs/development/operational-readiness.md`、`docs/development/long-term-operability-control-plane.md`。
- Source baseline：`codex/long-term-operability` 分支顶点（`978af8e`）。
- Residual risk IDs：`AF-RISK-OPS-001`、`AF-RISK-SC-004`、`AF-RISK-OPS-005`（到期 keep-open 复核）；`AF-RISK-UX-001`（重采承接 `tasks/active/0024`）；审查新发现如构成残余风险则新增登记。
- Release trigger：本轮不触发；任何未来签名 Release 仍需用户以真实 40 位候选提交明确确认。
- Apply boundary：仅本地仓库写入与本地 runtime 验证；不进入生产。
- Evidence freshness：UX 证据必须绑定本轮最终代码提交；复核记录绑定 2026-07-20。
- 验证：`pnpm check`、`pnpm docs:readiness`、`pnpm ops:readiness`、`pnpm residuals:validate`、`pnpm residuals:closure:validate <records>`、新增检查的 selftest、`pnpm experience:review:validate <fresh review>`。
- 回滚：仅回滚本轮提交（分支删除或 revert）；不涉及生产回滚。

## 范围

- 到期 residual 复核：`AF-RISK-OPS-001` / `AF-RISK-SC-004` / `AF-RISK-OPS-005` keep-open 记录与台账 reviewAt 顺延。
- 四路独立审查：安全与边界、代码质量与架构分层、性能与数据层、真实产品体验；修复其中阻塞级与可控高价值发现。
- 轻量借鉴：docs 链接完整性自动检查（AreaMatrix 风格）、Prisma 分层边界静态检查（AreaFlow 风格），均含 selftest。
- `AF-RISK-UX-001` current-bound UX 重采：fresh desktop/mobile 旅程 + runtime probe + validator 通过。
- 文档同步与收尾快照：AGENTS/README/workflow/operational-readiness/tasks 状态、`ops:status` / `ops:handoff` 快照。

## 不包含

- 签名 Release、生产 rollout、controlled probe、服务器侧证据采集、residual 关闭、OPS-007/OPS-008、v1.1 功能、依赖大版本升级、GitHub Actions 扫描类新增（Trivy/CodeQL 等留待独立提案）。

## 入口条件

- 分支 `codex/ltops-optimization` 自 `978af8e` 创建；工作区干净。

## 验收标准

- 功能证据：审查发现清单与修复对应提交；新增检查脚本 selftest 通过。
- 文档同步：AGENTS/workflow README/v0.1.8 计划搁置标注/operational-readiness 相关入口一致。
- 验证命令：`pnpm check`、`pnpm docs:readiness`、`pnpm ops:readiness`、`pnpm residuals:validate` 全部通过。
- 发布证据：不适用（本轮不发布）。
- 残余风险：三份 keep-open 复核记录通过 `residuals:closure:validate`；UX-001 fresh 证据通过 `experience:review:validate`；新发现残余风险已登记。

## 退出条件

- 上述验收标准全部满足，改动以干净提交推入 `codex/ltops-optimization`；不创建 tag，不部署。
- `docs/development/feature-traceability.md` 如受影响已同步。

## 运维边界

- Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令。
- 自动更新只能通过受控请求或服务器侧 updater 执行。

## 风险

- 影响：本地代码、脚本与文档；不影响生产。
- 风险：审查修复可能引入回归；靠 `pnpm check` 全量门禁与 Bugbot 复审兜底。
- 验证：见 Planning Gate 验证条目。
- 回滚：revert 本轮提交或废弃分支即可完全回退。
