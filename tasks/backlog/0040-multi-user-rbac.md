# 0040 v1.4 身份、Workspace 与 Membership

```yaml
status: backlog
phase: planning
blockers:
  - 0039 personal dynamic foundation must complete
  - AUTH confirmation packet required before implementation
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

实现邀请制用户、账户安全、Workspace 完整生命周期、Membership、成员生命周期和跨租户隔离，为 v1.5 RBAC 提供可信身份与归属底座。

## 必须先冻结

- 数据 owner、现有单管理员迁移、会话/邀请策略、Workspace 创建/切换/归档语义和 IDOR 响应策略。
- AUTH、migration/回填和生产部署分别确认；RBAC 与隐私授权由 0044 单独承接。

## 验收

- 两用户同 Workspace 协作、两 Workspace 隔离、最后 Owner 保护、成员移除和权限变化即时生效。
- Workspace 创建、重命名、归档、恢复和切换形成完整流程；关闭/物理删除不在本版本。
- 全链路 Workspace scope 和跨租户/IDOR 负向矩阵通过。
- 旧个人数据无损，个人路径不要求成员或角色配置。

## 回滚

- additive-first；回滚应用并保留新表，关闭邀请/成员入口，旧 owner 兼容路径继续可用。
