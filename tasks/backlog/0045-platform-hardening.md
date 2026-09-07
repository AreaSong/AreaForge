# 0045 v1.9 平台化加固

```yaml
status: backlog
phase: planning
blockers:
  - 0041 durable jobs and data lifecycle must complete
  - 0042 controlled operations must complete
  - 0043 private challenges and ranking must complete
risk: high
ownerSkill: areaforge-operating-loop
validation:
  - pnpm check
  - pnpm risk:preflight
  - pnpm governance:preflight
  - pnpm dev:test:latest -- --json
residualRiskIds:
  - AF-RISK-DATA-001
  - AF-RISK-DATA-002
  - AF-RISK-DATA-003
  - AF-RISK-OPS-009
releaseRequired: true
```

## 目标

把后台任务、通知、搜索、限流、滥用保护、举报申诉、审计检索、多租户观测、容量治理和灾备体验加固到可长期运行状态。

## 范围

- 将 v1.6 最小后台任务扩展到排名重建、通知和搜索索引，补积压、死信、暂停和人工重放。
- 统一 Workspace/成员/通知/搜索/账户安全/数据任务/挑战入口和跨设备恢复。
- 增加限流、配额、MFA/Passkey 候选、会话风险提醒、举报申诉和审计检索。
- 建立多租户指标/告警、容量阈值、支持包脱敏和灾备演练。

## 当前低风险基础

- `packages/core/src/platform-hardening.ts` 已提供无副作用规则：后台任务指数退避、最大尝试与死信判定；Workspace 活动任务/每日导出/成员/存储配额；固定窗口限流；存储/队列容量健康、预警和阻断状态。
- 审计查询只接受规范化 Workspace/actor/action/time/limit；本地候选已提供 Operator-only `GET /api/system/audit-events`，在查询前使用统一规范化器，按 Workspace metadata、actor、action 前缀和时间窗过滤，并只返回严格 allowlist 的脱敏标量摘要。全局搜索候选在投影前按 selected Workspace、ACTIVE membership、owner/share/workspace visibility 过滤，跨租户和未授权私有结果不进入输出。
- 本地候选已提供鉴权只读 `GET /api/search`：仅在显式 ACTIVE Workspace 中搜索活动科目，以及当前 actor 自有的任务/知识点/笔记/错题/资料和获有效 grant 的笔记/错题。服务端先做 Membership/owner/grant 过滤，再返回标题和 canonical href；不搜索正文、附件名、动机/情绪/AI 内容，响应明确 `indexed=false`，当前仍是直接数据库候选而非持久搜索索引。
- 本地候选已提供只读 `GET /api/system/capacity`：Platform Operator 或目标 Workspace Owner 可读取 active member/job、最近 24 小时导出/失败任务、附件数量/字节和最老活动任务时间；其他成员统一 404。当前没有获确认的配额政策，因此响应固定 `limitsConfigured=false`、`enforcementEnabled=false`、`capacityState=OBSERVED_ONLY`，不写死阈值、不拒绝业务写入。
- 平台加固主体仍只有纯规则、只读审计检索与测试；除下述 `UserNotification` 候选外，尚无通用持久队列、搜索索引、配额写入、MFA/Passkey、监控外呼或生产状态变化；不改变 `status: backlog` 和前置 blocker。
- `UserNotification` 已作为默认关闭的通用持久通知基础进入本地候选：排名事件幂等写入，鉴权列表/状态 API 和未读/全部/已隐藏 UI 支持跨设备已读、隐藏、恢复；用户导出预览包含脱敏通知记录。它尚不包含通用通知 worker、外部投递、全局导航入口或其他业务域事件，不改变前置 blocker。

## 验收

- 大数据量、并发、队列故障、恢复和灾备测试通过；故障不阻断个人学习主链。
- 桌面、移动和无障碍旅程通过，所有页面和后台任务明确显示 Workspace scope。

## 回滚

- 各派生消费者可单独关闭；保留个人学习源事实、任务状态和必要审计，禁止用投影回写源事实。
