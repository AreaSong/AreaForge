# GitHub Main Protection 本地证据契约

本契约对应 `AF-RISK-SC-004` 的本地证据准备。它只校验已脱敏的 JSON 文件，不连接 GitHub，不调用 `gh`、`curl`，不读取 token，也不改变仓库设置或 residual 台账。

## Validator

```text
pnpm exec tsx scripts/quality/github-main-protection-validate.ts <readback.json> [controlled-pr.json]
```

默认证据新鲜度为 24 小时。可用 `AREAFORGE_SC004_MAX_AGE_SECONDS` 覆盖，范围为 `60..604800`；未来时间和超过上限的时间均失败。通过时输出验证摘要和 canonical evidence hash。

## Readback JSON

文件必须只包含以下字段；`readbackHash` 是将自身替换为空字符串后，对递归按 key 排序的 canonical JSON 做 SHA-256：

```json
{
  "schemaVersion": 1,
  "repository": "AreaSong/AreaForge",
  "branch": "main",
  "sourceKind": "branch_protection",
  "observedAt": "2026-07-15T10:00:00.000Z",
  "maintenanceWindowId": "mw-sc004-20260715",
  "requiredPullRequest": true,
  "requiredApprovingReviewCount": 1,
  "requiredStatusChecks": ["ci / verify"],
  "enforceAdmins": true,
  "allowForcePushes": false,
  "allowDeletions": false,
  "adminBypassActors": [],
  "redaction": { "secretsRemoved": true, "tokenRemoved": true },
  "readbackHash": "sha256:<64 lowercase hex>"
}
```

`sourceKind` 只能是 `branch_protection`、`ruleset` 或 `combined`。required status checks 必须精确为单元素数组 `["ci / verify"]`，`verify` 等单独值不能通过。

## Controlled PR JSON

第二个参数可选；提供时必须与 readback 使用相同的 `maintenanceWindowId`，且只包含以下字段：

```json
{
  "schemaVersion": 1,
  "repository": "AreaSong/AreaForge",
  "branch": "main",
  "observedAt": "2026-07-15T10:30:00.000Z",
  "maintenanceWindowId": "mw-sc004-20260715",
  "prUrl": "https://github.com/AreaSong/AreaForge/pull/123",
  "prNumber": 123,
  "headSha": "<40 lowercase hex>",
  "failedRequiredCheck": "ci / verify",
  "failedCheckConclusion": "failure",
  "failedCheckRunUrl": "https://github.com/AreaSong/AreaForge/actions/runs/100/job/101",
  "passingRequiredCheck": "ci / verify",
  "passingCheckConclusion": "success",
  "passingCheckRunUrl": "https://github.com/AreaSong/AreaForge/actions/runs/102/job/103",
  "failureOutcome": "blocked",
  "successOutcome": "allowed",
  "prMerged": false,
  "secretValuesPresent": false,
  "evidenceHash": "sha256:<64 lowercase hex>"
}
```

`prUrl`、`prNumber` 和 `headSha` 绑定受控 PR；两个 check run URL 必须指向本仓库 Actions run/job。
`failedRequiredCheck` 和 `passingRequiredCheck` 必须精确等于 `ci / verify`，对应 conclusion 必须分别为
`failure` 和 `success`；合并门禁结果必须分别为 `blocked` 和 `allowed`。`prMerged` 和
`secretValuesPresent` 必须为 `false`。

## Preflight

```text
AREAFORGE_SC004_READBACK_RECORD=<readback.json> \
AREAFORGE_SC004_CONTROLLED_PR_RECORD=<controlled-pr.json> \
pnpm exec tsx scripts/ops/sc004-main-protection-preflight.ts
```

输出为 JSON，状态含义如下：

- `needs_remote_readback`：尚未提供本地保存的远端脱敏读回。
- `needs_controlled_pr`：readback 合法，但尚未提供同维护窗口的受控 PR 证据。
- `ready_for_human_review`：两份本地证据均合法且维护窗口一致，仅表示可以人工复核。
- `invalid`：路径、JSON、字段、哈希、秘密扫描、新鲜度或维护窗口一致性失败。

默认缺证据退出码为 `0`，`invalid` 退出码为 `1`。输出固定包含 `doesNotProve`、`forbiddenActions` 和 `safetyFacts`，并明确不会关闭 `AF-RISK-SC-004`。

`safetyFacts` 明确保持 `githubWriteAttempted=false`、`tokenRead=false`、`controlledPrCreated=false`、`residualClosed=false`；`forbiddenActions` 明确禁止 `read_github_token` 和 `create_or_modify_pull_request`。

证据路径必须是 project root 或 `os.tmpdir()` 下的普通 `.json` 文件，不能是文件或父目录 symlink；realpath 也必须留在允许根目录内。路径或 basename 含 `.env`、`secret`、`token`、`password`、`private`、`key`、`dump`、`archive`、`backup`、`upload` 时拒绝，文件大小上限为 2MB。被拒路径不会被读取或打印。

## Safety boundary

本地通过不证明 GitHub 当前设置已生效、不证明 required checks 已在真实 PR 上运行、不证明 PR 已合并，也不证明 residual 已关闭。禁止用本契约执行 GitHub settings 写入、合并 PR、Release/tag、生产命令、migration、备份/恢复、rollback、token 读取或 residual 台账更新。
