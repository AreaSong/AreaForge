# 0040 v1.4 身份、Workspace 与 Membership

```yaml
status: in-progress
phase: implementation
blockers:
  - nodemailer minimum release age policy must clear before standard pnpm gates can pass
  - shared test-pool desktop/mobile browser evidence and final docs/Git checkpoint remain
  - v1.3 Release and production disposition must be frozen before v1.4 Release
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm db:validate
  - pnpm db:generate
  - pnpm --filter @areaforge/auth test
  - pnpm --filter @areaforge/config test
  - pnpm --filter @areaforge/web test
  - pnpm --filter @areaforge/web typecheck
  - pnpm --filter @areaforge/web lint
  - pnpm ops:v14:auth:runtime:selftest
  - pnpm check
  - pnpm governance:preflight
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

## 当前进度

- 已核对实施前 `User`、`AuthSession`、进程内登录限流、`ExamWorkspace.userId` owner 查询与单 ACTIVE Workspace 索引 preimage。
- 已在数据模型中冻结账户私有、用户在 Workspace 内私有、Workspace 结构、作者审计和高敏正文五类归属；Membership 不自动扩大现有学习正文可见性。
- 已在威胁模型中补齐邀请/重置重放、IDOR、成员移除/冻结即时失效、最后 Owner、当前 Workspace 选择误授权、多实例限流和 rollback floor。
- v1.4 本地实施精确确认包已于 2026-09-05 确认，覆盖 schema、owner/selection 回填、SMTP dependency admission、API/UI、验证和回滚；不包含 Release、生产 migration/apply、RBAC、完整导出或物理删除。
- 已实现账户状态/authRevision、设备 session、邮箱验证/密码重置、重新验证、持久认证限流、server-only SMTP、WorkspaceMembership/Invitation/Selection、Workspace 生命周期和成员生命周期；多人开关默认关闭，学习正文保持 owner-only。
- Auth/API/Config 目标测试、Web 全量 925/925、Web/v1.4 typecheck、目标 ESLint 和隔离 PostgreSQL 11 组 runtime 已通过；仍待依赖发布时间门禁解除后的标准 pnpm 门禁、共享测试池浏览器验收、文档同步和 Git 检查点。

## 验收

- 两用户同 Workspace 协作、两 Workspace 隔离、最后 Owner 保护、成员移除和权限变化即时生效。
- Workspace 创建、重命名、归档、恢复和切换形成完整流程；关闭/物理删除不在本版本。
- 全链路 Workspace scope 和跨租户/IDOR 负向矩阵通过。
- 旧个人数据无损，个人路径不要求成员或角色配置。

## 回滚

- additive-first；回滚应用并保留新表，关闭邀请/成员入口，旧 owner 兼容路径继续可用。
