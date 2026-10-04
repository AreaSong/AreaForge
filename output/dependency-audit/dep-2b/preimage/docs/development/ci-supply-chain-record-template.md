# CI Supply Chain Record Template

## 用途

本模板用于记录 `AF-RISK-SC-002` 的 CI-only 关闭或复核证据：GitHub CI run 成功、`pnpm audit:prod` 通过、`pnpm governance:preflight` 通过、外部 GitHub Actions 仍 pin 到 40 位 commit SHA、`pnpm skills:validate` 和 release supply-chain selftest 通过。

它不创建 GitHub Release，不推 tag，不下载 Release 资产，不执行 Docker、备份、恢复、migration 或生产更新。CI-only 记录只能复核或关闭 `AF-RISK-SC-002`，不能关闭 `AF-RISK-SC-001` 的 SBOM/provenance Release 资产证据。

## 生成和校验

如果已保存 GitHub workflow run JSON，可先生成 redacted 记录草稿：

```bash
AREAFORGE_CI_WORKFLOW_STATUS=pass \
AREAFORGE_AUDIT_PROD_STATUS=pass \
AREAFORGE_GOVERNANCE_PREFLIGHT_STATUS=pass \
AREAFORGE_ACTIONS_PINNING_STATUS=pass \
AREAFORGE_SKILLS_VALIDATE_STATUS=pass \
AREAFORGE_RELEASE_SUPPLY_CHAIN_SELFTEST_STATUS=pass \
AREAFORGE_PINNED_ACTIONS_COUNT=15 \
AREAFORGE_UNPINNED_EXTERNAL_ACTIONS=none \
AREAFORGE_HIGH_CRITICAL_VULNERABILITIES=none \
AREAFORGE_CI_EXPECTED_GIT_COMMIT=<40-hex-being-reviewed> \
pnpm ci:supply-chain:record /path/to/github-workflow-run.json > /path/to/ci-supply-chain-record.txt
AREAFORGE_SC002_CI_RECORD=/path/to/ci-supply-chain-record.txt pnpm sc:sc-002:preflight
pnpm ci:supply-chain:validate /path/to/ci-supply-chain-record.txt
```

生成器只读取本地 JSON 文件和显式状态字段；`AREAFORGE_CI_EXPECTED_GIT_COMMIT` 未设置时默认使用当前 checkout 的 `git rev-parse HEAD`。校验器要求 `expectedGitCommit` 和 GitHub run 的 `gitCommit` 完全一致，缺少 CI run、audit、governance、Actions pinning、skills、commit match 或 vulnerability 证据时会失败。
`pnpm sc:sc-002:preflight` 只读取本地 redacted CI-only 或签名 Release 供应链记录：CI-only 通过时返回 `ready_for_sc002_review`，签名 Release 供应链记录通过时返回 `ready_for_sc001_sc002_review`。它不连接 GitHub、不创建 Release、不推 tag、不下载资产、不修改 residual 台账。

## 模板

```text
recordId: ci-supply-chain-<yyyymmddhhmmss>
recordedAt: <ISO-8601 timestamp>
workflowKind: ci
repository: AreaSong/AreaForge
workflowName: CI
workflowRunUrl: https://github.com/AreaSong/AreaForge/actions/runs/<run-id>
workflowRunConclusion: success
gitCommit: <40-hex>
expectedGitCommit: <40-hex>
commitMatchStatus: pass
headBranch: main
packageVersion: X.Y.Z
ciWorkflowStatus: pass
auditProdStatus: pass
governancePreflightStatus: pass
actionsPinningStatus: pass
skillsValidateStatus: pass
releaseSupplyChainSelftestStatus: pass
pinnedActionsCount: <positive integer>
unpinnedExternalActions: none
highCriticalVulnerabilities: none
residualRiskIds: AF-RISK-SC-002
followUpTasks: tasks/indexes/residuals.md
safetyFacts:
  secretsPrinted: no
  productionEnvIncluded: no
  backupIncluded: no
  productionWriteAttempted: no
  releaseCreated: no
  tagPushed: no
```

## 关闭边界

- `workflowKind` 必须是 `ci`，`workflowRunConclusion` 必须是 `success`。
- `expectedGitCommit` 必须等于 GitHub run 的 `gitCommit`，避免用旧 CI run 证明新的 checkout。
- `auditProdStatus` 必须为 `pass`，且 `highCriticalVulnerabilities` 必须是 `none`。
- `actionsPinningStatus` 必须为 `pass`，`unpinnedExternalActions` 必须是 `none`。
- `residualRiskIds` 必须包含 `AF-RISK-SC-002`，且不能包含 `AF-RISK-SC-001`。
- 若要同时关闭或复核 `AF-RISK-SC-001`，必须使用 `docs/development/release-supply-chain-record-template.md`，同时配置 record/assets 运行 `pnpm sc:sc-002:preflight`，并以 `pnpm release:supply-chain:validate <record> <release-assets-dir> --strict` 记录签名 Release 的 SBOM/provenance、checksum 和 signature 证据。
