# Production Smoke And Alerting Strategy

本文件是生产 smoke 和告警策略的非执行草案。它不授权任何生产写入，不替代 `docs/development/production-release-runbook.md`，也不关闭 `AF-RISK-OPS-001`、`AF-RISK-OPS-002`、`AF-RISK-OPS-004` 或 `AF-RISK-OPS-005`。`AF-RISK-UX-001` 已由本地 desktop/mobile 体验复核关闭为证据项；2026-07-10 记录是历史证据，2026-07-12 已新增本地 `0.1.7` 复核记录，但后续 release/update、体验改动或超过 14 天维护窗口前仍需重跑。

## 默认边界

- 生产默认只运行只读 smoke：health、登录、dashboard、update status、可选已知附件鉴权下载。
- 写入型生产 smoke 必须单独确认，且只能使用专用 smoke 账号和合成数据。
- Web runtime 仍不得执行 Docker、备份、恢复、migration、updater apply、rollback、shell 或服务器命令。
- smoke 记录不得包含密码、session cookie、数据库 URL、API key、上传绝对路径、完整 prompt/raw response 或真实学习内容。
- AI smoke 默认只验证 fallback 或最小化 provider 路径，不发送动机档案、完整情绪记录、完整复盘正文、附件内容或完整任务标题。
- 生产 smoke 只能证明目标路径可用；若要声明桌面/移动真实体验健康，必须另有 `pnpm experience:review:validate` 通过的体验复核记录。

## 只读生产 Smoke

推荐由 `AREAFORGE_EXTRA_SMOKE_COMMAND` 指向 `pnpm smoke:prod-readonly` 或等价只读脚本。

必需证据：

- base URL、版本、release tag、web/migration image digest。
- smoke 账号来源和密码文件路径的 redacted 摘要。
- health、登录、dashboard、update status 结果。
- 可选附件 ID 的鉴权下载结果；只读下载不得改 metadata。
- `docs/development/production-readonly-smoke-record-template.md` 格式记录，并通过 `pnpm smoke:prod-readonly:validate <record>`。
- 执行前先运行 `pnpm smoke:prod-readonly:config`，只读检查 HTTPS base URL、extra smoke 命令、smoke 账号、密码文件权限、期望版本和自动更新策略。
- 可用 `pnpm smoke:prod-readonly:record <smoke-output.log>` 从 smoke 输出和 release manifest/digest 环境变量生成 redacted 记录草稿；生成器不读取密码文件内容、不执行服务器命令、不写生产。
- `pnpm ops:readiness:summary` 输出，包含 `safetyFacts` 和 residual risk IDs。
- 若生产主机缺 Node.js/pnpm，可用 `ops/update-agent/areaforge-ops001-readonly-fallback.sh` 在服务器侧生成 curl 只读 smoke 输出和 redacted update-agent status，再复制 redacted 输出回本地运行 `pnpm ops:ops-001:fallback:finalize <redacted-fallback-dir> [output-dir]`；从 fallback 输出手动生成记录时设置 `AREAFORGE_PROD_READONLY_SMOKE_COMMAND=ops/update-agent/areaforge-ops001-readonly-fallback.sh`；fallback helper 缺配置时只形成 blocker evidence，不关闭 `AF-RISK-OPS-001`。

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

演练记录模板见 `docs/development/alert-drill-record-template.md`。已有 `pnpm ops:alert:preview` 输出时，可用 `pnpm alert:drill:record <ops-alert-preview.json>` 生成记录草稿；生成器要求操作者显式填写接收人配置、ACK、检测结果、恢复结果和恢复动作说明，不发送通知、不调用外部告警接收人、不写生产。记录完成后运行 `pnpm alert:drill:validate <alert-drill-record.md|txt>`，该命令只读记录并校验字段、枚举、hash、`AF-RISK-OPS-004` 和敏感值泄露，不发送通知。关闭 OPS-004 前再运行 `pnpm ops:ops-004:preflight`，用同一次 alert preview 文件和演练记录证明 hash 对齐；该预检不发送通知、不调用外部接收人、不改台账。

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
| Product experience review | 14 天内无 desktop/mobile 体验复核，或 release/update 后未重跑 | release/update 后声称体验健康但无复核记录 | `areaforge-product-experience` / `areaforge-qa-smoke` |

## 关闭残余项所需动作

- `AF-RISK-OPS-001`：服务器配置只读 extra smoke、smoke 密码文件和最近一次通过记录；host 缺 pnpm 时允许等价 curl fallback 输出，但最终仍需本地 record/evidence/closure 校验。
- `AF-RISK-OPS-002`：确认写入型 smoke 账号、允许写入范围、清理策略、失败处理和至少一次受控记录。
- `AF-RISK-OPS-004`：配置外部告警接收人或人工值班窗口，并完成一次告警/恢复演练记录；`pnpm ops:alert:preview`、`pnpm alert:drill:validate` 和 `pnpm ops:ops-004:preflight` 只能作为演练输入、记录校验与证据预检，不自动关闭该残余项。
- `AF-RISK-OPS-005`：生产更新 mutation 必须在本地 V2 实施、签名 Release 和独立生产部署后，以 `pnpm ops:ops-005:evidence:validate` 与 `pnpm ops:ops-005:preflight` 复核 expected-before rejection、共享锁和 reconciliation；smoke 或告警通过不能替代该控制面证据。
- `AF-RISK-UX-001`：已关闭为证据项；新的 release/update 或体验变更仍必须完成覆盖 desktop/mobile 的真实体验复核记录并通过 `pnpm experience:review:validate`，生产 smoke、API smoke 或旧截图不能替代。
