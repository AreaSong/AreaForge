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
- 原有平台候选包含纯规则、只读审计检索和下述 `UserNotification` 基础；新增持久 worker 内核与排名通知处理器见首批实施记录。排名重建、导出/删除处理器、持久搜索索引、配额写入、MFA/Passkey、监控外呼及生产启用仍缺，不改变整体 `status: backlog` 和前置 blocker。
- `UserNotification` 已作为默认关闭的持久通知基础进入本地候选：排名事件可走直接事务或受控 `DataJob` worker，鉴权列表/状态 API、独立通知路由、顶部栏直达入口和未读/全部/已隐藏 UI 支持跨设备已读、隐藏、恢复；用户导出预览包含脱敏通知记录。它尚不包含排名重建、导出/删除 worker、外部投递或其他业务域事件，不改变前置 blocker。

## 验收

### 首批持久 worker（2026-09-08 已确认，本地候选）

- 用户在收到持久 worker、兼容 migration、新建隔离 PostgreSQL、验证后提交推送及禁止范围后明确同意继续。授权仅覆盖本批本地实现与合成 fixture，不延伸为 EXPORT/DELETE/OPS/RANKING 域执行、共享库或生产写入、Release/tag 或 residual 关闭。
- 已增加 `DataJob.queueVersion/nextAttemptAt/maxAttempts/leaseVersion/pauseRequested/deadLetteredAt` 和第 50 条 additive migration；零协议旧任务不自动入队。DB 包只新增对仓库已有 Core 的 workspace 依赖，无新增第三方包。
- 已实现 `SKIP LOCKED`、持久退避/死信、单调租约代次、scope 重验、暂停/取消/重放、进度心跳、过期恢复、队列统计和独立进程组合入口。事务副作用与成功状态一起提交；旧手工 worker API 拒绝新协议任务。
- 源事实：`docs/modules/background-jobs.md`。执行器无业务处理器时拒绝启动；尚未接入真实导出归档、物理删除、排名重建、通知事件或搜索域处理器，不能把内核完成写成 DATA-1 全域消费或 v2.0 完成。
- 隔离 PostgreSQL 已通过 50 条完整 ledger/SQL checksum 核验及 13 组 runtime：竞争领取、跨工作区 SKIP LOCKED、幂等/旧代次拒绝、退避/死信/重放、暂停/取消、事务回滚、权限撤销/过期、心跳/退出、旧协议隔离、账户 scope、workspace archive、通知 payload/事件键幂等，以及 prepare/事务副作用之后两个真实子进程 SIGKILL 恢复点。
- 已增加受控排名通知处理器：事件 payload 仅含收件人/Workspace/受控 kind/源实体/事件键；worker 在事务内重新检查 ACTIVE Membership 并幂等写入 `UserNotification`。13 组隔离 runtime 已覆盖通知写入和重复事件不重复落库；默认 queue flag 关闭，通知业务仍可使用既有直接事务路径。
- 验证入口：`pnpm worker:data-jobs:typecheck`、`pnpm worker:data-jobs:selftest`、带精确隔离库 guard 的 `pnpm worker:data-jobs:runtime:selftest`、Core/DB/Web 检查及 `pnpm check`。最终 Git 检查点须在文档同步后重跑相关门禁；runtime 不进入无数据库的默认 check，不能声称普通 CI 已覆盖隔离进程实验。
- 回退：停止 worker 与新协议生产者；保留兼容字段、任务和审计。已有新协议任务时须保留 Web 的协议隔离，不允许旧手工接口接管；不 DROP、不删除业务源数据。
- 当前整体任务仍保持 backlog/planning：前置域处理器、后续平台能力、独立发布与生产证据未齐，本批不关闭任何 residual。

- 大数据量、并发、队列故障、恢复和灾备测试通过；故障不阻断个人学习主链。
- 桌面、移动和无障碍旅程通过，所有页面和后台任务明确显示 Workspace scope。

## 回滚

- 各派生消费者可单独关闭；保留个人学习源事实、任务状态和必要审计，禁止用投影回写源事实。
