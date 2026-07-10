# Release Supply Chain Record Template

本模板用于记录 AreaForge 下一次 GitHub Release / CI 运行后的供应链证据。它不创建 Release，
不连接 GitHub，不下载资产，不执行 Docker、备份、恢复、migration 或生产更新。它只定义一份
可提交到仓库或运维交接摘要的 redacted 证据记录。

记录完成后运行：

```bash
pnpm release:supply-chain:validate docs/development/release-supply-chain-vX.Y.Z.md
```

如果已下载 GitHub Release 资产目录，可先生成 redacted 记录草稿：

```bash
AREAFORGE_RELEASE_WORKFLOW_RUN_URL=https://github.com/AreaSong/AreaForge/actions/runs/<run-id> \
AREAFORGE_RELEASE_WORKFLOW_RUN_CONCLUSION=success \
AREAFORGE_VALIDATE_JOB_STATUS=pass \
AREAFORGE_AUDIT_PROD_STATUS=pass \
AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS=pass \
AREAFORGE_ACTIONS_PINNING_STATUS=pass \
AREAFORGE_RELEASE_WORKFLOW_STATUS=pass \
AREAFORGE_CHECKSUM_VERIFICATION=pass \
AREAFORGE_SIGNATURE_VERIFICATION=pass \
AREAFORGE_UNSIGNED_PLACEHOLDER_PRESENT=no \
pnpm release:supply-chain:record /path/to/release-assets > /path/to/release-supply-chain-record.txt
pnpm release:supply-chain:validate /path/to/release-supply-chain-record.txt
```

记录生成器只读取本地 Release 资产目录和上述显式 CI/Release 状态字段；它不连接 GitHub、不创建 Release、不下载资产、不执行 Docker、不备份、不恢复、不运行 migration、不更新生产。缺少 CI run URL、`pnpm audit:prod`、Actions pinning、checksum 或签名校验等字段时，生成器会失败，而不是生成可误用的关闭记录。

## 模板

```text
recordId: <release-supply-chain-id>
recordedAt: <ISO-8601 timestamp>
releaseTag: vX.Y.Z
releaseUrl: https://github.com/AreaSong/AreaForge/releases/tag/vX.Y.Z
workflowRunUrl: https://github.com/AreaSong/AreaForge/actions/runs/<run-id>
workflowRunConclusion: success/failure/cancelled
gitCommit: <40-hex>
channel: stable/preview
packageVersion: X.Y.Z
validateJobStatus: pass/fail
auditProdStatus: pass/fail
governancePreflightStatus: pass/fail
actionsPinningStatus: pass/fail
releaseWorkflowStatus: pass/fail
webImageDigest: ghcr.io/areasong/areaforge-web:vX.Y.Z@sha256:<64-hex>
migrationImageDigest: ghcr.io/areasong/areaforge-migration:vX.Y.Z@sha256:<64-hex>
manifestAsset: areaforge-release-manifest.json
sbomAsset: areaforge-sbom.spdx.json
provenanceAsset: areaforge-provenance.json
sha256SumsAsset: SHA256SUMS
signatureAsset: SHA256SUMS.sig
sha256SumsCovers: areaforge-release-manifest.json,areaforge-sbom.spdx.json,areaforge-provenance.json,docker-compose.prod.yml
checksumVerification: pass/fail
signatureVerification: pass/fail
manifestSha256: <64-hex>
sbomSha256: <64-hex>
provenanceSha256: <64-hex>
composeSha256: <64-hex>
stableSigningRequired: yes/no
unsignedPlaceholderPresent: yes/no
residualRiskIds: AF-RISK-SC-001,AF-RISK-SC-002
followUpTasks: <task/docs/workflow links or none>
safetyFacts:
  secretsPrinted: no
  productionEnvIncluded: no
  backupIncluded: no
  promptOrRawAiResponseIncluded: no
  attachmentContentIncluded: no
  productionWriteAttempted: no
```

## 关闭条件

- `channel` 必须是 `stable`，且 `workflowRunConclusion` 必须是 `success`。
- validate job、`pnpm audit:prod`、`pnpm governance:preflight`、Actions SHA pinning 和 Release workflow 均必须为 `pass`。
- Release assets 必须包含 manifest、SBOM、provenance、`SHA256SUMS`、`SHA256SUMS.sig` 和 `docker-compose.prod.yml`。
- `SHA256SUMS` 必须覆盖 manifest、SBOM、provenance 和 compose。
- checksum 和签名校验必须为 `pass`，且 stable release 不允许 unsigned placeholder。
- Web 和 migration image 必须使用不可变 `image@sha256` digest。
- 记录必须包含 `AF-RISK-SC-001` 和 `AF-RISK-SC-002`，直到对应台账在证据复核后关闭。
- 记录不得包含生产 `.env`、数据库 URL、API key、cosign 私钥、GitHub token、smoke 密码、完整 prompt/raw response、附件内容或真实学习内容。
