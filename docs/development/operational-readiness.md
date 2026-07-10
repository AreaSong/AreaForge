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
| Product experience review | 体验改动或 release/update 后立即；日常 14 天内 | `warn` | `pnpm smoke:local-ux`、浏览器截图/观察记录、`pnpm experience:review:validate` |

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

AreaFlow 的 `.areaflow/status.json` 给了 AreaForge 一个轻量借鉴点：保留离线 status projection，但不引入执行队列或跨项目 apply。AreaForge 对应命令是：

```bash
pnpm ops:status
```

该命令只读本地 `package.json`、长期运营入口文件和 `docs/development/residual-risk-ledger.json`，输出 `offline_long_term_operability_status_projection` JSON，包含控制面是否完整、当前版本、residual 类型统计、`reviewAt` 到期状态、可立即执行的残余项、release 相关 residual IDs、每日/每周/release/incident 推荐命令和 `safetyFacts`。它默认不访问网络、不读取密钥、不执行服务器命令、不备份、不恢复、不运行 migration、不写生产，也不写 `.areaforge/status.json`。输出中的 `overall=needs_live_evidence` 表示离线控制面存在但仍缺真实生产 smoke、release 或告警证据；不能用它宣称生产健康。

维护窗口、release 前检查或新线程接手时，使用只读运营交接摘要：

```bash
pnpm ops:handoff
```

该命令复用 `pnpm ops:status` 的离线投影，输出 `read_only_operational_handoff` JSON，把当前版本、控制面状态、release train 状态、可声称/不可声称内容、due residual、release-relevant residual、下一步命令和 `safetyFacts` 集中到一个交接入口。它不访问网络、不读取密钥、不执行服务器命令、不写文件、不备份、不恢复、不运行 migration、不创建 GitHub Release、不执行 updater apply，也不能替代 `pnpm ops:evidence:bundle`、生产只读 smoke、update-agent status、备份或 rollback 证据。`pnpm ops:handoff:selftest` 只在临时 fixture 中校验交接摘要结构。

完成声明证据纪律见 `docs/development/completion-evidence-checklist.md`：ops、release、体验和安全结论必须说明证据等级、新鲜验证、未验证项、阻断项和 residual risk IDs。运行时写动作边界见 `docs/development/runtime-write-boundary.md`：R0 只读、R1 本地写、R2 用户显式 Web 写、R3 update request 和 R4 高风险生产操作不能互相冒充。

本仓库还提供只读运营摘要生成：

```bash
pnpm ops:readiness:summary
```

默认没有配置时，该命令只输出 `unknown` 证据摘要并退出 0。需要采集真实环境证据时，可设置：

```bash
AREAFORGE_READINESS_BASE_URL=https://forge.areasong.top
AREAFORGE_READINESS_EXPECTED_VERSION=0.1.5
AREAFORGE_READINESS_RELEASE_TAG=v0.1.5
AREAFORGE_READINESS_GITHUB_REPO=AreaSong/AreaForge
AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=/path/to/areaforge-release-manifest.json
AREAFORGE_READINESS_RELEASE_MANIFEST_URL=https://github.com/AreaSong/AreaForge/releases/download/v0.1.5/areaforge-release-manifest.json
AREAFORGE_READINESS_WEB_IMAGE_DIGEST=ghcr.io/areasong/areaforge-web:v0.1.5@sha256:...
AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST=ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:...
AREAFORGE_READINESS_EXPECTED_AUTO_APPLY=none
AREAFORGE_READINESS_UPDATE_STATUS_FILE=/path/to/redacted-status.json
AREAFORGE_READINESS_SMOKE_RESULT_FILE=/path/to/smoke-output.txt
AREAFORGE_READINESS_BACKUP_EVIDENCE='db sha256:<64 hex>; uploads sha256:<64 hex>'
AREAFORGE_READINESS_CERT_DAYS=71
AREAFORGE_READINESS_FAIL_ON=fail
pnpm ops:readiness:summary
```

