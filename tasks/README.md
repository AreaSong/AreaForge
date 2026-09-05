# Tasks

`tasks/` 只记录轻量执行事项，不替代 `docs/` 中的产品、架构和模块源事实。

## 目录

- `active/`：当前正在推进或下一步马上要做的任务。
- `backlog/`：已确认但暂不执行的任务。
- `done/`：已完成任务归档。
- `indexes/`：执行索引，如长期运营残余项的 task-facing 视图。
- `templates/`：任务模板。

当前进度快照（逐任务状态以各任务文件 frontmatter 为准）：

- 各任务的真实状态、阻塞点和等待条件写在任务文件的 `status`、`phase` 和 `blockers` 字段里，用 `pnpm tasks:doctor` 校验；`backlog/` 中保留的跨批次任务是稳定入口或未来增强承接，不代表对应主线仍未完成。
- 学习行动中心阶段包见 `docs/development/v11-phase-packages.md`；Batch 0 任务 `tasks/active/0025-v11-batch0-doc-sync.md`，Batch 3–10 已完成见 `tasks/done/0027-*` 至 `0034-*`，`v1.1.0` 与 Batch 11 的 `v1.1.1` 修复 Release/production apply 均已完成。`tasks/active/0035-v11-batch11-minor-release.md` 已完成 `v1.1.2` 稳定 Release，继续保留 production apply 的独立确认边界；Batch 1–2 历史复核入口保留在 `tasks/backlog/0026-*`。
- 响应式布局系统与 49 条 canonical 页面迁移由 `tasks/active/0036-responsive-layout-system.md` 承接；响应式 R1-R6 保留历史 local-verified 证据，共享能力 G0-G5、复杂异步一致性 B6、当前 checkout 的 G6 浏览器证据与文档同步 G7 已完成。G6 当前证据为 v2 responsive/governance artifact 与 pair validator 结果，详见任务文件；旧 `responsive-r6` 截图不计入 G6。本地收口不改变既有功能完成、Release 或 production apply 状态。
- `v1.2.0` 发布准备第一阶段已由 `tasks/done/0037-v12-release-preparation.md` 完成；第二阶段已从 fresh readback 的 `main` commit 创建 annotated tag、完成 Release workflow 和 strict 供应链资产校验，证据见 `docs/development/release-v1.2.0-record.md` 与 `docs/development/release-supply-chain-v1.2.0.md`。production apply 仍需后续独立确认。
- A -> B 平台演进的 M0 已归档到 `tasks/done/0038-platform-evolution-m0.md`，`tasks/active/0039-personal-dynamic-foundation.md` 正等待 v1.3 独立 Release/production disposition；`tasks/active/0040-multi-user-rbac.md` 已获 v1.4 本地实施确认并进入最终验证。后续按版本依次由 `0044`（v1.5 RBAC/隐私/协作）、`0041`（v1.6 数据生命周期）、`0042`（v1.7 受控运维）、`0043`（v1.8 挑战排名）、`0045`（v1.9 平台加固）和 `0046`（v2.0 综合门禁）承接。任务进入 active 或总体路线获同意都不等于已经获得后续权限包、生产 migration/apply、数据删除或 Release 授权。
- 长期运营 residual 以 `docs/development/residual-risk-ledger.md` 为准，task-facing 视图见 `indexes/residuals.md`；current blocker、accepted exception 和逐项证据状态以台账为源事实。
- 仓库候选版本与生产基线见根 README 状态节和 `docs/development/operational-readiness.md`。

## 使用规则

- 一个任务只描述一个清晰目标。
- 新任务默认从 `tasks/templates/task-template.md` 复制，并保留轻量 YAML frontmatter：`status`、`risk`、`ownerSkill`、`validation`、`residualRiskIds` 和 `releaseRequired`。
- `status` 只使用目录对应的稳定生命周期值；等待高风险确认、签名 Release 或生产证据写入 `phase` 和 `blockers`。运行 `pnpm tasks:doctor` 校验 metadata、目录状态、owner skill、validation、residual ID 和 releaseRequired。
- 涉及高风险边界时，先在任务中写清影响、风险、验证和回滚。
- 完成任务后移动到 `done/`，并保留验证结果。
- 历史高风险确认包或跨批次承接任务可保留在 `backlog/` 作为稳定入口，但文件内必须写清真实状态、已完成范围和后续承接包。
- 若任务与 `docs/` 冲突，先更新 `docs/`，再执行任务。
- 后续功能更新若进入线上，任务记录必须同步 GitHub Release tag、线上 health、镜像 digest、update-agent 状态和残余风险。
- 影响长期运营的任务必须写明 owner skill、只读验收、证据新鲜度、关闭条件、完成证据等级和残余风险 ID。
- residual schema V2 的 `taskRefs` 与任务 YAML `residualRiskIds` 必须双向一致；`executableNow=true` 只能由 active task 或有效的 `taskPromotionWaiver` 支撑。当前所有 waiver 均为 `null`。
- `acceptedException` 只记录已有、可追溯且未过期的接受事实，不替代任务、不授权执行，也不得由任务状态或 validator 结果自动生成。
