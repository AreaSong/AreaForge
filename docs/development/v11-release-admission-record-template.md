# v1.1 Complete Minor Release Admission 记录模板

本模板只用于冻结 `v1.1.0` 签名 Release 前的只读 admission 输入。将完成记录保存到固定路径
`docs/development/v11-release-admission-record.md` 后，运行：

```bash
pnpm release:v11:admission
```

该 v1.1 专用命令未设置 `AREAFORGE_RELEASE_TAG` 时默认固定为 `v1.1.0`；显式传入任何其他非空 tag
都会返回 `invalid`。

命令只读取仓库内证据、重算普通非 symlink 文件的 SHA-256，并调用既有 completion、UX、SC-002、
SC-004 与 source/evidence-only evaluator。它不连接网络、不创建 tag/Release、不构建或推送镜像，也不执行
生产 backup、migration、apply、smoke、rollback 或 residual 更新。

记录中每个 `path` 必须是规范化仓库相对路径；每个 `sha256` 必须按文件当前原始字节计算。script、selftest、
命令名或“验证已存在”不能代替运行后保存的独立证据。缺少记录或证据时输出 `not_ready`；畸形记录、越界路径、
symlink、hash 漂移或无效 evaluator 结果输出 `invalid`。

## 记录

复制以下字段到固定记录文件。记录只能包含这些字段；说明文字使用 `#` 注释。

```text
schemaVersion: 1
releaseTag: v1.1.0
releaseVersion: 1.1.0
sourceGitCommit: <40-character-lowercase-source-commit>
bindingPolicy: source-or-evidence-only
completionEvidence:
  path: docs/development/release-v1.1.0-candidate-record.md
  sha256: sha256:<64-lowercase-hex>
productExperienceEvidence:
  path: docs/development/product-experience-review-v1.1.0-<date>.md
  sha256: sha256:<64-lowercase-hex>
accessibilityEvidence:
  path: docs/development/v11-accessibility-review-<date>.md
  sha256: sha256:<64-lowercase-hex>
compatibilityFloorEvidence:
  path: docs/development/v11-compatibility-floor-evidence-20260727.md
  sha256: sha256:<64-lowercase-hex>
compatibilityRuntimeEvidence:
  path: output/v11-compatibility/compatibility-floor-runtime-v1.1.0-<date>.json
  sha256: sha256:<64-lowercase-hex>
ops006007ReviewEvidence:
  path: docs/development/v11-s2-ops006-007-gate-review.md
  sha256: sha256:<64-lowercase-hex>
sc002Evidence:
  path: output/supply-chain/ci-supply-chain-v1.1.0-<date>.txt
  sha256: sha256:<64-lowercase-hex>
sc004ReadbackEvidence:
  path: output/supply-chain/sc004-main-protection-readback-v1.1.0-<date>.json
  sha256: sha256:<64-lowercase-hex>
sc004ControlledPrEvidence:
  path: output/supply-chain/sc004-controlled-pr-v1.1.0-<date>.json
  sha256: sha256:<64-lowercase-hex>
```

## Completion 记录契约

`completionEvidence.path` 必须是 schema V2 完成记录。admission 以 `--shape-only` 调用通用 validator，避免多份
evidence-only 文件形成 current fingerprint 循环；随后由 admission 自身强制校验：

- `sourceBaseline.sourceHashOrCommit` 等于 `sourceGitCommit`。
- `result: PASS`。
- `unverified.skippedChecks`、`unverified.reason` 均为 `none` 或 `not-applicable`。
- `blockers.product/securityPrivacy/dependencySupplyChain/ciRelease/gitCheckpoint` 均为 `none` 或
  `not-applicable`。

通用 validator 通过但上述任一完成语义不满足时，admission 仍返回 `invalid`。

## 独立无障碍记录契约

`accessibilityEvidence.path` 指向的记录至少包含以下顶层字段。它必须来自独立的 production-mode local 或
staging 浏览器复核，不能用总 UX 记录或 selftest 代替。

```text
schemaVersion: 1
recordId: <record-id>
reviewedAt: <ISO-8601>
appVersion: 1.1.0
gitCommit: <same-as-sourceGitCommit>
status: pass
environment: production-mode-local
keyboardNavigation: pass
focusRecovery: pass
screenReaderSemantics: pass
ariaLive: pass
nonColorStatus: pass
zoom200Percent: pass
canvasEquivalentList: pass
doesNotProve: signed Release, production apply, residual closure
```

