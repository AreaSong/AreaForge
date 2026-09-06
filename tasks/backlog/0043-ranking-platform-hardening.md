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

## 当前实现进度（纯规则基础，2026-09-06）

- `packages/core/src/ranking-metrics.ts` 已提供 `calculatePersonalGrowthScore`（别名 `calculatePersonalGrowthIndex`）、`calculatePrivateChallengeScore` 和 `rankPrivateChallengeScores`，分别固定 `personal-growth-v1` / `private-challenge-v1` 的 `scoreVersion`。
- 计算只接受显式白名单字段：带时区的 session 时间戳、有效学习秒数和最低行动标记；窗口按用户 IANA 时区解释为 `[startDate, endDate)`，个人成长基线与当前窗口必须等长且不重叠。
- 纯规则会拒绝敏感或未知字段，去除重复 session，排除无效/超长/窗口外时长，并将单日有效时长限制为 16 小时；返回组件权重、基线/当前值、异常代码和解释文本，挑战排名使用稳定的竞赛并列名次。
- core 计算、反作弊分级与 appeal 状态机 policy 已完成并保持无副作用；不代表 RANKING 确认包已批准，也不改变 `status: backlog` 或前置阻塞项。
- 本地候选已补充排名 opt-in/字段授权、挑战 CRUD 与参与者状态、跨租户授权、可重建数据库投影和删除预览；候选 migration 只在一次性隔离 PostgreSQL fixture 中验证，未 apply 到共享测试库或生产。
- 本地候选已增加基于 AuditEvent 的申诉提交/查看/复核 API，以及成员邀请/接受/退出 UI；尚未实现或收口：通知、故障总开关、退出/删除/导出全链路联动、申诉专用持久表、公开榜和生产动作。这些边界仍需 RANKING、AUTH/RBAC、DELETE/EXPORT 与 OPS 确认及运行证据。
- 当前工作树已形成本地候选 schema/migration、偏好 opt-in、私有挑战/参与者状态服务、可重建投影和删除预览 hook，以及 authenticated API routes；`RANKING_ENABLED` 默认关闭，migration 未 apply。全量 core/Web 门禁与隔离 PostgreSQL v1.8 runtime 已通过，尚缺完整浏览器矩阵、通知/故障开关和 Release/生产证据。
