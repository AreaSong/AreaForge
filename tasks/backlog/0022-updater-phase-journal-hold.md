# Updater 阶段日志与维护 Hold/Drain

```yaml
status: awaiting-high-risk-confirmation
risk: high
ownerSkill: areaforge-sre-ops
validation:
  - updater phase crash selftest
  - hold/drain claim selftest
  - pnpm shellcheck:updater
residualRiskIds:
  - AF-RISK-OPS-008
releaseRequired: true
```

目标：增加 root-only append-only/atomic updater phase journal，并提供只允许服务器运维控制的 hold/drain，
在维护窗口停止领取新请求、保留当前 claim 和阶段证据。Web runtime 不获得服务器命令或 hold 写权限；
生产 timer、队列和 updater 策略变化仍需单独确认。
