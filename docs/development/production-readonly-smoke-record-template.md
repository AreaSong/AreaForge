# Production Readonly Smoke Record Template

本模板用于记录 AreaForge 生产只读 smoke。它不执行 smoke，不读取 smoke 密码文件，不连接生产，
不执行服务器命令，不写生产数据，也不单独关闭 `AF-RISK-OPS-001`。它只定义一份 redacted 记录应包含的字段。

记录完成后运行：

```bash
pnpm smoke:prod-readonly:validate docs/development/prod-readonly-smoke-vX.Y.Z-or-date.md
```

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
smokeCommand: pnpm smoke:prod-readonly
smokeStatus: pass/fail
smokeResultHash: sha256:<64-hex>
checks: health,login,auth/me,dashboard,notes,syllabus,analytics,reports,long-term-risks,update-status
smokePasswordSource: AREAFORGE_SMOKE_PASSWORD_FILE=<redacted path>
smokePasswordReadFromFile: yes/no
updateStatusIncluded: yes/no
updaterEnvSummary: AREAFORGE_EXTRA_SMOKE_COMMAND configured, password file path redacted
updateRecordSummary: <update-record path/hash summary or none>
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
- `smokeCommand` 必须引用 `pnpm smoke:prod-readonly`。
- `checks` 必须覆盖 health、login、auth/me、dashboard、notes、syllabus、analytics、reports、long-term-risks 和 update-status。
- `smokePasswordReadFromFile` 必须是 `yes`，记录中只能出现 redacted 路径摘要，不得出现密码值。
- `updateStatusIncluded` 必须是 `yes`。
- `webImageDigest`、`migrationImageDigest` 和 `smokeResultHash` 必须是不可变 digest/hash 形态。
- `residualRiskIds` 必须保留 `AF-RISK-OPS-001`，直到服务器 extra smoke 配置、密码文件和最近通过记录都有证据。
- 记录不得包含 session cookie、数据库 URL、API key、生产 `.env`、smoke 密码、完整 prompt/raw response、附件内容、上传绝对路径或真实学习内容。
