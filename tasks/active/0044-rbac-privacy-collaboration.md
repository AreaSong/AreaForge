# 0044 v1.5 RBAC、隐私授权与 Coach 协作

```yaml
status: in-progress
phase: implementation
blockers:
  - complete shared test-pool desktop/mobile browser matrix and Git checkpoint remain
  - protected PR/CI, Release and production apply remain independent stages
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm db:validate
  - pnpm ops:v15:rbac:typecheck
  - pnpm ops:v15:rbac:runtime:selftest
  - pnpm ops:v15:r-study-task-owner:typecheck
  - pnpm ops:v15:r-study-task-owner:runtime:selftest
  - pnpm check
  - pnpm governance:preflight
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

## 当前实施状态

- 2026-09-05 已确认以 `fd41920a0131b8d54284cf404cd8487aeb0e69f7` 为 preimage 实施本地 v1.5 候选，包含稳定资源 owner、五级角色、USER/ROLE/WORKSPACE grant、NOTE/MISTAKE/ATTACHMENT 共享闭环、CoachSuggestion/PlanInbox 接力、脱敏 Operator 管理面与专项验证。
- 跨版本混合原型已保存到可恢复 stash；当前从干净 v1.4 基线重新收敛 v1.5，不混入 DATA、OPS、RANKING migration。
- 已完成 v1.5 migration enum/owner 回填加固、Owner-only 角色矩阵、附件 owner lineage、成员 PlanInbox 隔离和 grant 错误映射；旧 runtime fixture 与完整测试 seed 已补齐稳定 owner。
- 全新隔离 PostgreSQL 的专项 runtime 已通过，覆盖迁移歧义拒绝、双 Workspace、五级角色、跨租户、grant 生命周期、Coach 确认链、PlanInbox lineage、成员移除/角色变化/账户暂停即时失效和 Operator 脱敏；Core/Web 当前专项验证通过，Prisma validate、typecheck、Web lint（0 error）和本地总门禁已通过，Release 层仍未开始。
- v1.5-R 已新增 `StudyTask.ownerUserId` additive owner lineage：现有任务按 `Subject -> ExamWorkspace.userId` 回填，成员创建/拆分/模拟/复习桥接/债务拆小及 PlanInbox 转换均写入服务端 actor owner；成员 PlanInbox 接受 Coach 建议后可在 CAS、审计和幂等保护下显式转换为自己的正式任务。为兼容尚未升级的旧写入器，owner 列暂保留 nullable；owner 为空的任务不允许成员级写操作，仍需后续清理/收紧为非空。
- v1.5-R 新增隔离 runtime selftest，已验证成员 PlanInbox 显式转换后生成成员 owner 任务，成员可以读回，Workspace owner 不会在成员任务列表中串读；production migration/apply 仍未执行。
- Release、生产 migration/apply、真实生产账户操作、物理删除和服务器动作仍需独立确认与证据。
- 本轮补齐 v1.5-R 同 Workspace 成员隔离收口：复习目标、任务关系、session evidence、附件父对象/下载 fallback、学习树导入/批量私有对象、错题模拟失分来源、笔记资源选择、科目重复预览和容量入口均加入 actor/owner 条件；新增跨成员静态契约覆盖。
- 协作 UI 已接通分享授权编辑、共享资源脱敏摘要、Coach 建议创建、成员真实角色显示、所有 active membership 切换与非 Owner 离开；仍缺完整 desktop/mobile 浏览器矩阵和受保护 Release/生产证据。

## 验收

- API、service 和数据库查询统一服务端授权；客户端 actor/user/workspace 参数不能越权。
- 角色与分享 grant 的创建、查看、修改、撤销有完整管理面和审计，撤销立即影响新请求。
- 平台 Operator 的账户目录保持脱敏；暂停/恢复账户和撤销会话需要重新验证并审计，不能借平台身份读取学习正文。
- `成员授权证据 -> Coach 建议草稿 -> 成员确认/驳回 -> 计划收件箱 -> 显式应用` 完整成立，Coach 不能直接修改正式学习记录。
- 跨 Workspace、角色矩阵、批量操作和 TOCTOU 负向测试通过。

## 回滚

- fail closed；关闭角色/分享/协作入口，保留审计和受影响对象清单，个人 Owner 路径继续工作。
