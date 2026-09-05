# 0044 v1.5 RBAC、隐私授权与 Coach 协作

```yaml
status: backlog
phase: planning
blockers:
  - 0040 identity, workspace and membership must complete
  - RBAC confirmation packet required before implementation
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

实现平台 Operator 与 Workspace Owner/Admin/Coach/Member/Viewer 两条权限轴、统一 policy service、角色分配/撤销、最小账户暂停/恢复与会话撤销管理面、对象级分享 grant CRUD、敏感读取审计，以及成员授权下的 Coach 建议确认闭环。

## 必须先冻结

- 平台/Workspace 角色与 capability 矩阵、敏感数据矩阵、账户暂停/恢复边界、分享范围/到期/撤销语义、拒绝响应和 TOCTOU 策略。
- RBAC、默认分享范围变化、migration/回填和生产部署分别确认。

## 验收

- API、service 和数据库查询统一服务端授权；客户端 actor/user/workspace 参数不能越权。
- 角色与分享 grant 的创建、查看、修改、撤销有完整管理面和审计，撤销立即影响新请求。
- 平台 Operator 的账户目录保持脱敏；暂停/恢复账户和撤销会话需要重新验证并审计，不能借平台身份读取学习正文。
- `成员授权证据 -> Coach 建议草稿 -> 成员确认/驳回 -> 计划收件箱 -> 显式应用` 完整成立，Coach 不能直接修改正式学习记录。
- 跨 Workspace、角色矩阵、批量操作和 TOCTOU 负向测试通过。

## 回滚

- fail closed；关闭角色/分享/协作入口，保留审计和受影响对象清单，个人 Owner 路径继续工作。
