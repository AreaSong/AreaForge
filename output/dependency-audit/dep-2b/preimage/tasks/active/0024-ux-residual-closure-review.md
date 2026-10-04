# UX Residual Closure Review

```yaml
status: in-progress
phase: implementation
blockers:
  - current checkout-bound desktop/mobile review and runtime probe
  - reaffirm keep-open or authorize a separate residual ledger update
risk: medium
ownerSkill: areaforge-product-experience
evidenceClass: browser-review
validation:
  - pnpm experience:review:validate <current-product-experience-review.md|txt>
  - pnpm residuals:closure:validate <residual-closure-review-record.md|txt>
  - pnpm residuals:validate
  - pnpm tasks:doctor
residualRiskIds:
  - AF-RISK-UX-001
releaseRequired: false
```

## 目标

由维护者复核 `AF-RISK-UX-001` 的当前本地体验证据，并明确给出 `close` 或 `keep-open` 结论。
本任务只承接人工复核，不自动修改 residual Markdown/JSON 台账，不把本地体验证据扩大为生产体验证明。

## 范围

- 复核此前在 commit `089ccddac4e51da4121d5dc4a4584fde19762c52` 完成的 31/31 authenticated local UX smoke；源码指纹变化后使用当前 checkout runtime identity 重新绑定本地记录。
- `docs/development/product-experience-review-20260716-ops-control-plane.md` 是历史证据；共享 evaluator 当前因 git commit、source hash 和 runtime identity 漂移将其判为 `invalid`，不得重新贴标为 current。
- `ops:status` 与 `ops:handoff` 继承同一 `fresh / stale / invalid / missing` evaluator 结果，UX next action 不再读取静态 `currentImpact` 作为实时证据。
- 复核 `docs/development/residual-closure-review-20260716.md` 的 `keep-open` 结论；该结论不修改权威 residual 台账。
- 使用 `docs/development/residual-closure-review-template.md` 保存维护者的 `close` 或 `keep-open` 结论。

## 禁止范围

- 不自动更新 `docs/development/residual-risk-ledger.md` 或 `docs/development/residual-risk-ledger.json`。
- 不自动关闭、降级或重新打开 `AF-RISK-UX-001`。
- 不声称本地 smoke、截图或体验记录证明生产环境体验。
- 不创建 Release，不执行部署、updater apply、migration、备份、恢复或服务器命令。

## 验收标准

- 维护者明确选择 `close` 或 `keep-open`，不由 validator 或任务状态代替人工结论。
- 人工复核记录通过 `pnpm residuals:closure:validate`，并保持 `closesResidual: no`。
- 若结论为 `close`，后续另行授权台账状态更新；若结论为 `keep-open`，记录继续保留的原因、证据缺口和重新复核触发器。
- 本任务完成本身不改变 residual 的 `type`、`reviewAt`、`executableNow` 或关闭状态。

## 残余风险

- `AF-RISK-UX-001` 在维护者结论形成并另行更新权威台账前保持 `monitoring-gap` 和 open。
- `docs/development/product-experience-review-20260716-ops-control-plane.md` 当前不匹配 checkout；现有 `keep-open` 结论仍保留，但必须先形成新的 current-bound review 才能再次进入关闭复核。
- 当前证据仅绑定本地 checkout；生产体验仍需独立生产证据。
