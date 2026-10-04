# 任务标题

```yaml
status: todo
phase: planning
blockers: []
risk: low|medium|high
ownerSkill: areaforge-...
validation:
  - pnpm docs:readiness
residualRiskIds: []
releaseRequired: false
# 可选：高风险离线证据契约，例如 evidenceClass: migration_preimage_candidate
# 可选：与 preflight/fixture 绑定的版本化契约，例如 preflightContract: OWNER-PREFLIGHT-CONTRACT-V1
```

状态：

`status` 只表示任务生命周期：active 使用 `todo/in-progress/blocked`，backlog 使用 `backlog/deferred/blocked`，done 使用 `done`。等待确认、等待签名 Release 或等待生产证据放入 `phase` 和 `blockers`，不要继续发明复合状态词。

## 目标

说明本任务要完成什么。

## 范围

- 包含：
- 不包含：

## 参考源事实

- `docs/...`

## Owner Skill

- `.codex/skills-src/areaforge-...`

## 验收标准

-

## 只读验收

- 需要的只读证据：
- 证据新鲜度：
- 关闭条件：

## 验证

- 

## 文档同步

- `docs/...`
- `tasks/...`
- `workflow/...`
- 若进入线上，记录 GitHub Release tag、线上 health、镜像 digest、update-agent 状态和残余风险。
- 若影响长期运营，更新 `docs/development/operational-readiness.md` 或 `docs/development/residual-risk-ledger.md`。

## 高风险边界

命中高风险边界时，先写清以下内容并等待确认：

- 影响：
- 风险：
- 验证：
- 回滚：

Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令；自动更新只能通过受控请求或服务器侧 updater 执行。

## 允许/禁止路径

- 允许：
- 禁止：

## 残余风险

-
