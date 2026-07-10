# 长期运营 Readiness

## 目标

本文件是 AreaForge 的只读运营证据聚合入口。它不替代生产 runbook，也不授予 Web runtime 服务器命令能力；它只定义长期运营时应收集哪些证据、多久视为新鲜、缺失时如何降级。

当前生产源事实仍以 `docs/development/package-e-remote-github-release-record.md`、`docs/deployment/github-release-updater.md`、服务器 updater 状态和最新 release 记录为准。

## 当前基线

- 线上地址：`https://forge.areasong.top/`
- 当前版本：`0.1.5`
- 当前 Release：`v0.1.5`
- 更新模式：Web 版本中心提交受控请求，服务器侧 update-agent/updater 执行签名校验、备份、migration、切换、smoke 和回滚。
- 默认自动策略：`AREAFORGE_AUTO_APPLY=none`
- Web runtime 边界：不得执行 Docker、备份、恢复、migration、回滚、shell 或服务器命令。

## 运营状态

| 状态 | 含义 | 处理 |
|---|---|---|
| `pass` | 证据新鲜且满足阈值 | 可作为发布或健康结论的一部分 |
| `warn` | 核心服务可用，但证据不完整或接近阈值 | 记录 residual ID，发布前补证据 |
| `fail` | 证据证明功能、发布、更新或安全边界失败 | 进入 incident 或 release rollback 判断 |
| `blocked` | 缺少备份、签名、digest、确认或密钥安全证据，不能继续高风险动作 | 停止对应动作，补齐证据 |
| `unknown` | 没有当前证据或证据来源不可信 | 不得宣称健康或企业级就绪 |

## 证据窗口

| 信号 | 新鲜窗口 | 缺失默认状态 | 证据来源 |
|---|---:|---|---|
| Public health | 发布/更新后立即；日常检查 15 分钟内 | `warn` | `GET /api/health` |
| Authenticated smoke | 发布/更新后立即；日常 24 小时内 | `warn` | `pnpm smoke:prod-readonly` 或人工记录 |
| Release identity | 每次 release/update 必须记录 | `fail` | GitHub Release、manifest、digest、health |
| Update-agent status | 发布/更新后立即；日常 24 小时内 | `warn` | `/api/system/update-status` 或 server status |
| Backup freshness | migration/update/rollback 前必须是当前备份；日常 24 小时内 | `blocked` | DB dump、uploads archive、env/config backup hash |
| Rollback target | 每次 release/update 必须记录 | `blocked` | previous image/version、rollback plan |
| Disk capacity | 日常 24 小时内 | `warn` | server disk check |
| Certificate expiry | 到期前 14 天内为 `warn`，7 天内为 `blocked` | `warn` | TLS certificate check |
| AI fallback/provider | AI 变更或 provider incident 后必须记录 | `warn` | AI route smoke、redacted logs |
| Upload access | 上传/附件变更或 release smoke 时记录 | `warn` | authenticated upload/download or read-only attachment smoke |

## Readiness 摘要模板

```text
checkedAt:
environment:
release:
  version:
  tag:
  webImageDigest:
  migrationImageDigest:
health:
  status:
  evidence:
authenticatedSmoke:
  status:
  evidence:
updateAgent:
  status:
  blocker:
  autoApply:
backup:
  status:
  latestDatabaseBackup:
  latestUploadsBackup:
  envConfigBackup:
rollback:
  status:
  previousVersion:
  previousImageDigest:
infrastructure:
  disk:
  certificate:
residualRiskIds:
  -
overall:
  pass/warn/fail/blocked/unknown
```

## 只读检查

本仓库提供的 `pnpm ops:readiness` 只检查运营文档、残余风险台账、release workflow 和 package scripts 是否保留长期运营入口；它不连接生产、不读取密钥、不执行 Docker、不备份、不恢复、不运行 migration。残余风险 Markdown 与机器索引的同步由 `pnpm residuals:validate` 校验。

本仓库还提供只读运营摘要生成：

```bash
pnpm ops:readiness:summary
```

默认没有配置时，该命令只输出 `unknown` 证据摘要并退出 0。需要采集真实环境证据时，可设置：

