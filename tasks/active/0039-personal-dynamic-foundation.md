# 0039 v1.3 个人版完全动态化

```yaml
status: in-progress
phase: awaiting-high-risk-confirmation
blockers:
  - subject merge write requires the exact v1.3 confirmation packet
risk: medium
ownerSkill: areaforge-product-experience
validation:
  - pnpm --filter @areaforge/core test
  - pnpm --filter @areaforge/web test
  - pnpm --filter @areaforge/web typecheck
  - pnpm check
  - pnpm dev:test:latest -- --json
residualRiskIds: []
releaseRequired: true
```

## 目标

完成多科目/分组首次设置、通用模板目录、408 去特殊化、重复科目处理和科目工作台，使个人版不依赖运行时写死业务数据。

## 范围与验收

- 范围和批次以 `workflow/versions/v1.3-v2.0-platform-evolution.md` 的 v1.3 为准。
- 空库、模板、自定义、多科目、归档恢复、重复处理和桌面/移动路径均需真实验证。
- 科目合并先做预览和安全转换，不在本任务物理删除历史对象。

## 当前进度

- 已实现多自定义科目/分组首次设置、版本化通用模板、408 去特殊化、科目/分组 CRUD、排序、归档和恢复。
- 已实现重复科目规则、业务引用统计、活动 session 阻断提示、三类结构冲突预览、主知识点重分配统计和推荐保留科目。
- 已增加执行前 snapshot hash；当前仍没有写 endpoint，不迁移引用、不删除或归档来源科目。
- core 106/106、Web 902/902、Web typecheck、复杂度门禁和完整 `pnpm check` 已通过；既有测试池页面已复核。新增 snapshot hash 后需重跑对应验证。
- M0 已完成并合并到 `main`；本任务尚缺真实合并事务、隔离 PostgreSQL 验证、空库全旅程、v1.3 独立 PR/CI、Release 和 production apply。

## 高风险边界

- 若新增 Prisma migration，先提交精确 migration 确认包。
- 不触碰生产、不删除历史数据、不扩大 AI 或运维能力。