Release identity 采集优先级为：显式 `AREAFORGE_READINESS_WEB_IMAGE_DIGEST` / `AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST`，其次是 `AREAFORGE_READINESS_RELEASE_MANIFEST_FILE`，再次是 `AREAFORGE_READINESS_RELEASE_MANIFEST_URL`，最后可由 `AREAFORGE_READINESS_GITHUB_REPO` + `AREAFORGE_READINESS_RELEASE_TAG` 推导 GitHub Release manifest URL。manifest 只用于只读补齐 release tag、镜像 digest 和资产摘要；它不执行 `SHA256SUMS.sig` / cosign 校验，不替代 updater 签名门禁、SBOM/provenance 证据或下一次 Release 的 `AF-RISK-SC-001` / `AF-RISK-SC-002` 关闭条件。

该摘要脚本只做 HTTP health、HTTPS base URL 的 TLS peer certificate 只读检查、可选登录读取 `/api/system/update-status`、可选本地 JSON 文件读取和环境变量解析；不得执行 Docker、备份、恢复、migration、回滚、shell 或服务器命令。输出中的 `safetyFacts` 会显式记录 `serverCommandAttempted=false`、`backupRestoreAttempted=false`、`migrationAttempted=false`、`productionWriteAttempted=false`、`secretValuePrinted=false`、`smokePasswordReadFromFile` 和 `networkRequested`。若提供 `AREAFORGE_READINESS_CERT_DAYS`，则优先使用该手动证据；否则 HTTPS `baseUrl` 会自动采集证书到期时间。若提供 `AREAFORGE_SMOKE_EMAIL` 和 `AREAFORGE_SMOKE_PASSWORD_FILE`，它会登录后只读获取 update status；若不提供凭据，则 update-agent 证据为 `unknown` 并关联 `AF-RISK-OPS-001`。

如果使用服务器侧导出的 redacted update-agent status JSON 作为 `AREAFORGE_READINESS_UPDATE_STATUS_FILE`，先按 `docs/development/update-agent-status-record-template.md` 校验：

```bash
pnpm update-agent:status:record /path/to/status.json > /path/to/redacted-update-status.json
pnpm update-agent:status:validate /path/to/redacted-update-status.json
```

记录生成器只读取本地 JSON 文件并输出 redacted record；校验器只读取本地 JSON，检查 `currentVersion`、`autoApply=none`、`signatureRequired=true`、timer、`blocker=null`、rollback 摘要、时间戳和 `safetyFacts`，并扫描敏感值；它们都不执行 updater、服务器命令、备份、恢复、migration、回滚或生产写入。

发布或更新完成后，建议把 redacted `pnpm ops:readiness:summary` 输出保存到运维目录，并在版本化 release record 中摘要
`checkedAt`、health、update-agent、smoke、backup、rollback、disk/cert 和 residual risk IDs。公网 TLS 证书自动检查只能证明证书到期状态，不能替代服务器磁盘、备份、update-agent 或 authenticated smoke 证据。没有新鲜 smoke、备份或基础设施证据时，release readiness 只能保持 `warn` 或 `unknown`，不能宣称完整生产健康。

生产只读 smoke 记录使用 `docs/development/production-readonly-smoke-record-template.md`，完成后运行：

```bash
pnpm smoke:prod-readonly:config
pnpm smoke:prod-readonly
pnpm smoke:prod-readonly:record /path/to/prod-readonly-smoke-output.log > /path/to/prod-readonly-smoke-record.txt
pnpm smoke:prod-readonly:validate <prod-readonly-smoke-record.md|txt>
```

配置预检只读取环境变量和密码文件 metadata，不读取密码内容、不连接生产、不执行服务器命令、不写生产；它要求 HTTPS base URL、`AREAFORGE_EXTRA_SMOKE_COMMAND` 指向 `pnpm smoke:prod-readonly`、smoke 账号、权限收紧的 `AREAFORGE_SMOKE_PASSWORD_FILE`、期望版本和自动更新策略。记录生成器只读取 smoke 输出日志、release manifest/digest 环境变量和 redacted 环境摘要，用于减少人工拼接字段；它不读取 smoke 密码文件内容、不执行服务器命令、不写生产。该校验只读取 redacted smoke 记录，检查 `pnpm smoke:prod-readonly` 通过证据、必需只读检查项、版本/tag/digest/hash 形态、密码文件来源、update-status 覆盖、`AF-RISK-OPS-001` 残余 ID 和敏感值泄露；它不连接生产、不读取密码、不执行服务器命令、不写生产。`pnpm smoke:prod-readonly:selftest`、`pnpm smoke:prod-readonly:config:selftest` 和 `pnpm smoke:prod-readonly:record:selftest` 用于本地回归校验规则。

