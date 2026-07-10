# Production Smoke And Alerting Strategy

本文件是生产 smoke 和告警策略的非执行草案。它不授权任何生产写入，不替代 `docs/development/production-release-runbook.md`，也不关闭 `AF-RISK-OPS-001`、`AF-RISK-OPS-002` 或 `AF-RISK-OPS-004`。

## 默认边界

- 生产默认只运行只读 smoke：health、登录、dashboard、update status、可选已知附件鉴权下载。
- 写入型生产 smoke 必须单独确认，且只能使用专用 smoke 账号和合成数据。
- Web runtime 仍不得执行 Docker、备份、恢复、migration、updater apply、rollback、shell 或服务器命令。
- smoke 记录不得包含密码、session cookie、数据库 URL、API key、上传绝对路径、完整 prompt/raw response 或真实学习内容。
- AI smoke 默认只验证 fallback 或最小化 provider 路径，不发送动机档案、完整情绪记录、完整复盘正文、附件内容或完整任务标题。

## 只读生产 Smoke

推荐由 `AREAFORGE_EXTRA_SMOKE_COMMAND` 指向 `pnpm smoke:prod-readonly` 或等价只读脚本。

必需证据：

- base URL、版本、release tag、web/migration image digest。
- smoke 账号来源和密码文件路径的 redacted 摘要。
- health、登录、dashboard、update status 结果。
- 可选附件 ID 的鉴权下载结果；只读下载不得改 metadata。
- `pnpm ops:readiness:summary` 输出，包含 `safetyFacts` 和 residual risk IDs。

## 写入型生产 Smoke

写入型 smoke 只能在用户明确确认后运行。确认包至少包含：

- smoke 账号：专用邮箱、权限范围、禁用真实学习数据复用。
- 数据命名空间：所有合成任务、笔记、附件、模拟考试和更新请求标题必须以 `[AF_SMOKE]` 开头。
- 允许写入范围：任务创建/完成、计时开始/结束、复盘保存、合成 note 附件上传/下载、模拟考试创建/结果保存、阶段草稿创建、update request 队列写入。
- 禁止范围：删除真实任务或附件、批量修改历史数据、真实 AI 敏感外呼、自动应用更新、生产 migration、备份/恢复、Nginx/compose/server 变更。
- 清理策略：优先软标记或按 `[AF_SMOKE]` 前缀清理；若清理会触碰真实数据或缺少确认，则保留合成数据并记录残余。
- 失败处理：停止后续写入，记录已写入对象 ID、是否需要人工清理、是否影响 release/update 结论。
- 回滚策略：写入 smoke 不作为数据库恢复触发器；只有用户确认且备份/恢复 runbook 满足时，才可考虑数据恢复。

写入型 smoke 通过后仍只能证明专用 synthetic journey 可用，不能证明所有真实学习数据都无问题。

## 告警阈值

阈值预览可以通过只读命令生成：

```bash
pnpm ops:alert:preview
```

该命令只读取 readiness 信号并输出 `read_only_alert_preview`、severity、`wouldNotify`、owner 和 recommendedAction；它不调用外部告警接收人，不发送通知，不执行服务器命令，不写生产数据。预览通过只能证明规则映射可执行，不能替代真实接收人配置、metrics dashboard 或演练记录。

| 信号 | warn | blocked/fail | Owner |
|---|---|---|---|
| Public health | 单次失败后 5 分钟内未复测 | 连续失败或版本不符 | `areaforge-sre-ops` |
| Authenticated smoke | 24 小时内无通过记录 | release/update 后无通过记录 | `areaforge-qa-smoke` |
| Update-agent | timer 状态 unknown 或 stale | blocker 非空、签名非 required | `areaforge-sre-ops` |
| Backup freshness | 日常超过 24 小时无 hash 证据 | migration/update/rollback 前无当前备份 | `areaforge-sre-ops` |
| Disk capacity | 小于 20% 可用或备份分区接近阈值 | 小于 10% 可用或写入失败 | `areaforge-sre-ops` |
| Certificate expiry | 剩余 14 天内 | 剩余 7 天内 | `areaforge-sre-ops` |
| Release identity | digest 或 tag 缺失 | health、tag、digest 不一致 | `areaforge-release-operator` |
| AI fallback/provider | fallback 证据缺失 | raw prompt/key 泄露或外呼风暴 | `areaforge-ai-governance` |
| Upload access | 24 小时内无附件 smoke | 公共暴露、hash mismatch、owner 无法下载 | `areaforge-security-governance` |

## 关闭残余项所需动作

- `AF-RISK-OPS-001`：服务器配置只读 extra smoke、smoke 密码文件和最近一次通过记录。
- `AF-RISK-OPS-002`：确认写入型 smoke 账号、允许写入范围、清理策略、失败处理和至少一次受控记录。
- `AF-RISK-OPS-004`：配置外部告警接收人或人工值班窗口，并完成一次告警/恢复演练记录；`pnpm ops:alert:preview` 只能作为演练输入，不单独关闭该残余项。
