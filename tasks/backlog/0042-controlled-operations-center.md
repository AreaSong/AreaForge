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

## 当前进度

- 已落地只读 operation catalog：`CHECK_RELEASE`、`BACKUP_PREVIEW`、`APPLY_RELEASE`、`ROLLBACK_RELEASE`、`MAINTENANCE_HOLD`、`DIAGNOSTIC_HEALTH`。
- 已落地 strict typed intent 校验；参数不接受命令文本、脚本、自由路径或环境变量。
- 已增加仅供平台 Operator 读取的 `/api/system/operations`，它不会创建请求、调用 updater 或执行服务器动作。
- 已新增平台无关的纯请求状态机，并形成持久请求候选：高风险操作必须经过确认与审批；worker lease、hold/resume、取消、重试、过期、CAS 和错误 worker 均按允许的状态转换 fail closed。
- 本地候选已接通 `/api/system/operations/requests/**` 生命周期路由（confirm/approve/cancel/hold/resume/retry/lease/expiry）和 Operator UI；候选 migration 只在一次性隔离 PostgreSQL fixture 中验证，未 apply 到共享测试库或生产。
- 已增加 report-only 的 strict hash-chain phase journal、固定锁顺序和 reconciliation reducer；它只消费脱敏证据，不写文件、不取得锁、不执行命令。尚未实现 root-agent phase journal 的实际写入、跨进程锁、崩溃恢复/reconciliation 执行、真实 updater 执行、生产 apply 或 rollback；Web runtime 仍只提交受控请求。

## 永久禁止

- 任意 shell、命令文本、脚本正文、自由路径或任意环境变量。
- Web runtime 挂载 Docker socket、root 权限、生产 `.env`、备份目录或签名私钥。

## 验收

- expected-before、TTL、nonce、hash、幂等、审批、锁、journal、超时、崩溃恢复和回滚测试通过。
- 预览、确认、审批、排队、取消、安全重试、hold、恢复、结果和证据历史形成受控状态机。
- 每个生产动作逐项确认并保留备份、hash、smoke、rollback 和 redacted evidence。
