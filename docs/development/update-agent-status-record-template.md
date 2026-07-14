# Update-Agent Status Record Template

本模板用于保存可交接的 redacted update-agent status JSON。它不执行 updater check/apply，不读取服务器密钥，不修改自动更新策略，不创建 GitHub Release，不写生产。

记录完成后运行：

```bash
pnpm update-agent:status:validate /path/to/redacted-update-status.json
```

该 JSON 可作为 `AREAFORGE_READINESS_UPDATE_STATUS_FILE` 输入供 `pnpm ops:readiness:summary` 读取。

如果已经从服务器侧复制出 `$AREAFORGE_OPS_STATE_DIR/status.json`，或从鉴权只读 `/api/system/update-status` 保存了响应体，可先生成 redacted record：

```bash
pnpm update-agent:status:record /path/to/status.json > /path/to/redacted-update-status.json
pnpm update-agent:status:validate /path/to/redacted-update-status.json
```

生成器只读取本地 JSON 文件，保留 validator 需要的字段并补充 `safetyFacts`，不会连接生产、不会执行 updater check/apply、不会修改自动策略、不会读取或打印服务器密钥。若源 JSON 中 `blocker` 非空、`signatureRequired=false` 或 `autoApply` 不是 `none`，生成出的记录仍会被 validator 拦截，不能作为健康证据。

## JSON 模板

```json
{
  "currentVersion": "<expectedVersion>",
  "currentImage": "ghcr.io/areasong/areaforge-web:vX.Y.Z@sha256:<64-hex>",
  "releaseUrl": "https://github.com/AreaSong/AreaForge/releases/tag/<releaseTag>",
  "latestVersion": "<releaseTag-or-version>",
  "updateAvailable": false,
  "autoApply": "none",
  "signatureRequired": true,
  "timerEnabled": true,
  "timerActive": true,
  "lastCheckedAt": "<ISO-8601 timestamp>",
  "blocker": null,
  "rollback": {
    "available": true,
    "targetVersion": "<rollbackVersion>",
    "targetImage": "ghcr.io/areasong/areaforge-web:vX.Y.Z@sha256:<64-hex>"
  },
  "statusUpdatedAt": "<ISO-8601 timestamp>",
  "safetyFacts": {
    "serverCommandAttempted": false,
    "productionWriteAttempted": false,
    "secretValuePrinted": false,
    "backupRestoreAttempted": false,
    "migrationAttempted": false,
    "updaterApplyAttempted": false
  }
}
```

## 关闭条件

- `signatureRequired` 必须是 `true`。
- `autoApply` 默认必须是 `none`；启用 `patch` 必须先关闭或复核 `AF-RISK-REL-001`。
- `blocker` 必须是 `null` 才能作为健康 update-agent 证据。
- rollback image 如果存在，必须使用 `image@sha256`。
- 记录不得包含 GitHub token、cosign 私钥、生产 `.env`、数据库 URL、session cookie、密码或完整 updater 原始日志。
