# 0046 v2.0 多人学习平台综合门禁

```yaml
status: backlog
phase: planning
blockers:
  - 0040 through 0045 must complete with release and production evidence
risk: high
ownerSkill: areaforge-operating-loop
validation:
  - pnpm check
  - pnpm risk:preflight
  - pnpm governance:preflight
  - pnpm ops:readiness
  - pnpm dev:test:latest -- --json
residualRiskIds:
  - AF-RISK-DATA-001
  - AF-RISK-DATA-002
  - AF-RISK-DATA-003
  - AF-RISK-OPS-009
releaseRequired: true
```

## 目标

汇总而不替代 AUTH、RBAC、EXPORT、DELETE、OPS、RANKING 六个独立高风险包，以完整产品、Release、生产、安全、隐私和运营证据决定是否可声明 v2.0。

## 验收

- 个人学习旅程与多人协作旅程都能完成，个人用户无需配置成员、权限或排名。
- Workspace/Membership、角色/分享、Coach 协作、数据任务、受控运维请求和挑战排名的 CRUD、拒绝与恢复路径全部通过。
- 跨租户、隐私、导出、删除、附件、后台任务、排名和故障恢复回归通过。
- 受保护 PR/CI、签名 Release、不可变 digest、production apply、smoke、观察、回滚和事故响应证据齐全。

## 声明边界

- 任一独立高风险包或生产证据缺失时，不得以本任务状态替代；保持 blocked 或 backlog，并明确具体缺口。
