# Update-Agent Status Record Template

本模板用于保存可交接的 redacted update-agent status JSON。它不执行 updater check/apply，不读取服务器密钥，不修改自动更新策略，不创建 GitHub Release，不写生产。

记录完成后运行：

```bash
pnpm update-agent:status:validate /path/to/redacted-update-status.json
```

该 JSON 可作为 `AREAFORGE_READINESS_UPDATE_STATUS_FILE` 输入供 `pnpm ops:readiness:summary` 读取。

## JSON 模板

```json
{
  "currentVersion": "0.1.5",
  "currentImage": "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:<64-hex>",
  "releaseUrl": "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.5",
  "latestVersion": "0.1.5",
  "updateAvailable": false,
  "autoApply": "none",
  "signatureRequired": true,
  "timerEnabled": true,
  "timerActive": true,
  "lastCheckedAt": "<ISO-8601 timestamp>",
  "blocker": null,
  "rollback": {
    "available": true,
    "targetVersion": "0.1.4",
    "targetImage": "ghcr.io/areasong/areaforge-web:v0.1.4@sha256:<64-hex>"
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
