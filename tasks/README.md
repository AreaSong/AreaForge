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
- 学习行动中心阶段包见 `docs/development/v11-phase-packages.md`；Batch 0 任务 `tasks/active/0025-v11-batch0-doc-sync.md`，Batch 3–10 已完成见 `tasks/done/0027-*` 至 `0034-*`，Batch 11 正在 `tasks/active/0035-v11-batch11-minor-release.md` 准备本地候选，Batch 1–2 历史复核入口保留在 `tasks/backlog/0026-*`。
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
