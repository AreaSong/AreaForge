# 长期运营 Readiness

## 目标

本文件是 AreaForge 的只读运营证据聚合入口。它不替代生产 runbook，也不授予 Web runtime 服务器命令能力；它只定义长期运营时应收集哪些证据、多久视为新鲜、缺失时如何降级。

当前生产源事实仍以 `docs/development/package-e-remote-github-release-record.md`、`docs/deployment/github-release-updater.md`、服务器 updater 状态和最新 release 记录为准。

## 当前基线

- 线上地址：`https://forge.areasong.top/`
- 当前版本：`0.1.7`
- 当前 Release：`v0.1.7`
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
pnpm ops:status --summary
```

默认命令只读本地 `package.json`、长期运营入口文件和 `docs/development/residual-risk-ledger.json`，输出 `offline_long_term_operability_status_projection` JSON，包含控制面是否完整、当前版本、residual 类型统计、`reviewAt` 到期状态、可立即执行的残余项、release 相关 residual IDs、每日/每周/release/incident 推荐命令、`sourceSnapshot.controlPlaneSourceHash`、`doesNotProve` 和 `safetyFacts`。`--summary` 输出人读摘要，便于维护窗口快速判断当前 blocker、due residual 和下一步证据命令。两种模式都不访问网络、不读取密钥、不执行服务器命令、不备份、不恢复、不运行 migration、不写生产，也不写 `.areaforge/status.json`。输出中的 `overall=needs_live_evidence` 表示离线控制面存在但仍缺真实生产 smoke、release 或告警证据；不能用它宣称生产健康。

维护窗口、release 前检查或新线程接手时，使用只读运营交接摘要：

```bash
pnpm ops:handoff
pnpm ops:handoff --summary
```

默认命令复用 `pnpm ops:status` 的离线投影，输出 `read_only_operational_handoff` JSON，把当前版本、控制面状态、release train 状态、可声称/不可声称内容、due residual、release-relevant residual、下一步命令、`controlPlaneSourceHash`、`doesNotProve` 和 `safetyFacts` 集中到一个交接入口；`--summary` 输出更短的人读摘要。它不访问网络、不读取密钥、不执行服务器命令、不写文件、不备份、不恢复、不运行 migration、不创建 GitHub Release、不执行 updater apply，也不能替代 `pnpm ops:evidence:bundle`、生产只读 smoke、update-agent status、备份或 rollback 证据。`pnpm ops:handoff:selftest` 只在临时 fixture 中校验交接摘要结构。

在声称“产品可长期运营”前，使用严格 live evidence gate：

```bash
pnpm ops:long-term:gate
```

该命令只读本地 redacted 证据和体验记录，复用 OPS-001、OPS-004、SC-002 和 UX validator；它要求 OPS-001 和 OPS-004 都达到 `ready_for_human_close`，签名 Release 供应链达到 `ready_for_sc001_sc002_review`，且产品体验记录在默认 14 天窗口内并通过 `pnpm experience:review:validate`。当前默认绑定 `docs/development/release-supply-chain-v0.1.7.md`、`docs/development/ops-004-alert-preview-v0.1.7-20260712.json` 和 `docs/development/product-experience-review-v0.1.7-20260712-local.md`；不会把 2026-07-11 OPS-004 manual-window 历史证据当成当前默认输入。显式设置 `AREAFORGE_OPS004_ALERT_PREVIEW` / `AREAFORGE_OPS004_ALERT_DRILL_RECORD` 时使用显式路径。缺少任何一类证据时它会退出失败，输出 `read_only_long_term_operability_live_gate` JSON；这只是防止完成声明过度扩张，不执行生产命令、不联网、不创建 Release、不读取密钥、不写 residual 台账。

维护交接或 release/update 后需要把“当前证据和缺口”固定成机器可读记录时，使用只读长期证据快照：

```bash
pnpm ops:long-term:snapshot > /path/to/long-term-evidence-snapshot.json
pnpm ops:long-term:snapshot:validate /path/to/long-term-evidence-snapshot.json
```

该命令输出 `read_only_long_term_evidence_snapshot`，包含 `snapshotHash`、`controlPlaneSourceHash`、证据路径标签、输入 sha256、`controlPlane`、`ops001`、`ops004`、`releaseEvidenceRecord`、`supplyChain`、`uxReview` 和 `operationalEvidenceBundle` 七项 check。`releaseEvidenceRecord` 必须通过 `pnpm release:evidence:validate` 才能为 `pass`；若 backup hash 仍是 root-only 未入仓状态，快照只能保持 `needs_live_evidence`。`operationalEvidenceBundle` check 必须保留 health、release identity、update-agent、authenticated smoke、backup、rollback 和 infrastructure 七个信号；若 bundle 为 `needs_attention`、summary 为 `warn/unknown/fail/blocked` 或 freshness 为 `stale/unknown`，快照只能保持 `needs_live_evidence`。它不联网、不执行生产 smoke、不读取密钥、不执行服务器命令、不创建 Release、不下载 Release assets、不执行 updater、不备份、不恢复、不运行 migration、不写生产，也不修改 residual 台账。快照 validator 通过只证明记录形态、hash 和缺口绑定正确，不替代 `pnpm ops:long-term:gate`、生产只读 smoke、update-agent status、备份 hash 或人工 residual 关闭。

公开支持、自托管排障或维护交接需要一份可贴到 issue/thread 的 metadata-only 预览时，使用：

```bash
pnpm ops:support:bundle-preview > /path/to/support-bundle-preview.json
pnpm ops:support:bundle-preview:validate /path/to/support-bundle-preview.json
```

该命令输出 `metadata_only_support_bundle_preview`，只包含版本、文档入口、命令名、residual ID、关闭条件、claim boundary、forbidden actions 和 `safetyFacts`。它不联网、不读取密钥、不导出支持包、不复制附件或日志、不读取数据库 dump、不创建 Release、不推 tag、不执行 updater、不写生产。它适合公开 support intake 和维护交接；不能替代 `pnpm ops:evidence:bundle`、生产只读 smoke、update-agent status、备份或 rollback 证据。详细边界见 `docs/development/support-bundle-preview.md`。

完成声明证据纪律见 `docs/development/completion-evidence-checklist.md`：ops、release、体验和安全结论必须说明证据等级、新鲜验证、未验证项、阻断项和 residual risk IDs。运行时写动作边界见 `docs/development/runtime-write-boundary.md`：R0 只读、R1 本地写、R2 用户显式 Web 写、R3 update request 和 R4 高风险生产操作不能互相冒充。

本仓库还提供只读运营摘要生成：

```bash
pnpm ops:readiness:summary
```

默认没有配置时，该命令只输出 `unknown` 证据摘要并退出 0。需要采集真实环境证据时，可设置：

```bash
AREAFORGE_READINESS_BASE_URL=https://forge.areasong.top
AREAFORGE_READINESS_EXPECTED_VERSION=0.1.7
AREAFORGE_READINESS_RELEASE_TAG=v0.1.7
AREAFORGE_READINESS_GITHUB_REPO=AreaSong/AreaForge
AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=/path/to/areaforge-release-manifest.json
AREAFORGE_READINESS_RELEASE_MANIFEST_URL=https://github.com/AreaSong/AreaForge/releases/download/v0.1.7/areaforge-release-manifest.json
AREAFORGE_READINESS_WEB_IMAGE_DIGEST=ghcr.io/areasong/areaforge-web:v0.1.7@sha256:...
AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST=ghcr.io/areasong/areaforge-migration:v0.1.7@sha256:...
AREAFORGE_READINESS_EXPECTED_AUTO_APPLY=none
AREAFORGE_READINESS_UPDATE_STATUS_FILE=/path/to/redacted-status.json
AREAFORGE_READINESS_SMOKE_RESULT_FILE=/path/to/smoke-output.txt
AREAFORGE_READINESS_BACKUP_EVIDENCE='db sha256:<64 hex>; uploads sha256:<64 hex>'
AREAFORGE_READINESS_CERT_DAYS=71
AREAFORGE_READINESS_FAIL_ON=fail
pnpm ops:readiness:summary
```

Release identity 采集优先级为：显式 `AREAFORGE_READINESS_WEB_IMAGE_DIGEST` / `AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST`，其次是 `AREAFORGE_READINESS_RELEASE_MANIFEST_FILE`，再次是 `AREAFORGE_READINESS_RELEASE_MANIFEST_URL`，最后可由 `AREAFORGE_READINESS_GITHUB_REPO` + `AREAFORGE_READINESS_RELEASE_TAG` 推导 GitHub Release manifest URL。manifest 只用于只读补齐 release tag、镜像 digest 和资产摘要；它不执行 `SHA256SUMS.sig` / cosign 校验，不替代 updater 签名门禁、SBOM/provenance 证据或下一次 Release 的 `AF-RISK-SC-001` / `AF-RISK-SC-002` 关闭条件。

该摘要脚本只做 HTTP health、HTTPS base URL 的 TLS peer certificate 只读检查、可选登录读取 `/api/system/update-status`、可选本地 JSON 文件读取和环境变量解析；不得执行 Docker、备份、恢复、migration、回滚、shell 或服务器命令。输出中的 `safetyFacts` 会显式记录 `serverCommandAttempted=false`、`backupRestoreAttempted=false`、`migrationAttempted=false`、`productionWriteAttempted=false`、`secretValuePrinted=false`、`smokePasswordReadFromFile` 和 `networkRequested`。输出中的 `freshness` 按默认 14 天窗口标记各信号证据为 `fresh`、`stale` 或 `unknown`；`unknown` 不自动等于失败，但不能支持生产健康完成声明。若提供 `AREAFORGE_READINESS_CERT_DAYS`，则优先使用该手动证据；否则 HTTPS `baseUrl` 会自动采集证书到期时间。若提供 `AREAFORGE_SMOKE_EMAIL` 和 `AREAFORGE_SMOKE_PASSWORD_FILE`，它会登录后只读获取 update status；若不提供凭据，则 update-agent 证据为 `unknown` 并关联 `AF-RISK-OPS-001`。

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

在生成 OPS-001 收口包前，可先用只读预检确认 redacted 证据链缺口：

```bash
AREAFORGE_OPS001_SMOKE_RECORD=/path/to/prod-readonly-smoke-record.txt \
AREAFORGE_OPS001_UPDATE_STATUS_RECORD=/path/to/redacted-update-status.json \
AREAFORGE_OPS001_EVIDENCE_BUNDLE=/path/to/operational-evidence-bundle.json \
AREAFORGE_OPS001_CLOSURE_PACKET=/path/to/ops-001-closure-packet.txt \
pnpm ops:ops-001:preflight
```

`pnpm ops:ops-001:preflight` 输出 `read_only_ops001_evidence_preflight`，包含 `requiredPreflight`、证据文件 validator 结果、`forbiddenActions` 和 `safetyFacts`。它只读取本地 redacted 证据文件路径并调用现有校验器；未提供路径时返回 `needs_evidence` 且退出 0，三份基础证据通过时返回 `ready_to_generate_packet`，收口包也通过时返回 `ready_for_human_close`。它不执行生产 smoke、不联网、不读取密码文件内容、不执行服务器命令、不生成收口包、不修改 residual 台账。

如果生产尝试因前置条件失败而不能形成 smoke record，可保存 OPS-001 blocked record 并运行：

```bash
pnpm ops:ops-001:blocked:validate <ops001-blocked-record.txt>
AREAFORGE_OPS001_BLOCKED_RECORD=<ops001-blocked-record.txt> pnpm ops:ops-001:preflight
```

blocked record 必须写明缺失的 smoke credential、host `pnpm` 运行时或其他 OPS-001 前置条件，包含 redacted update-agent status hash、`doesNotProve`、`forbiddenActions` 和只读 `safetyFacts`。它只证明当前阻塞原因可交接；`blocked_on_prerequisite` 不等于 `ready_for_human_close`，不能关闭 `AF-RISK-OPS-001`，也不能支持长期运营完成声明。2026-07-11 的生产只读尝试记录见 `docs/development/ops-001-production-readonly-attempt-20260711.md`。

生产主机缺 Node.js/pnpm 时，可运行服务器侧只读 fallback helper：

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-ops001-readonly-fallback.sh \
  --config /etc/areaforge/updater.env \
  --state-dir /opt/areaforge/ops-state \
  --output-dir /tmp/areaforge-ops001-fallback-$(date -u +%Y%m%d%H%M%S)
```

