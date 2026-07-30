# v1.1 Batch 11 完整 minor Release

```yaml
status: in-progress
phase: implementation
blockers:
  - migration-21-24-local-confirmation
  - current-24-migration-compatibility-floor
  - current-production-mode-nine-journey-ux
  - current-completion-evidence
  - target-commit-freeze
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
- 当前正在按 v1.1 验收合同逐功能重验并补缺；`pnpm check` 与 M6/Task runtime 已新鲜通过，但 24-migration compatibility floor、production-mode 九条旅程、独立无障碍记录和 current-bound completion evidence 尚未全部重采。
- 2026-07-29 已按独立高风险确认补齐外部 Provider 当前浏览器默认关闭偏好：`/settings/ai` 确认保存、鉴权偏好 API 和八条既有 AI POST route 统一 gate 已在隔离候选实现并完成专项 API/桌面/移动验收；未使用真实生产 key，未新增 migration 或 AI history/cost/trace。
- 2026-07-29 已完成结构化浏览器证据 contract/runner/validator 与 v1.1 admission 直接绑定：Product Experience 的 18 条 journey JSON、独立无障碍的 24 项 JSON、nested hash/schema/source/final-reread，以及 evidence-only 精确白名单均有负向 selftest；这只完成采集基础设施，不代表真实 production-mode 旅程已重采。
- 真实浏览器重采会在隔离 PostgreSQL 上执行现有 24 条 migration（若目标库尚未升级）、创建 18 个旅程账号与 1 个无障碍账号，并运行写入型页面 mutation；当前 AI Provider 确认不授权这些数据库动作，执行前必须取得独立精确确认。
- 候选 commit 冻结后，SC-002/SC-004 必须按该 commit 重采；`v0.1.9` 或更早证据不得替代。
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
