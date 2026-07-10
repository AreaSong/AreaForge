# Release Train

## 定位

Release train 是 AreaForge 后续功能进入线上时的固定路径。它把功能完成、版本号、GitHub Release、GHCR digest、签名资产、服务器 updater、smoke、回滚目标、发布记录和残余风险连成一条证据链。

它不是发布授权，不创建 tag，不推送代码，不创建 GitHub Release，不执行 Docker、备份、恢复、migration、updater apply 或生产更新。真实发布、更新、回滚、备份恢复和自动应用策略变化仍需按高风险确认流程执行。

## 什么时候必须进入 Release Train

以下变更准备进入线上时，必须走 GitHub Release 路径：

- 用户可见功能、页面、API 或产品行为变化。
- Prisma schema、migration、数据库读写路径或结构化状态变化。
- 上传、附件、下载、存储目录或对账策略变化。
- AI provider、prompt 上下文、fallback、限流、日志或费用边界变化。
- Docker、Nginx、compose、update-agent、updater、备份、恢复、回滚或版本中心变化。
- 认证、session、密钥、GitHub Release 签名、GHCR、供应链或依赖安全姿态变化。

纯文档、只读模板或本地预检脚本可以不创建线上 Release，但如果它改变发布、更新、生产运维或用户交付事实，仍要同步 README、docs、workflow、tasks、skill 和残余风险入口。

## 固定节奏

1. 定义范围：feature/docs/ops/security/AI/upload/migration/release。
2. 同步源事实：`docs/**`、`tasks/**`、`workflow/**`、README、相关 skill。
3. 选择验证：以 `docs/development/validation-matrix.md` 为准，至少运行 release train 预检。
4. 保持工作区干净：一个 release candidate 只包含一个 coherent 变更。
5. bump 版本：根 `package.json` 和 AreaForge workspace package version 必须与 tag `vX.Y.Z` 一致。
6. 提交 checkpoint：提交信息说明用户可见或治理可见效果。
7. 创建并推送 tag：`vX.Y.Z`。
8. 等待 GitHub Release workflow：validate job 必须先通过，stable signing 缺 key 必须 fail closed。
9. 验证 Release assets：manifest、SBOM、provenance、`SHA256SUMS`、`SHA256SUMS.sig`、`docker-compose.prod.yml`。
10. 记录供应链证据：需要关闭或复核 `AF-RISK-SC-001` / `AF-RISK-SC-002` 时，填写供应链记录并运行校验。
11. 触发受控更新：通过 Web 版本中心提交请求，或由管理员执行服务器侧 updater。
12. 记录生产证据：health、update-agent、smoke、backup、migration、rollback target、`ops:evidence:bundle` hash、告警预览和 residual risk IDs。

## 发布前本地门禁

默认命令：

```bash
pnpm enterprise:operability:preflight
pnpm release:train:preflight
pnpm docs:readiness
pnpm docs:completion
pnpm risk:preflight
pnpm governance:preflight
pnpm github-release-updater:preflight
pnpm shellcheck:updater
pnpm ops:readiness
pnpm ops:status
pnpm skills:validate
pnpm audit:prod
pnpm check
git diff --check
```

涉及供应链证据模板时补跑：

```bash
pnpm release:supply-chain:selftest
pnpm release:supply-chain:record:selftest
pnpm release:supply-chain:validate <release-supply-chain-record.md|txt>
```

涉及发布记录时补跑：

```bash
pnpm release:evidence:validate <release-record.md|txt> [attachment-reconciliation.csv]
```

## GitHub Release 资产

stable Release 必须至少包含：

- `areaforge-release-manifest.json`
- `areaforge-sbom.spdx.json`
- `areaforge-provenance.json`
- `SHA256SUMS`
- `SHA256SUMS.sig`
- `docker-compose.prod.yml`
- Web image：`ghcr.io/areasong/areaforge-web:vX.Y.Z@sha256:<digest>`
- Migration image：`ghcr.io/areasong/areaforge-migration:vX.Y.Z@sha256:<digest>`

生产证据只能引用不可变 digest，不能使用 `latest` 或只有 tag 的镜像身份。公开仓库或公开 package 只是方便分发，不替代 hash、signature、digest、backup、smoke 和 rollback evidence。

## 发布记录

每个进入线上且需要仓库可追溯证据的版本，复制 `docs/development/release-record-template.md` 为版本化记录，例如：

```text
docs/development/release-vX.Y.Z-record.md
```

记录至少摘要：

