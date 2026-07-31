# v1.1 Batch 7 App Shell 与今日行动中心

```yaml
status: done
phase: complete
blockers: []
risk: medium
ownerSkill: areaforge-product-experience
validation:
  - pnpm check
  - pnpm smoke:local-ux
residualRiskIds: []
releaseRequired: false
```

## 目标

受保护 App Shell、稳定路由、首次工作区设置、今日行动中心、科目快捷计时、全屏专注与快速复习；仅开放今日/任务/专注/快速复习/基础设置入口。

## 完成摘要（2026-07-21）

- Core：`action-center` 推荐/三队列/SubjectTimer；`app-shell` 五灯与移动端最高优先级
- API：`GET /api/app-shell/status`、`GET /api/action-center/today`、`GET /api/plan/rolling`、`GET .../subjects`；session `goalMinutes`/`startSource`
- 页面：`/today*`、`/focus/[sessionId]`、`/quick-review/[scheduleId]`、`/settings`、`/settings/workspace`；登录与 `/` → `/today`
- 导航仅开放今日/计划/收件箱/设置；知识/动机/通知/AI/阶段入口隐藏
- **未**生产 migration/apply/updater；**未**关闭 residual；生产切换仍属 Batch 11

## 验证收口（2026-07-21，绑定 `edb6627fb1d7f41373cebcd137baa382114291fc`）

- `pnpm check`：PASS
- `pnpm smoke:local-ux:selftest`：PASS
- `pnpm smoke:local-ux`：PASS（含 `batch7 app shell nav isolation`、`subject shortcut start`、`page /focus/[sessionId]`）
- Playwright 桌面 1440 / 移动 390：`output/playwright/batch7-*.png`；runtime identity：`output/playwright/runtime-identity-batch7-edb6627.json`
- rg：`apps/web/lib/navigation/batch7.ts` 与 `app-shell.tsx` 无画布/动机/AI/知识等未授权导航 href
- 高风险确认包：无新增
- 结论：Batch 7 隔离验收 **PASS**；可进入 Batch 8