该 helper 只写 redacted evidence 目录，输出 `redacted-update-status.json`、`remote-prerequisites.json`、可选 `prod-readonly-smoke-output.log` 和 `remote-summary.txt`。它通过 curl 执行与 `pnpm smoke:prod-readonly` 等价的只读 HTTP 检查，但不生成最终 `prod-readonly-smoke-record.txt`、`operational-evidence-bundle.json` 或 `ops-001-closure-packet.txt`。这些文件仍必须在本地用仓库 `pnpm` 脚本生成和校验；优先运行 `pnpm ops:ops-001:fallback:finalize <redacted-fallback-dir> [output-dir]`，或手动设置 `AREAFORGE_PROD_READONLY_SMOKE_COMMAND=ops/update-agent/areaforge-ops001-readonly-fallback.sh`，并把 `AREAFORGE_UPDATE_RECORD_SUMMARY` 设为 redacted update record 或 redacted update-agent status 的 `sha256:<64 hex>` 摘要，使 `smokeCommand` 和 `updateRecordSummary` 准确标注证据来源；缺少 smoke 配置时 fallback 输出只能作为 blocked record 输入。finalizer 默认只读取本地 redacted 文件，不联网；只有显式 `AREAFORGE_OPS001_FINALIZE_INCLUDE_NETWORK=yes` 时才为 evidence bundle 补充当前 HTTPS health/TLS 只读信号。

