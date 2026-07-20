# AreaForge 错误恢复矩阵

本矩阵把关键失败路径连接到四个可复核对象：用户可见提示、恢复动作、诊断入口和副作用边界。它借鉴 AreaMatrix 的错误到 UX 恢复证据，以及 AreaFlow 的 capability-gated transition、expected state 和 audit 思路，但不引入新的运行时 command engine 或数据库控制面。

机器源文件是 [`error-recovery-matrix.json`](error-recovery-matrix.json)，校验入口是：

```bash
pnpm error-recovery:validate
pnpm error-recovery:selftest
```

## 使用规则

- `P0` 表示可能造成数据损坏、重复副作用、文件暴露或不确定生产状态；必须阻断继续操作。
- `P1` 表示核心恢复路径缺失或容易误导用户；发布前必须有恢复动作和证据入口。
- `P2` 适合排期优化，但不能写成已验证闭环。
- `reopenResidual` 是重新打开现有 residual 的条件，不是自动关闭或自动创建台账。
- `evidenceCommand` 只表示本地或只读证据入口；它不授权 SSH、生产写入、备份恢复、migration、updater apply 或 residual 关闭。

## 当前边界

矩阵明确保留以下未完成项：业务 session 并发协议 `AF-RISK-OPS-006`、附件 staging/write-intent `AF-RISK-OPS-007`、updater phase journal/hold-drain `AF-RISK-OPS-008`、生产只读证据 `AF-RISK-OPS-001`、Expected-Before 生产部署 `AF-RISK-OPS-005` 和当前认证体验证据 `AF-RISK-UX-001`。矩阵通过只证明文档化恢复契约完整，不证明这些 residual 已关闭。

## 维护门禁

变更 auth、timer、附件、AI、Update Center、备份恢复、公开支持或事故流程时，先更新 JSON，再同步本文件、相关 owner skill、validation matrix 和 residual 入口，最后运行：

```bash
pnpm error-recovery:validate
pnpm enterprise:operability:preflight
pnpm docs:readiness
pnpm residuals:validate
pnpm check
```