## Compatibility Floor 契约

24-migration Markdown 记录必须为本次候选新鲜重采，并严格使用以下字段：

```text
schemaVersion: 1
status: pass
candidateImplementationCommit: <same-as-sourceGitCommit>
compatibilityRuntimeEvidence:
  path: output/v11-compatibility/compatibility-floor-runtime-v1.1.0-<date>.json
  sha256: sha256:<same-as-admission-compatibilityRuntimeEvidence-sha256>
candidateWorktreeFingerprint: sha256:<same-as-runtime-candidateFingerprint-digest>
legacyMigrationCount: 12
legacyMigrationManifestSha256: sha256:90b88fe3555ff44696cc0968b42b5b7f7828daa1bb2b58115caf003cd7511368
floorMigrationCount: 15
floorMigrationManifestSha256: sha256:e86f1d7e8f850b76f7b5470c11ccf08cab409ed092ea809d198b74fc8610e57d
repositoryMigrationCount: 24
repositoryMigrationManifestSha256: sha256:f5d083da94fc883b5a2428cdb5d565b7a3df20745f3b197d7d777625fd966419
migrationReplayStatus: pass
candidateSeedStatus: pass
floorProductionBuildStatus: pass
floorReadProbeStatus: pass
repeatDeployStatus: pass
cleanupStatus: pass
doesNotProve: signed Release, production apply, residual closure
```

runtime JSON 必须是 `AREAFORGE_V11_COMPATIBILITY_RESULT_FILE` 保存的
`v11-compatibility-floor-runtime-v2` state，并满足：

- `candidateCommit=sourceGitCommit`、`legacyCommit=749692ba719d801f14186a94af97b96350380141`、
  `floorCommit=c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4`。
- PostgreSQL server version 为 16.x，`floorPackageVersion=0.1.9`。
- `manifests.legacy/floor/current` 分别严格绑定上述 `12/15/24` count 和 digest。
- `fingerprintExcludedPaths` 只能包含 compatibility Markdown 路径；candidate/floor fingerprint 必须为
  clean、无 changed paths、内部 digest 一致，并分别绑定 source/floor commit。
- `seedChecks`、`probeChecks` 的 legacy/custom/workspace/唯一性断言全部为预期通过值；
  `finalValidation.status=pass`、`migrationCount=24`、`candidateFingerprintStable=true`、
  `repeatDeployLedgerStable=true`。

历史 20-migration 记录、手写摘要或只记录 Markdown 而不保存 runtime JSON 均不能进入 admission。

## OPS-006/007 复核契约

`docs/development/v11-s2-ops006-007-gate-review.md` 必须改为以下严格结构化记录；表格、否定句或仅提及
四级 gate 词汇不会通过：

```text
schemaVersion: 1
status: pass
sourceGitCommit: <same-as-sourceGitCommit>
reviewOutcome: ops006_ops007_four_gate_pass
ops006RuntimeEvidence:
  path: docs/development/ops-006-production-evidence-v0.1.9-20260721/ops-006-production-evidence-v0.1.9-20260721.txt
  sha256: sha256:<64-lowercase-hex>
ops007RuntimeEvidence:
  path: docs/development/ops-007-production-protocol-v0.1.9-20260721.txt
  sha256: sha256:<64-lowercase-hex>
doesNotProve: new production apply, production migration, residual closure, v1.1 runtime behavior
```

两份 runtime 证据必须是上述 canonical 路径中的普通非 symlink 文件，hash 会在 admission 开始和最终收口
阶段分别重算。

## 固定结果

- `ready_for_signed_release`，exit `0`：全部证据存在、hash 当前、evaluator 通过且提交绑定有效；只允许继续请求签名 Release 的独立确认。
- `not_ready`，exit `1`：聚合记录或证据缺失、UX 过期，或 SC evaluator 明确仍需证据。
- `invalid`，exit `2`：记录/路径/hash/提交绑定无效，或任一 validator 明确拒绝。

任何结果都不授权 GitHub Release、生产 apply 或 residual closure。
