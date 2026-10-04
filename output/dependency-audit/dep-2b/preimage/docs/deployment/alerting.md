# 告警推送部署

## 定位

本文说明如何在生产服务器上部署 AreaForge 只读告警推送 helper（`ops/alerting/`），把 health、update-agent 状态新鲜度、备份新鲜度、磁盘容量、证书到期五类信号推送给真实接收人。它服务于 `AF-RISK-OPS-004` 的关闭条件：外部告警接收人或人工值班窗口，加一次告警/恢复演练记录。

阈值口径的源事实是 `docs/development/production-smoke-alerting-strategy.md`；本 helper 只覆盖服务器侧可只读采集的信号子集，`pnpm ops:alert:preview` 仍是仓库侧的规则映射预览。

## 边界

- helper 只读：不执行 updater apply、migration、备份、恢复、回滚、Docker、Nginx、compose、数据库写入或上传目录写入。
- 推送内容 redacted：只含信号名、severity 与摘要文本；不包含密钥、cookie、数据库 URL、上传路径或真实学习内容。
- 接收人 token 只从 `chmod 600` 的文件读取；权限过宽会拒绝使用并记录日志。
- 通知发送成功不关闭 `AF-RISK-OPS-004`；关闭仍需演练记录、`pnpm alert:drill:validate`、`pnpm ops:ops-004:preflight` 与人工复核。

## 信号与阈值

| 信号 | warning | critical | 数据来源 |
|---|---|---|---|
| health | 首次失败重试后才通过，或未配置 URL | 两次失败、`ok=false` 或版本不符 | `AREAFORGE_ALERT_HEALTH_URL` |
| update-agent | 状态文件缺失、时间戳缺失或超过 `AREAFORGE_ALERT_UPDATE_AGENT_MAX_AGE_HOURS` | blocker 非空或签名校验未开启 | update-agent `status.json` |
| backup-freshness | 最新备份超过 `AREAFORGE_ALERT_BACKUP_MAX_AGE_HOURS` | 备份目录缺失或没有任何备份文件 | 备份目录文件 mtime |
| disk-deploy / disk-backup | 可用低于 `AREAFORGE_ALERT_DISK_WARN_AVAIL_PERCENT` | 可用低于 `AREAFORGE_ALERT_DISK_CRIT_AVAIL_PERCENT` | `df` |
| certificate-expiry | 剩余天数低于 `AREAFORGE_ALERT_CERT_WARN_DAYS` | 剩余天数低于 `AREAFORGE_ALERT_CERT_CRIT_DAYS` | 证书文件或 TLS 探测 |

汇总 severity 取信号最大值；退出码 `0`=info、`10`=warning、`20`=critical、`2`=用法或环境错误。

## 安装

以下命令由维护者在服务器上以 root 执行；仓库侧不远程执行服务器命令。

```bash
# 1. 同步 helper（部署目录以实际为准）
install -d /opt/areaforge/ops/alerting
install -m 755 ops/alerting/areaforge-alert-notify.sh /opt/areaforge/ops/alerting/

# 2. 配置接收人与信号来源
install -m 600 ops/alerting/areaforge-alerting.env.example /etc/areaforge/alerting.env
vi /etc/areaforge/alerting.env   # 填 health URL、接收人；token 放独立 chmod 600 文件

# 3. 先手工验证一次（只打印，不推送）
/opt/areaforge/ops/alerting/areaforge-alert-notify.sh check --config /etc/areaforge/alerting.env

# 4. 安装 systemd timer
install -m 644 ops/alerting/areaforge-alert-notify.service /etc/systemd/system/
install -m 644 ops/alerting/areaforge-alert-notify.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now areaforge-alert-notify.timer
systemctl list-timers areaforge-alert-notify.timer
```

接收人配置三选一（可叠加）：

- ntfy：`AREAFORGE_ALERT_NTFY_URL` 指向私有 topic；可选 `AREAFORGE_ALERT_NTFY_TOKEN_FILE`。
- Telegram：`AREAFORGE_ALERT_TELEGRAM_BOT_TOKEN_FILE`（`chmod 600` 文件）+ `AREAFORGE_ALERT_TELEGRAM_CHAT_ID`。
- 通用 webhook：`AREAFORGE_ALERT_WEBHOOK_URL`，接收 redacted 摘要 JSON POST。

## 降噪与恢复通知

- 同一 degraded payload（信号名 + severity 集合不变）在 `AREAFORGE_ALERT_RENOTIFY_MINUTES` 内不重复推送。
- 信号全部恢复 info 时推送一次 recovery 通知，然后保持静默。
- 去重状态保存在 `AREAFORGE_ALERT_STATE_DIR`（默认 update-agent 同级的 `ops-state/alerting/`），删除该目录只会导致下一次重新推送，不影响信号判断。

## 告警/恢复演练

关闭 `AF-RISK-OPS-004` 前，用真实接收人完成一次演练并留记录：

1. 服务器：`areaforge-alert-notify.sh notify --dry-run` 确认决策，然后用一个可控的降级条件（例如临时把 `AREAFORGE_ALERT_BACKUP_MAX_AGE_HOURS` 调小）触发一次真实推送，确认接收人收到；恢复配置后确认收到 recovery 通知。
2. 仓库侧：`pnpm ops:alert:preview` 保存预览 JSON，`pnpm alert:drill:record <ops-alert-preview.json>` 生成演练记录草稿，填写接收人配置、ACK、检测与恢复结果。
3. 校验：`pnpm alert:drill:validate <record>`，再跑 `pnpm ops:ops-004:preflight` 确认 preview 与演练记录 hash 对齐。
4. 残余项关闭与否仍由维护者按 `docs/development/residual-risk-ledger.md` 人工决定。

## 故障排查

- `exit 2` 且日志提示 `required command not found`：安装 `jq`、`curl`（证书探测另需 `openssl`）。
- 收不到通知：先 `check` 确认 severity 非 info，再 `notify --dry-run` 看决策是否为 `skip`（unchanged 降噪窗口内属预期）。
- token 文件被拒绝：确认权限为 `600` 且属主正确。
