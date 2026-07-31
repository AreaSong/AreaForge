# 完成声明证据清单

## 目标

本清单用于防止把“看起来完成”“本地 dry-run 通过”或“有旧记录”误报为真实完成。它适用于功能、治理、Release、运维、体验、安全、供应链和文档收口。

它不是新流程系统，不创建任务队列，不替代 `docs/development/validation-matrix.md`、`docs/development/residual-risk-ledger.md` 或 Release runbook。它只要求每次完成声明带上新鲜证据和未验证边界。

## 校验入口

完成声明记录可保存为 Markdown 或纯文本，然后运行：

```bash
pnpm completion:evidence:validate <completion-evidence-record.md|txt>
```

schema V2 默认重算并绑定当前 `HEAD`、tracked diff、staged/unstaged 状态、untracked 普通文件内容或
symlink target、排序后的 changed paths、验证 commands 和 profile；同一路径在验证后再次变化也会返回
stale。仓库内记录文件自身从 fingerprint 排除，并仅允许其成为所绑定 `HEAD` 的单个 evidence-only
后代 commit；该后代只能新增或修改这一份记录，任何第二个 commit、其他路径、merge、rename 或 delete
都会返回 stale。先填写 `freshValidation.commands` 和 `freshValidation.profile`，再运行：

```bash
pnpm completion:evidence:validate <record> --print-current-fingerprint
```

将输出写入记录后，再运行默认 validator。历史无 `schemaVersion: 2` 的 V1 记录只能显式使用
`pnpm completion:evidence:validate <record> --shape-only`，其 `bindingStatus: unavailable`，不能进入当前
完成声明。

该校验同时检查记录形态、摘要、声明范围、证据位置、证据等级、source baseline、新鲜验证、未验证边界、阻断项、Release 需求、R0-R4 写边界、不能证明项、residual 和 safety facts。仓库相对 `evidenceUri` 必须能解析为当前仓库中的普通文件；纯 40 位 `sourceHashOrCommit` 必须能解析为当前仓库 commit。HTTPS URL 和 `sha256:` 摘要只做格式检查，不联网、不读取远端内容。它不替代真实运行、浏览器、Release、生产 smoke、`pnpm ops:long-term:gate` 或人工复核。

## 完成声明字段

每次声明完成前，至少检查并在汇报中能说清：

```text
schemaVersion: 2
scope:
summary:
evidenceClass: source/runtime/release/production/docs-only/local-smoke/browser-review
claimScope: source-only/local-runtime/release-artifact/production-live/long-term-operability/mixed
evidenceUri:
sourceBaseline:
  sourceDocs:
  sourceHashOrCommit:
freshValidation:
  profile: docs-only/targeted/full/custom
  commands:
  browserOrRuntimeEvidence:
  checkedAt:
validationFingerprint:
  algorithm: sha256
  gitHead:
  worktreeState: clean/dirty
  worktreeHash: sha256:<64 hex>
  changedPaths: <sorted comma-separated repo paths or none>
  digest: sha256:<64 hex>
unverified:
  skippedChecks:
  reason:
blockers:
  product:
  securityPrivacy:
  dependencySupplyChain:
  ciRelease:
  gitCheckpoint:
residualRiskIds:
releaseRequired: yes/no/not-applicable
highestRuntimeWriteBoundary: R0/R1/R2/R3/R4
highRiskConfirmation: yes/no/not-applicable
doesNotProve:
result: PASS/FAIL/BLOCKED/NOT-READY
safetyFacts:
  productionTouched: yes/no
  productionWriteAttempted: yes/no
  serverCommandAttempted: yes/no
  backupRestoreAttempted: yes/no
  migrationAttempted: yes/no
  updaterApplyAttempted: yes/no
  releaseCreated: yes/no
  secretValuePrinted: no
```

## 证据等级

