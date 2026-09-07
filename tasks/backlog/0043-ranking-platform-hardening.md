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
- 本地候选已增加专用 `RankingAppeal`、唯一未决申诉、revision CAS、成员提交/撤回和 Owner 复核 UI；排名邀请、挑战/参与者状态、所有权转移及申诉事件会在 `PLATFORM_NOTIFICATIONS_ENABLED=true` 时以受控通用种类写入 `UserNotification`。通知按 recipient/eventKey 幂等，只保存 Workspace 标签和源标识，不保存挑战名称、申诉正文或学习正文，并进入用户导出预览。挑战、当前用户参与记录与本人提交的申诉也已进入 owner/actor-scoped 数据预览，`RankingProjection` 保持可重建排除。
- 当前候选的 schema/migration、投影、申诉、通知和 authenticated API 已通过 Core/Web、隔离 migration 回放及 v1.6-v1.8 runtime；隔离事务链已验证成员关闭 opt-in 后参与记录转为 `LEFT`、投影归零、成员账户删除预览转为 `READY`，而仍拥有未解散挑战的 Owner 删除预览保持 `BLOCKED`。通知 runtime 覆盖跨用户拒绝、读/未读/隐藏/恢复、事件幂等和导出联动。申诉与通知均完成 390×844 成员和 1440×900 Owner 真实旅程，通知另以第二浏览器会话验证跨设备状态，控制台 0 error 且无横向溢出。截图见 `output/playwright/ranking-appeal-member-mobile.png`、`output/playwright/ranking-appeal-owner-desktop.png`、`output/playwright/user-notifications-member-mobile.png`、`output/playwright/user-notifications-owner-desktop.png`。所有相关开关默认关闭，migration 未 apply 到共享测试库或生产；仍缺真实物理删除/完整归档、完整跨租户浏览器矩阵和 Release/生产证据。
