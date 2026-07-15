# Tasks

`tasks/` 只记录轻量执行事项，不替代 `docs/` 中的产品、架构和模块源事实。

## 目录

- `active/`：当前正在推进或下一步马上要做的任务。
- `backlog/`：已确认但暂不执行的任务。
- `done/`：已完成任务归档。
- `indexes/`：执行索引，如长期运营残余项的 task-facing 视图。
- `templates/`：任务模板。

当前进度：Package A-E 和 docs 100% 当前证据已完成；`backlog/` 中保留的跨批次任务是稳定入口或未来增强承接，不代表对应主线仍未完成。`done/` 中记录已完成的单点任务和 GitHub Release updater。当前远端 `v0.1.7` 发布与 update-agent/updater 状态见 `docs/development/release-v0.1.7-record.md`、`tasks/done/0018-github-release-updater.md` 和 `tasks/backlog/0014-deployment-backup-release.md`；`tasks/active/0019-update-request-expected-before-binding.md` 已完成本地 V2 请求契约、共享锁、processing reconciliation 和零副作用自测，当前等待匹配提交的签名 Release 与独立生产部署确认。长期运营残余项以 `docs/development/residual-risk-ledger.md` 的 ID 为准，执行视图见 `tasks/indexes/residuals.md`。维护窗口历史投影见 `docs/development/maintenance-window-index.json`；已解决事故历史投影见 `docs/development/incident-index.json`。两者都由源记录完整重建，不是 task index、执行队列或实时事故状态。当前 `v0.1.7` 长期证据快照仍为 `needs_live_evidence`，缺 post-update OPS-001 redacted smoke/status/evidence bundle/closure packet 和 `releaseEvidenceBundleHash` / release evidence backup hash；OPS-004 matching alert drill/preflight 已达到 `ready_for_human_close` 但未关闭 residual；维护或线程交接先用 `pnpm ops:handoff --summary` 查看只读摘要。若维护者形成 residual 复核结论，先用 `docs/development/residual-closure-review-template.md` 和 `pnpm residuals:closure:validate <record>` 固定记录；该记录不自动关闭台账。

## 使用规则

- 一个任务只描述一个清晰目标。
- 新任务默认从 `tasks/templates/task-template.md` 复制，并保留轻量 YAML frontmatter：`status`、`risk`、`ownerSkill`、`validation`、`residualRiskIds` 和 `releaseRequired`。
- 涉及高风险边界时，先在任务中写清影响、风险、验证和回滚。
- 完成任务后移动到 `done/`，并保留验证结果。
- 历史高风险确认包或跨批次承接任务可保留在 `backlog/` 作为稳定入口，但文件内必须写清真实状态、已完成范围和后续承接包。
- 若任务与 `docs/` 冲突，先更新 `docs/`，再执行任务。
- 后续功能更新若进入线上，任务记录必须同步 GitHub Release tag、线上 health、镜像 digest、update-agent 状态和残余风险。
- 影响长期运营的任务必须写明 owner skill、只读验收、证据新鲜度、关闭条件、完成证据等级和残余风险 ID。