需要把运行信号、残余风险和缺失证据组装成可交接证据包时，使用：

```bash
pnpm ops:evidence:bundle
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
```

该命令复用同一套只读 readiness 采集，输出 `read_only_operational_evidence_bundle`、逐项 signal evidence、`requiredEvidence`、`forbiddenActions`、`safetyFacts` 和 `bundleHash`。证据包 validator 只读取本地 JSON，检查 canonical `bundleHash`、必需信号、禁止动作、只读 safety facts 和敏感值泄露；它不连接生产、不执行服务器命令、不写生产。证据包适合作为 release record、运维交接或事故前证据冻结的索引；它不创建 GitHub Release，不推送 tag，不执行 updater apply，不运行 migration，不备份、不恢复、不回滚、不写生产数据，也不读取或打印密钥文件内容。若 `status` 为 `needs_attention` 或 `blocked`，必须保留对应 residual risk IDs，不能把证据包 hash 当作健康证明。

需要预览当前信号会触发哪些告警动作时，使用：

```bash
pnpm ops:alert:preview
```

该命令复用 readiness 信号，输出 `read_only_alert_preview`、`wouldNotify`、severity、owner、recommendedAction、residual risk IDs 和 `safetyFacts`。它只做本地判断，不调用外部告警接收人，不发送通知，不执行服务器命令，不执行 updater apply，不写生产数据。配置 `AREAFORGE_ALERT_RECEIVER` 只会让输出显示 `<redacted>` receiver hint，不会发送请求。该命令能作为告警演练输入，但不能替代真实外部接收人、metrics dashboard 或人工值班窗口，因此不能单独关闭 `AF-RISK-OPS-004`。

告警演练记录使用 `docs/development/alert-drill-record-template.md`，完成后运行：

```bash
pnpm alert:drill:record /path/to/ops-alert-preview.json > /path/to/alert-drill-record.txt
pnpm alert:drill:validate <alert-drill-record.md|txt>
```

记录生成器需要显式提供操作者、接收人类型、`receiverConfigured=yes`、`receiverAck=yes`、检测/恢复 PASS 和恢复动作说明；它只读取 alert preview 输出，不发送通知、不调用外部接收人、不执行服务器命令、不写生产。该校验只读取演练记录，检查字段、枚举、`AF-RISK-OPS-004` 残余 ID、hash 形态和敏感值泄露；它不发送通知、不连接外部接收人、不执行服务器命令、不写生产。`pnpm alert:drill:selftest` 和 `pnpm alert:drill:record:selftest` 用于本地回归校验规则。

本地真实体验验证可使用 `pnpm smoke:local-ux`。该脚本会写入合成任务、计时、复盘、笔记附件、错题、模拟考试、阶段草稿和更新请求，因此默认要求 `AREAFORGE_SMOKE_ALLOW_WRITES=true`，且只允许 `localhost` / `127.0.0.1`，除非显式设置 `AREAFORGE_SMOKE_ALLOW_NON_LOCAL=true`。它只能证明当前本地验证环境的核心闭环可用，不能关闭生产写入型 smoke 残余项 `AF-RISK-OPS-002`。

产品体验复核记录使用 `docs/development/product-experience-review-record-template.md`，完成后运行：

```bash
pnpm experience:review:validate <product-experience-review-record.md|txt>
```

该校验只读取 redacted 体验记录，检查 desktop/mobile 视口、核心旅程、截图或浏览器观察、5 秒下一步、确认边界、恢复路径、移动端可读性、空/未授权/错误态、安全事实、`AF-RISK-UX-001` 和敏感值泄露；它不打开浏览器、不连接生产、不读取密钥、不写生产。`pnpm experience:review:selftest` 用于本地回归校验规则。没有新鲜体验复核记录时，功能 smoke 只能证明路径可用，不能宣称完整产品体验健康。

