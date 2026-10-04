# AreaForge Alerting

服务器侧只读告警推送 helper，服务于 `AF-RISK-OPS-004`（外部告警接收人与演练）。部署与演练步骤见 `docs/deployment/alerting.md`；阈值口径见 `docs/development/production-smoke-alerting-strategy.md`。

## 文件

- `areaforge-alert-notify.sh`：采集 health、update-agent 状态新鲜度、备份新鲜度、磁盘容量、证书到期五类只读信号，按阈值汇总 severity，`notify` 模式推送到 ntfy/Telegram/webhook 接收人。
- `areaforge-alert-notify.service` / `areaforge-alert-notify.timer`：systemd 定时示例。
- `areaforge-alerting.env.example`：配置模板；真实配置放 `/etc/areaforge/alerting.env` 并 `chmod 600`。

## 边界

- 只读：不执行 updater apply、migration、备份、恢复、回滚、Docker、Nginx、compose、数据库写入或上传目录写入。
- Redacted：推送文本只含信号名、severity 与摘要；token 只从 `chmod 600` 文件读取，不进入日志与推送内容。
- 该 helper 发出的通知不关闭任何 residual；关闭 `AF-RISK-OPS-004` 仍需真实接收人配置、一次告警/恢复演练记录、`pnpm alert:drill:validate` 与 `pnpm ops:ops-004:preflight` 通过后的人工复核。

## 快速使用

```bash
# 只评估并打印 redacted 摘要（不推送、不写 dedup 状态）
./areaforge-alert-notify.sh check --config /etc/areaforge/alerting.env

# 评估并按需推送（unchanged 降噪、恢复时发 recovery 通知）
./areaforge-alert-notify.sh notify --config /etc/areaforge/alerting.env

# 演练前先看决策
./areaforge-alert-notify.sh notify --dry-run --config /etc/areaforge/alerting.env
```

退出码：`0` 全部通过、`10` 存在 warning、`20` 存在 critical、`2` 用法或环境错误。
