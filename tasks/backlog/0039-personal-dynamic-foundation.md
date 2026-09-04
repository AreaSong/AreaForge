# 0039 v1.3 个人版完全动态化

```yaml
status: backlog
phase: planning
blockers:
  - 0038 M0 must complete first
risk: medium
ownerSkill: areaforge-product-experience
validation:
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

## 高风险边界

- 若新增 Prisma migration，先提交精确 migration 确认包。
- 不触碰生产、不删除历史数据、不扩大 AI 或运维能力。
