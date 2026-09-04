# 0043 v1.8 成长指标、私有挑战与排名

```yaml
status: backlog
phase: planning
blockers:
  - 0044 authorization must complete
  - 0041 deletion and export semantics must complete
  - 0042 controlled operations lifecycle must complete
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

先实现可解释的个人成长指数，再实现私有挑战完整 CRUD、参与者管理、所有权转移、主动加入、可重建排名、反作弊和退出/删除联动。

## 隐私与产品边界

- 动机、情绪正文、完整复盘、笔记/错题内容、附件、AI prompt 和私有任务标题不进入排名。
- 排名默认关闭且必须 opt-in；v1.8 不开放全站公开榜。
- 排名是可重建投影，不修改学习源事实，不阻断个人学习闭环。

## 验收

- `scoreVersion`、时间窗口、时区、并列、异常、申诉和删除规则可解释、可重复计算。
- 挑战支持创建、查看、编辑规则、开始、结束、关闭、解散；支持邀请/加入/退出/移除、昵称、字段授权和所有权转移。
- 排名故障可整体关闭，任务、计时、复盘、报告和阶段计划保持正常。
