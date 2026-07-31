# v1.1 Batch 11 完整 minor Release

```yaml
status: in-progress
phase: implementation
blockers:
  - post-release-product-hardening-commit
  - current-bound-browser-compatibility-sc-002-sc-004
  - repair-release-admission-and-confirmation
risk: high
ownerSkill: areaforge-release-operator
validation:
  - pnpm ops:v11:ai-provider-preference:selftest
  - pnpm ops:v11:workspace-first-use:selftest
  - AREAFORGE_V11_M1M3_ISOLATED_DB=1 pnpm ops:v11:m1m3:runtime:selftest
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

完成 `v1.1.0` 发布后的产品化修复、生产合成数据收口和 22 个主要入口复验，再按新目标 commit 重新完成修复 Release admission。修复 Release 与 production apply 分别确认，不自动关闭 residual。

## 当前执行范围

- `v1.1.0` annotated tag、稳定 GitHub Release 和 production apply 已完成；公网 health 当前报告 `1.1.0` / commit `4dbdb31a96498487af09aa7f90275bfc549448f3`。Release 资产包含 manifest、SBOM、provenance、checksum 与签名文件；tag 本身没有 GPG signature。
- 发布后产品化修复候选已完成首次设置接管冲突、无工作区引导、科目/分组管理、App Shell 与今日/计划/知识/复盘/阶段/设置的信息架构整改；`pnpm check` 已通过，九个核心入口的当前源码桌面/移动快速验收为 18/18。既有完整 24 migration 隔离库上的 M1-M3 runtime 已按最新源码重跑通过，覆盖接管冲突回滚、stable-key `409`、归档分组拒绝、相邻换位、边界 no-op、revision 与审计门禁；正式浏览器 runner 也已同步当前标题、折叠表单、确认边界文案和双标签页布局冲突触发方式。
- 2026-07-31 已完成生产数据收口：数据库与上传目录备份校验通过；单事务将活动科目 `12 -> 7`，把新高等数学的 1 次真实 session 和 1 张真实 note 迁移到保留并重命名的 legacy `MATH`，保留并重命名四个 408 科目，删除 5 个重复科目；删除已盘点合成业务数据、22 条审计事件、2 条附件 metadata 和 2 个已备份合成文件。事务外文件删除前均断言为 70-byte 普通文件。审计事件批准计数为 14、实际删除 22；额外 8 条为同批合成对象的 2 条 `attachment-created`、3 条 `session-start` 和 3 条 `session-end`，不涉及真实学习记录，但属于严格计数门禁偏差；双备份继续保留。
- 清理后目标 ID、`[AF_SMOKE]` marker 和目标审计事件均剩余 0；read-only 聚合完整性检查 12 项均为 0，附件双向扫描为 1 条 metadata / 1 个文件且全部 mismatch/unsafe 计数为 0。生产镜像没有仓库脚本，因此本次是正式 doctor 等价 SQL/文件扫描，没有生成 doctor JSON/validator 记录。
- 22 个静态主要入口已在生产完成 2560px 桌面和 `390x844` 移动只读复验：22/22 可达、主内容存在、无错误页、无横向溢出，console error/warning 为 0；工作区显示最终 7 科且无合成 marker 或旧 408 前缀。公网 health 与 20 分钟 Web 错误日志复核通过；本机缺少正式 production-readonly smoke 配置，因此该浏览器复核不冒充正式 smoke record/validator。
- 本轮修复已形成新的本地 checkpoint，但尚未 push、创建修复 Release 或 production apply；修复 Release admission、Release 和生产 apply 仍分别确认，residual 状态不自动变化。
- `AREAFORGE_AUTO_APPLY=none` 保持不变；真实 Provider key smoke、restore、rollback 和 residual 状态变化均不在当前授权内。

## v1.1.0 历史候选与 Release 证据

- Batch 10、完整 Migration Gate、OPS-006/007 independent production apply、complete minor admission、annotated tag、GitHub Release 和 production apply 已按当时的独立确认完成。
- 2026-07-29 已按独立高风险确认补齐外部 Provider 当前浏览器默认关闭偏好：`/settings/ai` 确认保存、鉴权偏好 API 和八条既有 AI POST route 统一 gate 已在隔离候选实现并完成专项 API/桌面/移动验收；未使用真实生产 key，未新增 migration 或 AI history/cost/trace。
- 2026-07-30 已按独立精确确认完成 dirty worktree 本地浏览器重采：全新 PostgreSQL 16 空库顺序应用 24 条 migration，创建 18 个旅程账号与 1 个无障碍账号，18/18 journey、24/24 accessibility 及两份正式 validator 均通过；候选证据位于 `output/playwright/v11-browser-evidence-20260730-runnerfix-test39/`。
- 最终 frozen source 与合法 evidence-only closeout 证据见 `docs/development/release-v1.1.0-candidate-record.md`、`docs/development/v11-release-admission-record.md`、`docs/development/product-experience-review-v1.1.0-20260731.md`、`docs/development/v11-accessibility-review-20260731.md` 及其中绑定的 compatibility/CI/SC-004 artifacts。
- 上述证据只证明 `v1.1.0` 当时的目标 commit；当前产品化修复改变 Web 源和体验 fingerprint，不能沿用旧 `READY-FOR-SIGNED-RELEASE` 判定。

## 修复 Release Admission 判定

修复候选达到可发布状态前，以下输入必须匹配同一新目标 commit 或其契约允许的 evidence-only closeout：

- Product Experience 记录直接绑定并通过 `v11-browser-journey-evidence-v1`（9 journey × desktop/mobile）；
- 独立无障碍记录直接绑定并通过 `v11-accessibility-evidence-v1`（24 项检查及 observation artifact）；
- SC-002 CI-only 或签名 Release 供应链证据重采并通过对应 validator；
- SC-004 main protection readback 与 controlled PR 证据重采并通过 validator；
- package version 与候选 commit 身份一致，且本地 Release train / governance 门禁通过。

当前本地代码、`pnpm check`、完整迁移隔离库 M1-M3 runtime、生产清理、生产 22 入口复验和当前源码九入口桌面/移动快速验收已完成。新 commit/current-bound 正式 browser/compatibility、matching CI、SC-002/SC-004 和新 Release admission 尚未完成；快速验收不冒充正式 evidence runner/validator。后续 push、受控 PR、tag、GitHub Release、production apply、backup/restore、migration deploy、updater apply/rollback 或 residual ledger update，均须按对应边界另行授权。
