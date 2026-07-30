# v1.1 Batch 11 完整 minor Release

```yaml
status: in-progress
phase: implementation
blockers:
  - frozen-commit-24-migration-compatibility-floor-rebind
  - frozen-commit-production-mode-browser-recapture
  - current-completion-evidence
  - matching-sc-002-sc-004
  - signed-release-confirmation
risk: high
ownerSkill: areaforge-release-operator
validation:
  - pnpm ops:v11:ai-provider-preference:selftest
  - pnpm ops:v11:browser-evidence:selftest
  - pnpm experience:review:selftest
  - pnpm release:v11:admission:selftest
  - pnpm release:closeout:binding:selftest
  - pnpm ops:v11:compatibility-floor:manifest:selftest
  - pnpm ops:v11:compatibility-floor:orchestrate
  - pnpm release:train:preflight
  - pnpm governance:preflight
  - pnpm check
residualRiskIds:
  - AF-RISK-SC-002
  - AF-RISK-SC-004
  - AF-RISK-DATA-001
releaseRequired: true
```

## 目标

本地完成记录与完整验证候选 → complete minor Release admission → 签名 minor Release。生产 backup/migration/apply/smoke/rollback 分别确认。不自动关闭 residual。

## 当前执行范围

- 目标版本：`1.1.0`。
- 已确认前置：Batch 10 完成；完整 Migration Gate 与 OPS-006/007 independent production apply 证据齐全。
- 当前 pre-freeze 本地候选已通过 `pnpm check`、24-migration compatibility floor、production-mode 18 条旅程（9×desktop/mobile）和 24 项独立无障碍记录；本任务文件所在提交冻结为目标 source commit，compatibility/browser 证据仍须按该提交重采，current-bound completion evidence 也尚未生成。
- 2026-07-29 已按独立高风险确认补齐外部 Provider 当前浏览器默认关闭偏好：`/settings/ai` 确认保存、鉴权偏好 API 和八条既有 AI POST route 统一 gate 已在隔离候选实现并完成专项 API/桌面/移动验收；未使用真实生产 key，未新增 migration 或 AI history/cost/trace。
- 2026-07-30 已按独立精确确认完成 dirty worktree 本地浏览器重采：全新 PostgreSQL 16 空库顺序应用 24 条 migration，创建 18 个旅程账号与 1 个无障碍账号，18/18 journey、24/24 accessibility 及两份正式 validator 均通过；候选证据位于 `output/playwright/v11-browser-evidence-20260730-runnerfix-test39/`。
- 本轮浏览器重采只证明隔离本地 production-build 候选；目标 commit 冻结后仍须在新空库重采，不得复用已写入 fixture 的 test39 数据库或把 dirty-worktree 证据用于 Release admission。
- SC-002/SC-004 必须按本任务文件所在 source commit 及其合法 evidence-only closeout 重采；`v0.1.9` 或更早证据不得替代。
- 签名 Release 确认句、tag、GitHub Release、生产 backup/migration/apply/smoke/rollback 均不在当前授权内。
- `AREAFORGE_AUTO_APPLY=none` 保持不变；任何 residual 状态都不自动关闭。
- `docs/development/v11-compatibility-floor-evidence-20260722.md` 只绑定历史 20-migration 候选。当前 24-migration 入口是 `docs/development/v11-compatibility-floor-evidence-20260727.md`，在扩展确认与新鲜编排通过前保持 pending；签名 Release 仍须另行固定 floor image digest。
- 2026-07-22 的历史 CI/SC 证据只证明当时提交；当前工作树已经增加草稿恢复、报告返回、smoke 与治理门禁修复，不能沿用旧 `READY-FOR-SIGNED-RELEASE` 判定。目标 commit 冻结后必须重新取得 matching CI 与 SC-002/SC-004 exact-commit 证据。

## Admission 判定

complete minor Release admission 达到 `READY-FOR-SIGNED-RELEASE` 前，以下输入必须匹配同一最终 evidence-only 候选 commit：

- Product Experience 记录直接绑定并通过 `v11-browser-journey-evidence-v1`（9 journey × desktop/mobile）；
- 独立无障碍记录直接绑定并通过 `v11-accessibility-evidence-v1`（24 项检查及 observation artifact）；
- SC-002 CI-only 或签名 Release 供应链证据重采并通过对应 validator；
- SC-004 main protection readback 与 controlled PR 证据重采并通过 validator；
- package version 与候选 commit 身份一致，且本地 Release train / governance 门禁通过。

当前状态是本地重验中，不构成完成或 Release admission。后续 commit、push、matching CI、SC-002/SC-004、受控 PR、tag、GitHub Release、production apply、backup/restore、migration deploy、updater apply/rollback 或 residual ledger update，均须按对应边界另行授权；签名 Release 必须另贴明确确认句后才可执行。
