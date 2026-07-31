# v1.1 Batch 10 阶段/模拟闭环与 Migration 8

```yaml
status: done
phase: local-verified
blockers: []
risk: high
ownerSkill: areaforge-product-experience
validation:
  - pnpm db:validate
  - pnpm check
  - pnpm ops:v11:m8:runtime:selftest
  - isolated Playwright desktop/mobile/error-recovery smoke
  - pnpm experience:review:validate docs/development/product-experience-review-20260722-v11-batch10.md
residualRiskIds:
  - AF-RISK-DATA-001
  - AF-RISK-UX-001
releaseRequired: true
```

## 交付

- Migration 8：`SimulationSubjectResult.paperFullScore`、模拟/分科 revision、`SimulationLossItem` 固定原因、节点、0.5 分步进、软归档、约束与索引。
- 新模拟 totals 仅由完整分科结果汇总；`legacy_fallback` 保持只读历史展示，不进入结构化候选、报告或阶段建议。
- `/stage/simulation*` 完成创建、单科切换、结构化失分、warning、逐项补救入箱；保存结果与入箱为两个独立命令。
- `/review/reports*` 完成 current/history、week/month 与冻结历史入口；报告确认原子入箱并生成独立阶段草稿。
- `/stage/overview|analytics` 完成阶段确认、7/30 天入口与确认边界；阶段确认不修改现有任务。
- 旧 `/simulation`、`/reports` 兼容跳转；App Shell 开放复盘与阶段入口。

## 隔离验证

- 完整 20 个 migration（含产品 Migration 1→8）在一次性 PostgreSQL 容器 apply；M8 runtime selftest 通过，重复 deploy 无 pending migration。
- Migration 1→7 后注入 `targetScore=80.3`、`actualScore=60.3` legacy 行，再应用 Migration 8：旧值保留，四个分数约束均为 `NOT VALID`，新非法小数写入仍被拒绝。
- `pnpm db:validate` 与 `pnpm check` 通过；后者覆盖 typecheck、测试、lint、Prisma validate 与 production build。
- Playwright：桌面 `1440×1000` 与移动 `390×844` 完成模拟失分→补救 Inbox→Task→七天计划→报告确认→阶段确认→7 天趋势跨页闭环。
- 人工递增模拟 revision 后保存返回 409，`109.5` 和现场总结保留；旧 `/reports`、`/simulation` 跳转到 canonical 入口。
- 冻结提交 `122f1aa` 的体验记录：`docs/development/product-experience-review-20260722-v11-batch10.md`；在该提交的隔离 worktree 中，默认 validator 返回 `bindingStatus: current`、`reviewFreshnessStatus: fresh`。后续 checkout 已进入 Batch 11，不能把这份历史批次记录表述为后续 HEAD 的 current-bound 证据。

## 新增回归路径

- `scripts/quality/v11-m8-runtime.selftest.ts` 由 `pnpm ops:v11:m8:runtime:selftest` 执行，固定覆盖 Migration 8 schema、模拟 CAS 与补救事务、报告确认不改 `StagePlan`/`StudyTask`、阶段确认不改 `StudyTask`、legacy totals 只读、跨页 canonical task fixture、workspace 隔离与七天 DTO/周报告口径一致。
- 报告确认重复提交不重复入箱或生成阶段草稿；阶段确认重复提交不重复入箱。

## 确认状态

沿用已确认的完整产品数据 migration 确认句边界，本批没有扩大授权：

> 确认批准学习行动中心完整产品数据 migration 包：范围仅限按 1→8 顺序的 additive Prisma/SQL migrations 与临时库验证；Subject code 约束放宽单列影响；不授权生产 migration deploy、destructive DDL、历史修复、文件移动或 residual 关闭。

## 未授权/未执行

- 未执行生产 migration deploy、生产 apply/updater、历史修复、destructive DDL、文件移动或 residual 关闭。
- `AF-RISK-DATA-001` 与 `AF-RISK-UX-001` 保持现有台账状态；本批不自动关闭或改写 residual。
