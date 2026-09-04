# 0040 v1.4-v1.5 多用户、Membership、RBAC 与隐私授权

```yaml
status: backlog
phase: planning
blockers:
  - 0039 personal dynamic foundation must complete
  - AUTH and RBAC confirmation packets required before implementation
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm db:validate
  - pnpm check
  - pnpm risk:preflight
residualRiskIds:
  - AF-RISK-DATA-002
releaseRequired: true
```

## 目标

实现邀请制用户、Workspace Membership、成员生命周期、预设角色、统一服务端授权、敏感内容显式共享和跨租户隔离。

## 必须先冻结

- 数据 owner、现有单管理员迁移、会话/邀请策略、角色权限矩阵、敏感数据矩阵和 IDOR 响应策略。
- AUTH 与 RBAC 分成两个独立确认包；迁移、回填和生产部署再独立确认。

## 验收

- 两用户同 Workspace 协作、两 Workspace 隔离、最后 Owner 保护、成员移除和权限变化即时生效。
- 所有私有 API、service 和数据库查询通过统一授权；跨租户/越权负向矩阵通过。
- 旧个人数据无损，个人路径不要求成员或角色配置。

## 回滚

- additive-first；回滚应用并保留新表，关闭邀请/成员入口，旧 owner 兼容路径继续可用。
