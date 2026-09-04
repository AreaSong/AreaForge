# 0043 v1.8-v2.0 挑战排名与平台化加固

```yaml
status: backlog
phase: planning
blockers:
  - 0040 authorization must complete
  - 0041 deletion and export semantics must complete
  - RANKING confirmation packet required before multi-user metrics sharing
risk: high
ownerSkill: areaforge-product-experience
validation:
  - pnpm check
  - pnpm risk:preflight
  - pnpm dev:test:latest -- --json
residualRiskIds:
  - AF-RISK-DATA-003
releaseRequired: true
```

## 目标

先实现可解释的个人成长指数，再实现主动加入的私有挑战、可重建排名、反作弊、退出/删除联动；随后补齐后台任务、通知、搜索、举报申诉、多租户观测和 v2.0 发布门禁。

## 隐私与产品边界

- 动机、情绪正文、完整复盘、笔记/错题内容、附件、AI prompt 和私有任务标题不进入排名。
- 排名默认关闭且必须 opt-in；v1.8 不开放全站公开榜。
- 排名是可重建投影，不修改学习源事实，不阻断个人学习闭环。

## 验收

- `scoreVersion`、时间窗口、时区、并列、异常、申诉和删除规则可解释、可重复计算。
- 排名故障可整体关闭，任务、计时、复盘、报告和阶段计划保持正常。
- v2.0 只有在 AUTH/RBAC/EXPORT/DELETE/OPS/RANKING、Release、生产和运营证据全部成立后才可声明完成。
