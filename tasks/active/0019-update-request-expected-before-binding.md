# Update Request Expected-Before Binding

```yaml
status: blocked-awaiting-confirmation
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm update-center:request-guard:selftest
  - pnpm shellcheck:updater
  - pnpm github-release-updater:preflight
  - pnpm governance:preflight
  - pnpm risk:preflight
  - pnpm check
residualRiskIds:
  - AF-RISK-OPS-005
releaseRequired: true
```

状态：设计和确认包已准备，等待用户明确确认本地实现；未授权生产部署或请求处理。

## 目标

让 Web update request 绑定用户确认时的生产前态，并由 root agent 在执行前 compare-and-reject，
阻止 stale apply、rollback target 漂移、策略覆盖和请求重放。

## 范围

- 包含：schema V2、expected-before、目标 Release/manifest/digest 绑定、双 canonical hash、
  idempotency key、TTL、原子发布、processing reconciliation、共享 production-state lock、严格
  schema、legacy fail-closed、immutable decision history 和本地 selftest。
- 不包含：生产部署、timer/队列操作、updater apply、rollback、自动策略变化、数据库 migration、secret
  读取或 residual 关闭。

## 参考源事实

- `docs/development/update-request-expected-before-design.md`
- `docs/development/runtime-write-boundary.md`
- `docs/development/high-risk-confirmation-packets.md`
- `docs/deployment/github-release-updater.md`
- `docs/development/residual-risk-ledger.md`

## Owner Skill

- `.codex/skills-src/areaforge-security-governance`
- `.codex/skills-src/areaforge-release-operator`
- `.codex/skills-src/areaforge-sre-ops`

## 验收标准

- 所有 mutation request 都绑定 required expected-before fields 和 TTL。
- apply 绑定 Release ID、manifest hash/version 和 image digest；rollback 绑定 source update-record hash
  与精确目标。
- root agent 从 live source 重建 observed-before，不匹配时零执行副作用。
- expected-before 在原子领取后和最终副作用边界前各比较一次。
- update-agent、updater 和 rollback 写阶段共享 production-state lock。
- rollback 执行目标精确等于用户确认目标。
- V1 mutation request fail closed；V1 check 仅按文档兼容。
- Web 原子发布请求，history 保留 hash、decision、reason 和 executionAttempted。

## 只读验收

- 需要的只读证据：本地 fixture/selftest、shellcheck、typecheck、lint、preflight 和 diff。
- 证据新鲜度：必须来自最终代码变更后的同一 checkout。
- 关闭条件：本地实现验证通过后仍只进入 release-ready；生产 residual 需另行 Release/部署证据。

## 高风险边界

- 影响：改变 root agent 是否执行 updater、rollback 和策略写入的判定。
- 风险：Web/agent schema 不匹配、旧 agent 忽略 V2、队列请求丢失或错误拒绝。
- 验证：全量竞态/TTL/hash/legacy/零副作用矩阵和现有 updater preflight。
- 回滚：生产部署另走确认包；暂停 timer、隔离 V2 请求、同时回滚 Web/agent，不重放请求。

## 允许/禁止路径

- 允许：设计列出的 Web、update-agent、updater shared-lock/target-identity 接口、selftest、preflight 和
  文档路径。
- 禁止：生产 SSH、生产 config/env、数据库/上传目录、Release tag、residual 关闭。

## 残余风险

- `AF-RISK-OPS-005` 在生产部署并取得 fresh redacted execution/rejection evidence 前保持 open。
