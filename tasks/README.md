# Tasks

`tasks/` 只记录轻量执行事项，不替代 `docs/` 中的产品、架构和模块源事实。

## 目录

- `active/`：当前正在推进或下一步马上要做的任务。
- `backlog/`：已确认但暂不执行的任务。
- `done/`：已完成任务归档。
- `indexes/`：执行索引，如长期运营残余项的 task-facing 视图。
- `templates/`：任务模板。

当前进度：仓库 package 已同步为 `0.1.8` 本地发布候选，生产仍运行 `0.1.7`；候选仍需干净提交、匹配 CI 和独立签名 Release 确认。Package A-E 和 docs 100% 当前证据已完成；`backlog/` 中保留的跨批次任务是稳定入口或未来增强承接，不代表对应主线仍未完成。`tasks/active/0019-update-request-expected-before-binding.md` 已完成本地 V2 韧性实现，等待签名 Release 与独立生产部署；`tasks/active/0020-business-state-concurrency.md` 已完成 active-session uniqueness、task/session CAS、结束计时单次副作用和 CheckIn 锁的隔离 PostgreSQL `local_verified`，独立 production validator/preflight 已实现，仍等待 matching signed Release、分别确认的基础 rollout/controlled probe 和生产证据；`tasks/active/0024-ux-residual-closure-review.md` 承接 current checkout-bound desktop/mobile review、runtime probe 和后续维护者 close/keep-open 复核，不自动修改台账。SC-004 远端 main ruleset/readback/受控 PR 已验证，仍等待人工 residual 决策。长期运营 residual 以 `docs/development/residual-risk-ledger.md` 为准；SC-002 已按 exact commit `5bec626` 的成功 CI-only 证据关闭，SC-001 保持开启；当前 current blocker 为 OPS-001、SC-004、OPS-005、OPS-006，UX-001 最新记录当前为 `invalid`，需重采 current-bound 本地证据后再进入人工复核，且本地证据不证明生产体验；OPS-007/008 分别承接附件崩溃窗口和 updater phase journal/hold-drain。

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
