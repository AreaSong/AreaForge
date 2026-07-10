# 残余风险台账

## 目标

本文件只记录会影响后续发布、生产运维、安全、供应链或真实体验判断的残余项。它不是普通 backlog，也不表示当前 docs 100% 功能未完成。

机器可读索引见 `docs/development/residual-risk-ledger.json`，并由 `pnpm residuals:validate` 校验与本文同步。

状态类型遵循 `.codex/skills-src/areaforge-residual-ledger/references/classification.md`：

- `current-blocker`
- `deferred-work`
- `accepted-exception`
- `monitoring-gap`
- `release-follow-up`
- `historical-reference`
- `template-marker`
- `closed-evidence`

## 编号规则

- `AF-RISK-OPS-*`：生产运维、备份、smoke、update-agent、基础设施。
- `AF-RISK-REL-*`：发布、自动更新、回滚和 release evidence。
- `AF-RISK-SC-*`：供应链、签名、依赖、SBOM/provenance。
- `AF-RISK-UX-*`：真实体验、可用性、端到端体验证据。
- `AF-RISK-AI-*`：AI provider、隐私、费用、fallback。

## 当前残余项

| ID | 类型 | 当前影响 | 可立即执行 | 关闭条件 | 所需证据 | Owner |
|---|---|---|---|---|---|---|
| AF-RISK-OPS-001 | monitoring-gap | 生产 extra smoke 仍依赖服务器配置；没有新鲜 smoke 记录时，发布体验验证只能到 `warn` | 是 | 服务器配置 `AREAFORGE_EXTRA_SMOKE_COMMAND`、smoke 密码文件和最近一次通过记录 | redacted updater env 摘要、`pnpm smoke:prod-readonly` 通过时间、update-record 摘要 | `areaforge-sre-ops` / `areaforge-qa-smoke` |
| AF-RISK-OPS-002 | deferred-work | 写入型生产 smoke 策略未定义；默认不污染生产业务数据 | 否 | 明确 smoke 账号、数据清理策略、允许写入范围、失败回滚方式并获确认 | 策略文档、测试账号、写入和清理 smoke 记录 | `areaforge-qa-smoke` / `areaforge-security-governance` |
| AF-RISK-REL-001 | accepted-exception | `AREAFORGE_AUTO_APPLY=none` 是当前安全默认；patch 自动应用尚未启用 | 否 | 用户明确确认 patch 自动应用，且签名、备份、extra smoke、rollback target 和 manifest policy 同时满足 | 确认记录、updater env 摘要、release manifest、smoke 和 rollback evidence | `areaforge-release-operator` / `areaforge-sre-ops` |
| AF-RISK-SC-001 | deferred-work | 当前 release 依赖签名、hash 和 digest；尚未生成 SBOM/provenance attestation | 否 | Release workflow 生成并发布 SBOM/provenance，updater或验证脚本记录校验结果 | SBOM asset、provenance attestation、验证命令输出 | `areaforge-supply-chain` |
| AF-RISK-SC-002 | deferred-work | GitHub Actions 当前至少 pin 到主版本；尚未 pin 到完整 commit SHA，也未接入独立 vulnerability scan | 否 | Actions 依赖完成 SHA pinning 或有等价供应链策略，且发布/CI 记录 vulnerability scan 结果 | workflow diff、Dependabot/renovate 策略、vulnerability scan 输出、风险接受或关闭记录 | `areaforge-supply-chain` / `areaforge-enterprise-governance` |
| AF-RISK-OPS-003 | deferred-work | 未来服务器、域名、Nginx 或端口迁移会影响公网 health 和 updater 状态 | 否 | 新迁移 runbook、备份、Nginx/compose hash、health、rollback 记录齐全 | 迁移记录、release/update evidence、DNS/TLS 检查 | `areaforge-sre-ops` |
| AF-RISK-OPS-004 | monitoring-gap | 结构化 metrics dashboard 和告警路由不是当前产品功能；健康判断依赖 runbook 和只读证据 | 否 | 建立外部告警接收人、阈值、演练记录，或明确接受人工巡检窗口 | 告警配置摘要、演练记录、阈值文档 | `areaforge-observability` |

## 关闭规则

- 关闭残余项必须追加证据，不从“看起来没问题”关闭。
- 若残余项变成当前发布或事故阻塞，应升级为 `current-blocker` 并写入任务或 incident 记录。
- 历史 release 记录中的旧限制不改写；如会误导当前状态，在当前台账中标为 historical reference 或 closed evidence。