| 等级 | 可证明 | 不能证明 |
|---|---|---|
| `docs-only` | 文档和入口同步 | 运行时行为、生产健康 |
| `local-smoke` | 本地合成闭环可用 | 生产写入、真实用户数据健康 |
| `browser-review` | 当前视口和页面体验 | API 全路径、生产健康 |
| `runtime` | 当前环境实际行为 | Release 资产可信 |
| `release` | tag、资产、签名、digest、记录 | 生产已经更新 |
| `production` | 线上当前健康或更新证据 | 未覆盖路径自动健康 |

## 声明范围

| 范围 | 用途 |
|---|---|
| `source-only` | 只声明文档、脚本或源事实结构完成 |
| `local-runtime` | 声明本地 runtime、fixture、浏览器或 smoke 结果 |
| `release-artifact` | 声明 GitHub Release、签名、digest、SBOM 或 provenance 证据 |
| `production-live` | 声明线上只读健康、updater status、smoke 或生产更新证据 |
| `long-term-operability` | 声明长期运营完成或未完成边界 |
| `mixed` | 多类证据组合，但仍必须逐项写清不能证明什么 |

`evidenceUri` 只能写当前仓库内真实存在的普通文件相对路径、HTTPS URL 或 `sha256:<64 hex>` 摘要，不写服务器绝对路径、`.env`、密钥文件、密码文件、token、私钥或生产原始日志路径。纯 40 位 `sourceHashOrCommit` 会按 Git commit 校验；无法保留在当前 checkout 中的外部摘要应使用带类型说明的摘要文本或 `sha256:`。`doesNotProve` 必须列出当前记录不能证明的边界；例如缺生产证据时写 `production health`，缺 Release 证据时写 `release`，长期运营未闭环时写 `long-term operability` 和 `residual closure`。

## 不可替代规则

- `pnpm check` 不能单独证明 UX、生产、AI 隐私、上传安全或 Release 信任。
- dry-run、fixture、mock、preview、草稿、只读 summary 不能冒充 apply、restore、publish、source write 或真实生产更新。
- Web 版本中心写入 update request 不等于服务器 updater apply 完成。
- AI 草稿不等于自动应用阶段计划或任务重排。
- `report_only` 对账不等于修复、删除、恢复或清理。
- 附件恢复或发布声明若没有同时绑定双向 reconciliation CSV/summary 的路径、status、CSV SHA256 和 summary canonical hash，不能声称附件一致性已证明；并发写入期间的扫描也不能冒充快照一致性。
- 旧截图、旧 smoke 或历史 release 记录不能证明当前体验和当前生产健康。
- 旧完成记录不能自动覆盖 source docs 漂移；长期运营、release、residual 关闭或重大体验声明应记录 source docs、commit 或 hash 摘要。
- V2 fingerprint 只证明记录仍绑定当前 checkout 和声明的验证命令/profile，不证明这些命令真的成功；命令结果仍必须由日志、CI、runtime、Release 或生产证据支持。

## 阻断项

出现以下任一项时，结果应为 `FAIL`、`BLOCKED` 或 `NOT-READY`，不得宣称完成：

- 新增或修改高风险边界但没有用户确认。
- 需要生产证据却只有本地或文档证据。
- 需要 desktop/mobile 体验证据却只有 API smoke。
- Release-bound 改动未说明是否需要新 GitHub Release。
- 残余风险缺少 ID、owner、关闭条件或证据。
- 工作区存在未解释的相关脏改动，或验证失败未归因。
- 完成声明记录无法通过 `pnpm completion:evidence:validate <record>`，或把该校验误当成真实运行/生产证据。

## AreaForge 默认 closeout

常规完成汇报应覆盖：

- 改了什么。
- 为什么这样改。
- 跑了哪些验证，结果如何。
- 没跑哪些检查，原因是什么。
- 是否触碰生产、高风险、密钥、上传、AI、migration、release、backup/restore 或 updater。
- 是否需要新 GitHub Release。
- 仍打开或刚关闭的 residual risk IDs。