生产 smoke 与告警策略见 `docs/development/production-smoke-alerting-strategy.md`。该文档只定义写入型 smoke 的确认字段、合成数据命名空间、清理/失败处理和告警阈值；没有用户确认、专用账号、清理策略和实际记录前，不得执行生产写入型 smoke，也不得关闭 `AF-RISK-OPS-002` 或 `AF-RISK-OPS-004`。

生产 evidence 采集仍需要按 `docs/deployment/github-release-updater.md`、`docs/development/production-release-runbook.md` 和 `ops/github-release-updater/README.md` 执行。任何写入动作都必须先通过高风险确认。

首次自托管或交给新操作者接手时，先走 `docs/deployment/operator-onboarding.md`，并运行：

```bash
pnpm operator:onboarding:preflight
```

该预检只检查上手文档、环境变量示例、部署/更新/备份/smoke/告警入口、README 链接和相关 skill 引用；它不连接生产、不读取密钥、不执行 Docker、不备份、不恢复、不运行 migration、不修改自动更新策略。

日常、每周、每月、Release 和 incident 后的维护节奏见 `docs/development/maintenance-cadence.md`，并可用只读预检确认入口仍完整：

```bash
pnpm maintenance:cadence:preflight
pnpm residuals:review-due
```

维护节奏预检只检查维护节奏文档、residual `reviewAt` metadata、package scripts、入口链接和相关 skill 引用；`pnpm residuals:review-due` 只读取机器台账并列出 overdue / due-soon 项。它们不连接生产、不读取密钥、不执行 Docker、不备份、不恢复、不运行 migration、不创建 Release、不写生产。

需要把维护窗口、事故或恢复演练留成可交接记录时，使用：

```bash
pnpm maintenance:window:validate <maintenance-window-record.md|txt>
pnpm incident:record:validate <incident-record.md|txt>
pnpm restore:drill:validate <restore-drill-record.md|txt>
```

这些校验都只读取 redacted 记录，不连接生产、不读取密钥、不执行服务器命令、不写生产。维护窗口记录不能替代 release record；事故记录不能替代高风险确认；恢复演练记录不能授权生产 restore。

## 残余边界

长期运营未完成项不应散落在自然语言里。影响发布或运维判断的项目必须进入 `docs/development/residual-risk-ledger.md`，使用稳定 ID、类型、影响、关闭条件和所需证据。

当前 release / ops 判断必须显式带入以下残余项：

- `AF-RISK-OPS-001`：生产 extra smoke 证据缺失时，体验验证只能到 `warn`。
- `AF-RISK-OPS-002`：写入型生产 smoke 策略已有非执行草案，但仍缺专用账号、用户确认、清理策略和受控记录。
- `AF-RISK-REL-001`：`AREAFORGE_AUTO_APPLY=none` 是已接受的安全默认，不等于自动应用能力已启用。
- `AF-RISK-SC-001`：SBOM/provenance 生成路径已接入 Release workflow；线上 `v0.1.5` 仍无对应资产，需下一次签名 Release 的校验和发布记录证据关闭。
- `AF-RISK-SC-002`：Actions SHA pinning 和 `pnpm audit:prod` 已在本地 workflow / governance gate 落地，仍需下一次 GitHub CI 或签名 Release 运行证据关闭。
- `AF-RISK-SC-003`：已关闭为证据项；本地 UX smoke 曾复现 `pg` transaction client query queue deprecation，现已通过 `packages/db` transaction query 串行化修复；后续升级 `pg` / `@prisma/adapter-pg` 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke。
- `AF-RISK-OPS-003`：未来服务器、域名、Nginx 或端口迁移需单独 release/ops 记录。
- `AF-RISK-OPS-004`：告警阈值已有非执行策略，`pnpm ops:alert:preview` 可预览 would-alert 决策；metrics dashboard、外部告警接收人和演练记录仍未产品化。
- `AF-RISK-UX-001`：已关闭为证据项；2026-07-10 本地 desktop/mobile 体验复核记录通过，后续 release/update、体验改动或超过 14 天维护窗口前必须重跑 `pnpm experience:review:validate`，否则体验健康重新降级为 `warn`。