通过 SSH/tmux 运行 fallback 时，先让操作者在 TTY 中单独完成 `sudo -v`，再执行 helper。输出目录必须使用 `/tmp/areaforge-ops001-fallback-*`；helper 结束后会把该 redacted 目录安全移交给触发 sudo 的用户，并在 `remote-summary.txt` 写入 `redactedHandoffStatus`。只有该状态为 `granted` 时，才直接 `scp` 该目录回本地；若为 `skipped-*` 或 `failed`，不要串联多个 `sudo tar/chown` 命令，先修正输出目录或重新走交互 TTY。

当生产只读 smoke、redacted update-agent status 和 operational evidence bundle 都已保存并分别通过校验时，可生成 `AF-RISK-OPS-001` 收口证据包：

```bash
AREAFORGE_OPS001_SMOKE_RECORD=/path/to/prod-readonly-smoke-record.txt \
AREAFORGE_OPS001_UPDATE_STATUS_RECORD=/path/to/redacted-update-status.json \
AREAFORGE_OPS001_EVIDENCE_BUNDLE=/path/to/operational-evidence-bundle.json \
pnpm ops:ops-001:preflight
pnpm ops:ops-001:closure /path/to/prod-readonly-smoke-record.txt /path/to/redacted-update-status.json /path/to/operational-evidence-bundle.json > /path/to/ops-001-closure-packet.txt
pnpm ops:ops-001:closure:validate /path/to/ops-001-closure-packet.txt
```

