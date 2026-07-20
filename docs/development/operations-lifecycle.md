# AreaForge Operations Lifecycle

本文件定义 AreaForge 最小 operations lifecycle（运行生命周期）机器契约。机器源文件是
[`operations-lifecycle.json`](operations-lifecycle.json)，校验入口是：

```bash
pnpm ops:lifecycle:validate
pnpm ops:lifecycle:selftest
pnpm ops:lifecycle:typecheck
```

## 契约边界

- 契约只读取仓库内 JSON、文档和 residual ledger，不连接网络或生产，不读取 secrets。
- 契约不修改 incident runtime、生产配置、数据库、备份、上传目录或 residual 状态。
- `active` 表示已有明确、可校验的测量来源，不表示最新生产证据当前为 green 或 fresh。
- `draft` 是规划目标，不构成已达成声明。availability、latency 在没有 metrics source 前禁止变为 `active`。
- validator 只证明 schema、引用、状态和安全边界一致，不替代 live evidence、演练或维护者人工复核。

## SLO 基线

当前只有三个 SLO 为 `active`：

| ID | 含义 | 可测量来源 | 目标 |
|---|---|---|---|
| `AF-SLO-HEALTH-001` | 公共 health observation 新鲜度 | operational evidence bundle 的 health signal 与 freshness | 不超过 14 天 |
| `AF-SLO-SMOKE-001` | 认证只读 smoke 新鲜度 | production readonly smoke record validator | 不超过 24 小时 |
| `AF-SLO-SEC-001` | 已知安全不变量违反 | secret scan、incident index、residual ledger | 零容忍 |

availability、read latency p95、RTO 与 RPO 保持 `draft`。其中 99.9%、500 ms、4 小时和 1 小时只用于建立后续测量结构，不能写成当前生产承诺或达成证据。

## Incident Lifecycle

状态沿用现有 incident record：`open`、`mitigated`、`follow-up`、`resolved`。JSON 中的
`allowedTransitions` 是允许迁移表，不是迁移执行器：

- 进入 `mitigated` 需要止损或 containment evidence。
- 进入 `follow-up` 需要影响已受控并绑定 residual risk IDs。
- 进入 `resolved` 需要 recovery evidence 和 post-incident review。
- `resolved` 是本记录的终态；新发或复发影响必须创建新的 incident，并在后续记录中引用原事故，不能改写已解决历史。

本契约不新增 `closed` runtime 状态，也不把 incident `resolved` 等同于 residual 已关闭。

## Capability Lifecycle

能力同时记录两个正交状态：

- `lifecycleStatus`：`planned`、`active`、`deprecated`、`retiring`、`archived`，描述长期能力生命周期。
- `executionState`：复用外部能力准入的 `closed`、`preview_only`、`fixture_only`、`confirmed_apply`、`production_scoped`、`suspended`，描述当前执行开闸状态。

因此生命周期与执行开闸可以独立变化。例如 server-side update apply 是 `active + confirmed_apply`，表示
它只能在明确确认、签名、备份、smoke 和回滚门禁下执行；`AREAFORGE_AUTO_APPLY=none` 仍禁止静默自动应用，
Web runtime 仍不能执行服务器命令。

`AF-CAP-POST-RELEASE-OBSERVATION` 是 `active + preview_only` 的记录能力：每个生产 Release 使用
`post-release-observation-template.json` 建立 D14 technical/incident/error-budget gate 和 D30 product-review gate。
具体版本记录由 `pnpm release:post-observation:validate <record>` 校验，并由
`pnpm release:post-observation:status <record>` 投影 `pending_observation`、`needs_attention`、`blocked`、
`ready_for_human_review`。窗口、观察结果和 `{path, sha256}` 证据只写在对应 observation 记录中，不复制到
lifecycle 契约，也不由 lifecycle validator 自动推进。
空证据槽只表示尚待观察，不能解释为健康、失败或 residual 已关闭。

`deprecated`、`retiring`、`archived` 必须填写 `closeCondition`，说明调用方迁移、写入口关闭、数据处置、权限/密钥/自动化关闭和验证证据。validator 不执行这些关闭动作。

## Residual 与安全

- 所有 `residualRiskIds` 必须存在于 `residual-risk-ledger.json`。
- `active` SLO 和 `active` capability 不能只绑定 `closed-evidence`，否则会把历史关闭证据误写成当前风险覆盖。
- `safetyFacts` 必须精确保持只读：无网络、无生产访问、无服务器命令、无数据库或生产写入、无 secret 文件读取或值输出、无 residual 更新、无 incident runtime 变化。
- validator 会拒绝常见 token、password、private key、database URL 等 secret-like 内容；路径和命令只允许描述只读证据入口。

本契约借鉴 AreaFlow 的 SLO/incident 证据约束，以及 AreaMatrix 的 capability lifecycle，但不引入 metrics 平台、runtime registry、command queue、自动状态迁移或重型治理框架。
