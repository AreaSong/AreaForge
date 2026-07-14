# Production Readonly Smoke Record Template

本模板用于记录 AreaForge 生产只读 smoke。它不执行 smoke，不读取 smoke 密码文件，不连接生产，
不执行服务器命令，不写生产数据，也不单独关闭 `AF-RISK-OPS-001`。它只定义一份 redacted 记录应包含的字段。

记录完成后运行：

```bash
pnpm smoke:prod-readonly:validate docs/development/prod-readonly-smoke-vX.Y.Z-or-date.md
```

如果已有 `pnpm smoke:prod-readonly` 的输出日志，可先生成 redacted 记录草稿：

```bash
pnpm smoke:prod-readonly:config
pnpm smoke:prod-readonly:record /path/to/prod-readonly-smoke-output.log > /path/to/prod-readonly-smoke-record.txt
pnpm smoke:prod-readonly:validate /path/to/prod-readonly-smoke-record.txt
```

配置预检只读取环境变量和密码文件 metadata，验证 smoke 配置形态，不读取密码内容、不连接生产、不执行服务器命令、不写生产。记录生成器只读取 smoke 输出、release manifest/digest 环境变量和 redacted 环境摘要；它不读取 smoke 密码文件内容，不执行服务器命令，不备份、不恢复、不运行 migration，也不写生产。

## 模板

```text
recordId: <prod-readonly-smoke-id>
checkedAt: <ISO-8601 timestamp>
environment: production/staging
baseUrl: https://forge.areasong.top
expectedVersion: <version>
releaseTag: vX.Y.Z
webImageDigest: ghcr.io/areasong/areaforge-web:vX.Y.Z@sha256:<64-hex>
migrationImageDigest: ghcr.io/areasong/areaforge-migration:vX.Y.Z@sha256:<64-hex>
smokeCommand: pnpm smoke:prod-readonly 或 ops/update-agent/areaforge-ops001-readonly-fallback.sh
smokeStatus: pass/fail
smokeResultHash: sha256:<64-hex>
checks: health,login,auth/me,dashboard,notes,syllabus,analytics,reports,long-term-risks,update-status
smokePasswordSource: AREAFORGE_SMOKE_PASSWORD_FILE=<redacted path>
smokePasswordReadFromFile: yes/no
updateStatusIncluded: yes/no
updaterEnvSummary: AREAFORGE_EXTRA_SMOKE_COMMAND configured, password file path redacted
updateRecordSummary: <update-record or redacted update-agent status sha256 summary>
residualRiskIds: AF-RISK-OPS-001
followUpTasks: <task/docs/workflow links or none>
safetyFacts:
  serverCommandAttempted: no
  backupRestoreAttempted: no
  migrationAttempted: no
  productionWriteAttempted: no
  secretValuePrinted: no
  passwordValuePrinted: no
  writeSmokeAttempted: no
```

## 关闭条件

- `smokeStatus` 必须是 `pass`。
- 运行记录前应先通过 `pnpm smoke:prod-readonly:config`，确认 extra smoke 命令、HTTPS base URL、smoke 账号、密码文件权限、期望版本和自动更新策略。
- `smokeCommand` 必须引用 `pnpm smoke:prod-readonly`；生产主机缺 Node.js/pnpm 时，可引用 `ops/update-agent/areaforge-ops001-readonly-fallback.sh`，但必须来自已授权的只读 fallback 输出。
- `checks` 必须覆盖 health、login、auth/me、dashboard、notes、syllabus、analytics、reports、long-term-risks 和 update-status。
- `smokePasswordReadFromFile` 必须是 `yes`，记录中只能出现 redacted 路径摘要，不得出现密码值。
- `updateStatusIncluded` 必须是 `yes`。
- `webImageDigest`、`migrationImageDigest` 和 `smokeResultHash` 必须是不可变 digest/hash 形态。
- 若该记录用于 `AF-RISK-OPS-001` 收口包，`updateRecordSummary` 必须包含 `sha256:<64 hex>`；fallback 场景可以使用 redacted update-agent status 或 redacted update record 的 hash 摘要，不得包含原始 secret、cookie 或生产 `.env`。
- `residualRiskIds` 必须保留 `AF-RISK-OPS-001`，直到服务器 extra smoke 配置、密码文件和最近通过记录都有证据。
- 记录不得包含 session cookie、数据库 URL、API key、生产 `.env`、smoke 密码、完整 prompt/raw response、附件内容、上传绝对路径或真实学习内容。