该生成器会先调用 `pnpm smoke:prod-readonly:validate`、`pnpm update-agent:status:validate` 和 `pnpm ops:evidence:bundle:validate`；它只读取本地 redacted 证据，不连接生产、不执行 updater、不修改 residual 台账。收口包通过后表示证据形态可交给维护者复核关闭 `AF-RISK-OPS-001`，不代表备份、告警、供应链或其他 residual 已关闭。若使用 fallback 输出，`remote-prerequisites.blockers` 必须为空、`remote-summary.txt` 的 `smokeStatus` 必须为 `pass` 且 `redactedHandoffStatus` 必须为 `granted`；否则只能形成 blocked record。

需要把运行信号、残余风险和缺失证据组装成可交接证据包时，使用：

```bash
pnpm ops:evidence:bundle
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
```

该命令复用同一套只读 readiness 采集，输出 `read_only_operational_evidence_bundle`、逐项 signal evidence、`requiredEvidence`、`freshness`、`doesNotProve`、`forbiddenActions`、`safetyFacts` 和 `bundleHash`。证据包 validator 只读取本地 JSON，检查 canonical `bundleHash`、必需信号、证据新鲜度字段、不能证明项、禁止动作、只读 safety facts 和敏感值泄露；它不连接生产、不执行服务器命令、不写生产。证据包适合作为 release record、运维交接或事故前证据冻结的索引；它不创建 GitHub Release，不推送 tag，不执行 updater apply，不运行 migration，不备份、不恢复、不回滚、不写生产数据，也不读取或打印密钥文件内容。若 `status` 为 `needs_attention` 或 `blocked`，必须保留对应 residual risk IDs，不能把证据包 hash 当作健康证明。

需要把已保存的 residual review、readiness summary、evidence bundle 和 alert preview 组装成维护窗口交接记录草稿时，使用 `pnpm maintenance:window:record`，再运行 `pnpm maintenance:window:validate <maintenance-window-record.md|txt>`。生成器只读取本地 redacted 输出和显式环境字段；`dueResidualRiskIds` 只从 `AREAFORGE_MAINTENANCE_RESIDUAL_REVIEW_FILE` 或显式 `AREAFORGE_MAINTENANCE_DUE_RESIDUAL_IDS` 推导，不把普通告警 residual 当作到期复核项。它不连接生产、不读取密钥、不执行服务器命令、不写生产，也不能替代 authenticated smoke、update-agent status、备份、rollback 或 OPS-001 收口证据。

需要预览当前信号会触发哪些告警动作时，使用：

```bash
pnpm ops:alert:preview
```