```bash
AREAFORGE_READINESS_BASE_URL=https://forge.areasong.top
AREAFORGE_READINESS_EXPECTED_VERSION=0.1.5
AREAFORGE_READINESS_RELEASE_TAG=v0.1.5
AREAFORGE_READINESS_WEB_IMAGE_DIGEST=ghcr.io/areasong/areaforge-web:v0.1.5@sha256:...
AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST=ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:...
AREAFORGE_READINESS_EXPECTED_AUTO_APPLY=none
AREAFORGE_READINESS_UPDATE_STATUS_FILE=/path/to/redacted-status.json
AREAFORGE_READINESS_SMOKE_RESULT_FILE=/path/to/smoke-output.txt
AREAFORGE_READINESS_BACKUP_EVIDENCE='db sha256:<64 hex>; uploads sha256:<64 hex>'
AREAFORGE_READINESS_FAIL_ON=fail
pnpm ops:readiness:summary
```

该摘要脚本只做 HTTP health、可选登录读取 `/api/system/update-status`、可选本地 JSON 文件读取和环境变量解析；不得执行 Docker、备份、恢复、migration、回滚、shell 或服务器命令。输出中的 `safetyFacts` 会显式记录 `serverCommandAttempted=false`、`backupRestoreAttempted=false`、`migrationAttempted=false`、`productionWriteAttempted=false`、`secretValuePrinted=false`、`smokePasswordReadFromFile` 和 `networkRequested`。若提供 `AREAFORGE_SMOKE_EMAIL` 和 `AREAFORGE_SMOKE_PASSWORD_FILE`，它会登录后只读获取 update status；若不提供凭据，则 update-agent 证据为 `unknown` 并关联 `AF-RISK-OPS-001`。

发布或更新完成后，建议把 redacted `pnpm ops:readiness:summary` 输出保存到运维目录，并在版本化 release record 中摘要
`checkedAt`、health、update-agent、smoke、backup、rollback、disk/cert 和 residual risk IDs。没有新鲜 smoke、备份或基础设施证据时，release readiness 只能保持 `warn` 或 `unknown`，不能宣称完整生产健康。

本地真实体验验证可使用 `pnpm smoke:local-ux`。该脚本会写入合成任务、计时、复盘、笔记附件、错题、模拟考试、阶段草稿和更新请求，因此默认要求 `AREAFORGE_SMOKE_ALLOW_WRITES=true`，且只允许 `localhost` / `127.0.0.1`，除非显式设置 `AREAFORGE_SMOKE_ALLOW_NON_LOCAL=true`。它只能证明当前本地验证环境的核心闭环可用，不能关闭生产写入型 smoke 残余项 `AF-RISK-OPS-002`。

生产 smoke 与告警策略见 `docs/development/production-smoke-alerting-strategy.md`。该文档只定义写入型 smoke 的确认字段、合成数据命名空间、清理/失败处理和告警阈值；没有用户确认、专用账号、清理策略和实际记录前，不得执行生产写入型 smoke，也不得关闭 `AF-RISK-OPS-002` 或 `AF-RISK-OPS-004`。

生产 evidence 采集仍需要按 `docs/deployment/github-release-updater.md`、`docs/development/production-release-runbook.md` 和 `ops/github-release-updater/README.md` 执行。任何写入动作都必须先通过高风险确认。

## 残余边界

长期运营未完成项不应散落在自然语言里。影响发布或运维判断的项目必须进入 `docs/development/residual-risk-ledger.md`，使用稳定 ID、类型、影响、关闭条件和所需证据。

当前 release / ops 判断必须显式带入以下残余项：

- `AF-RISK-OPS-001`：生产 extra smoke 证据缺失时，体验验证只能到 `warn`。
- `AF-RISK-OPS-002`：写入型生产 smoke 策略已有非执行草案，但仍缺专用账号、用户确认、清理策略和受控记录。
- `AF-RISK-REL-001`：`AREAFORGE_AUTO_APPLY=none` 是已接受的安全默认，不等于自动应用能力已启用。
- `AF-RISK-SC-001`：SBOM/provenance 生成路径已接入 Release workflow；线上 `v0.1.5` 仍无对应资产，需下一次签名 Release 的校验和发布记录证据关闭。
- `AF-RISK-SC-002`：Actions SHA pinning 和 `pnpm audit:prod` 已在本地 workflow / governance gate 落地，仍需下一次 GitHub CI 或签名 Release 运行证据关闭。
- `AF-RISK-SC-003`：`pg@9` 未来弃用 warning 需要在 `pg` / Prisma adapter 升级前定位或接受。
- `AF-RISK-OPS-003`：未来服务器、域名、Nginx 或端口迁移需单独 release/ops 记录。
- `AF-RISK-OPS-004`：告警阈值已有非执行策略，metrics dashboard、外部告警接收人和演练记录仍未产品化。