- release tag、GitHub Release URL、commit。
- Web/migration image digest。
- `SHA256SUMS` 和 `SHA256SUMS.sig` 校验结果。
- 备份路径/hash、migration runner、public health、authenticated smoke 或缺失原因。
- update-agent 状态、rollback target、`AREAFORGE_AUTO_APPLY`。
- update-agent redacted status JSON 如进入交接证据，按 `docs/development/update-agent-status-record-template.md` 记录并运行 `pnpm update-agent:status:validate <record.json>`。
- `pnpm ops:evidence:bundle` 的 `bundleHash`。
- `pnpm ops:alert:preview` 的状态、wouldNotify、owner 和 recommendedAction 摘要。
- 未关闭 residual risk IDs。

仓库记录不得包含生产 `.env`、数据库 URL、API key、GitHub token、cosign 私钥、smoke 密码、完整 prompt/raw response、附件内容、完整复盘正文或真实学习明细。

## 供应链记录

下一次签名 Release 若用于关闭或复核 `AF-RISK-SC-001` / `AF-RISK-SC-002`，复制 `docs/development/release-supply-chain-record-template.md` 为：

```text
docs/development/release-supply-chain-vX.Y.Z.md
```

并记录：

- GitHub Actions run URL 和 conclusion。
- validate job、`pnpm audit:prod`、`pnpm governance:preflight`、Actions SHA pinning 和 Release workflow 状态。
- manifest、SBOM、provenance、compose、`SHA256SUMS`、signature asset。
- checksum/signature verification。
- stable signing required、unsigned placeholder absent。
- Web/migration `image@sha256`。
- safety facts：不含 secrets、生产 env、备份本体、AI raw 内容、附件内容或生产写入。

校验：

```bash
pnpm release:supply-chain:validate docs/development/release-supply-chain-vX.Y.Z.md
```

如果 Release 资产已下载到本地目录，可先用 `pnpm release:supply-chain:record <release-assets-dir>` 生成记录草稿；生成器仍要求显式填写 GitHub workflow run URL、validate job、`pnpm audit:prod`、governance、Actions pinning、checksum 和签名校验结果，不会连接 GitHub 或创建 Release。

## 更新与回滚

Release 完成不等于生产已更新。生产更新完成必须有服务器侧 updater 或管理员执行证据。

更新后至少记录：

- updater `check/apply` 或 update-agent 请求处理结果。
- backup 结果和 hash。
- migration result，或 `not-applicable`。
- public health。
- authenticated read-only smoke，或 `AF-RISK-OPS-001`。
- rollback target。
- `AREAFORGE_AUTO_APPLY=none` 或已确认的新策略。

数据库/上传目录恢复默认不自动执行。任何恢复、备份删除、上传目录移动或写入型 smoke 都必须单独确认。

## 自动更新策略

默认：

```bash
AREAFORGE_AUTO_APPLY=none
```

`patch` 自动应用只有在以下证据齐备并得到用户确认后才可启用：

- stable Release 签名和 hash 校验。
- manifest `autoApply.patch=true`。
- immutable image digest。
- 当前备份和 rollback target。
- extra smoke hook 或最近一次通过记录。
- 残余风险 `AF-RISK-REL-001` 的关闭证据。

minor/major 自动应用不进入当前默认策略。

## 停止条件

命中以下任一项，release train 必须停止或转为 incident/release follow-up：

- local validation、CI validate job、stable signing、hash/signature 校验失败。
- release tag 与 package version 不一致。
- Release asset 缺 manifest、SBOM、provenance、compose、`SHA256SUMS` 或 `SHA256SUMS.sig`。
- Web/migration image 缺不可变 digest。
- 生产备份、rollback target、migration runner 或 health 证据缺失。
- smoke 失败且没有明确 rollback/roll-forward 决策。
- 日志或记录泄露密钥、数据库 URL、完整 prompt/raw response、附件内容、上传绝对路径或真实学习明细。
- residual ledger 中存在当前发布阻塞项。

## 当前残余项的处理

- `AF-RISK-OPS-001`：没有新鲜生产只读 smoke 时，release 体验验证只能到 `warn`。
- `AF-RISK-OPS-002`：写入型生产 smoke 不属于默认 release train，需单独确认。
- `AF-RISK-REL-001`：`AREAFORGE_AUTO_APPLY=none` 是当前安全默认，不是能力缺失。
- `AF-RISK-SC-001`：下一次签名 Release 需以 SBOM/provenance 资产和校验记录关闭或复核。
- `AF-RISK-SC-002`：下一次 GitHub CI/Release 运行需以 Actions pinning 和 `pnpm audit:prod` 证据关闭或复核。
- `AF-RISK-OPS-004`：告警预览不等于真实外部告警，演练记录另行校验。

## 本地预检

修改 release train、Release workflow、updater、签名、供应链或发布记录口径后，运行：

```bash
pnpm release:train:preflight
pnpm enterprise:operability:preflight
```

该预检只检查文档、脚本、入口、workflow 和 skill 引用，不连接 GitHub，不下载 Release，不执行 Docker，不推 tag，不创建 GitHub Release，不读密钥，不写生产。
