# 0042 v1.7 受控运维中心

```yaml
status: backlog
phase: planning
blockers:
  - 0044 platform operator authorization boundary must complete
  - 0041 durable job and data lifecycle semantics must complete
  - OPS confirmation packet required before implementation or production execution
risk: high
ownerSkill: areaforge-sre-ops
validation:
  - pnpm github-release-updater:preflight
  - pnpm shellcheck:updater
  - pnpm governance:preflight
  - pnpm check
residualRiskIds:
  - AF-RISK-OPS-009
releaseRequired: true
```

## 目标

在现有 update request/updater 基础上增加只读运维视图、白名单 operation intent 和完整请求生命周期，由 root-only agent 执行并生成阶段证据。

## 永久禁止

- 任意 shell、命令文本、脚本正文、自由路径或任意环境变量。
- Web runtime 挂载 Docker socket、root 权限、生产 `.env`、备份目录或签名私钥。

## 验收

- expected-before、TTL、nonce、hash、幂等、审批、锁、journal、超时、崩溃恢复和回滚测试通过。
- 预览、确认、审批、排队、取消、安全重试、hold、恢复、结果和证据历史形成受控状态机。
- 每个生产动作逐项确认并保留备份、hash、smoke、rollback 和 redacted evidence。
