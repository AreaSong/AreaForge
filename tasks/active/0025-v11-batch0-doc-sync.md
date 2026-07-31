# v1.1 Batch 0 文档同步与任务拆分

```yaml
status: in-progress
phase: implementation
blockers: []
risk: medium
ownerSkill: areaforge-doc-sync
evidenceClass: docs-only
validation:
  - pnpm tasks:doctor
  - pnpm docs:readiness
  - pnpm docs:completion
  - pnpm docs:evergreen
  - pnpm risk:preflight
  - pnpm residuals:validate
  - git diff --check
residualRiskIds: []
releaseRequired: false
```

状态：Batch 0 Exact docs、DATA-001、确认包骨架与 tasks 0025–0035 已写入本分支；待验证门禁通过后可迁入 `done/`。

## 目标

完成学习行动中心 Batch 0：Exact docs 同步、`AF-RISK-DATA-001` 登记、高风险确认包骨架，以及 Batch 1–11 任务拆分；不写业务代码、不改运行时。

## 范围

- 包含：产品/架构/模块/UX/开发文档的「规划未实现」落点；residual DATA-001；确认包骨架；tasks 0025–0035。
- 不包含：Prisma migration、Web 实现、生产动作、residual 自动关闭。

## 参考源事实

- `workflow/versions/v1.1-learning-action-center.md`

## 验收标准

- Exact docs 标明规划 vs 已实现，不扩大 docs 100%。
- `pnpm residuals:validate` 与 `pnpm tasks:doctor` 通过。
- Batch 1–11 均有可追踪 task。

## 残余风险

- 不关闭任何 residual；DATA-001 仅登记。