该命令复用 readiness 信号，输出 `read_only_alert_preview`、`wouldNotify`、severity、owner、recommendedAction、residual risk IDs 和 `safetyFacts`。它只做本地判断，不调用外部告警接收人，不发送通知，不执行服务器命令，不执行 updater apply，不写生产数据。配置 `AREAFORGE_ALERT_RECEIVER` 只会让输出显示 `<redacted>` receiver hint，不会发送请求。该命令能作为告警演练输入，但不能替代真实外部接收人、metrics dashboard 或人工值班窗口，因此不能单独关闭 `AF-RISK-OPS-004`。

告警演练记录使用 `docs/development/alert-drill-record-template.md`，完成后运行：

```bash
pnpm alert:drill:record /path/to/ops-alert-preview.json > /path/to/alert-drill-record.txt
pnpm alert:drill:validate <alert-drill-record.md|txt>
AREAFORGE_OPS004_ALERT_PREVIEW=/path/to/ops-alert-preview.json \
AREAFORGE_OPS004_ALERT_DRILL_RECORD=/path/to/alert-drill-record.txt \
pnpm ops:ops-004:preflight
```

记录生成器需要显式提供操作者、接收人类型、`receiverConfigured=yes`、`receiverAck=yes`、检测/恢复 PASS 和恢复动作说明；它只读取 alert preview 输出，不发送通知、不调用外部接收人、不执行服务器命令、不写生产。该校验只读取演练记录，检查字段、枚举、`AF-RISK-OPS-004` 残余 ID、hash 形态和敏感值泄露；它不发送通知、不连接外部接收人、不执行服务器命令、不写生产。OPS-004 预检会额外读取同一次 alert preview 和演练记录，确认 `alertPreviewEvidenceHash` 与 preview 文件内容匹配；缺少演练记录时返回 `ready_to_generate_record`，两者通过时返回 `ready_for_human_close`。`pnpm alert:drill:selftest`、`pnpm alert:drill:record:selftest` 和 `pnpm ops:ops-004:preflight:selftest` 用于本地回归校验规则。

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

- `AF-RISK-OPS-001`：2026-07-11/12 生产只读 smoke、redacted update-agent status、operational evidence bundle 和 closure packet 已达到 `ready_for_human_close`；`v0.1.7` 更新时服务器侧只读 extra smoke 通过，但更新后的 OPS-001 redacted 证据包仍需重新采集，台账关闭仍需维护者人工复核。
- `AF-RISK-OPS-002`：写入型生产 smoke 策略已有非执行草案，但仍缺专用账号、用户确认、清理策略和受控记录。
- `AF-RISK-REL-001`：`AREAFORGE_AUTO_APPLY=none` 是已接受的安全默认，不等于自动应用能力已启用。
- `AF-RISK-SC-001`：`v0.1.7` 已生成并校验 SBOM/provenance、checksum、cosign signature 和发布记录证据，并已由服务器侧 updater 应用到生产；台账关闭仍需维护者人工复核，不由生产 apply 自动关闭。
- `AF-RISK-SC-002`：已关闭为 CI-only 证据项；后续 GitHub Actions、依赖审计策略、Release workflow、供应链记录工具或新 Release 变更前重新复核。
- `AF-RISK-SC-003`：已关闭为证据项；本地 UX smoke 曾复现 `pg` transaction client query queue deprecation，现已通过 `packages/db` transaction query 串行化修复；后续升级 `pg` / `@prisma/adapter-pg` 前重跑 `pnpm pg:trace-deprecation` 和本地 UX smoke。
- `AF-RISK-OPS-003`：未来服务器、域名、Nginx 或端口迁移需单独 release/ops 记录。
- `AF-RISK-OPS-004`：告警阈值已有非执行策略；2026-07-11 manual-window alert preview 和告警/恢复演练记录保留为历史输入；post-`v0.1.7` alert preview 已保存为 `docs/development/ops-004-alert-preview-v0.1.7-20260712.json` 且状态为 `warning`，若要关闭或声明完整生产健康，仍需新的 alert drill/preflight 匹配当前版本证据；metrics dashboard 和外部告警接收人仍未产品化。
- `AF-RISK-UX-001`：已关闭为证据项；2026-07-10 本地 desktop/mobile 体验复核记录是历史证据，2026-07-12 本地 `0.1.7` desktop/mobile 复核记录已补充；后续 release/update、体验改动或超过 14 天维护窗口前必须重跑 `pnpm experience:review:validate`，否则体验健康重新降级为 `warn`。
