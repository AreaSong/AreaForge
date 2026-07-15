# Tasks

`tasks/` 只记录轻量执行事项，不替代 `docs/` 中的产品、架构和模块源事实。

## 目录

- `active/`：当前正在推进或下一步马上要做的任务。
- `backlog/`：已确认但暂不执行的任务。
- `done/`：已完成任务归档。
- `indexes/`：执行索引，如长期运营残余项的 task-facing 视图。
- `templates/`：任务模板。

当前进度：Package A-E 和 docs 100% 当前证据已完成；`backlog/` 中保留的跨批次任务是稳定入口或未来增强承接，不代表对应主线仍未完成。`tasks/active/0019-update-request-expected-before-binding.md` 已完成本地 V2 韧性实现，等待签名 Release 与独立生产部署；`tasks/active/0020-business-state-concurrency.md` 跟踪新识别的 active-session uniqueness、task/session CAS 和结束计时单次副作用，尚待高风险确认。只读 `ops:data-integrity:doctor` 已实现并进入长期 live gate，但它不修复数据。长期运营 residual 以 `docs/development/residual-risk-ledger.md` 为准；当前 OPS-001、OPS-005、OPS-006 是 current blocker，OPS-007/008 分别承接附件崩溃窗口和 updater phase journal/hold-drain。

## 使用规则

- 一个任务只描述一个清晰目标。
- 新任务默认从 `tasks/templates/task-template.md` 复制，并保留轻量 YAML frontmatter：`status`、`risk`、`ownerSkill`、`validation`、`residualRiskIds` 和 `releaseRequired`。
- 涉及高风险边界时，先在任务中写清影响、风险、验证和回滚。
- 完成任务后移动到 `done/`，并保留验证结果。
- 历史高风险确认包或跨批次承接任务可保留在 `backlog/` 作为稳定入口，但文件内必须写清真实状态、已完成范围和后续承接包。
- 若任务与 `docs/` 冲突，先更新 `docs/`，再执行任务。
- 后续功能更新若进入线上，任务记录必须同步 GitHub Release tag、线上 health、镜像 digest、update-agent 状态和残余风险。
- 影响长期运营的任务必须写明 owner skill、只读验收、证据新鲜度、关闭条件、完成证据等级和残余风险 ID。
