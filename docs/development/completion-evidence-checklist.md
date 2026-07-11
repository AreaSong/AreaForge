# 完成声明证据清单

## 目标

本清单用于防止把“看起来完成”“本地 dry-run 通过”或“有旧记录”误报为真实完成。它适用于功能、治理、Release、运维、体验、安全、供应链和文档收口。

它不是新流程系统，不创建任务队列，不替代 `docs/development/validation-matrix.md`、`docs/development/residual-risk-ledger.md` 或 Release runbook。它只要求每次完成声明带上新鲜证据和未验证边界。

## 校验入口

完成声明记录可保存为 Markdown 或纯文本，然后运行：

```bash
pnpm completion:evidence:validate <completion-evidence-record.md|txt>
```

该校验只检查记录形态、证据等级、source baseline、新鲜验证、未验证边界、阻断项、Release 需求、R0-R4 写边界、residual 和 safety facts。它不替代真实运行、浏览器、Release、生产 smoke、`pnpm ops:long-term:gate` 或人工复核。

## 完成声明字段

每次声明完成前，至少检查并在汇报中能说清：

```text
scope:
evidenceClass: source/runtime/release/production/docs-only/local-smoke/browser-review
sourceBaseline:
  sourceDocs:
  sourceHashOrCommit:
freshValidation:
  commands:
  browserOrRuntimeEvidence:
  checkedAt:
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

## 不可替代规则

- `pnpm check` 不能单独证明 UX、生产、AI 隐私、上传安全或 Release 信任。
- dry-run、fixture、mock、preview、草稿、只读 summary 不能冒充 apply、restore、publish、source write 或真实生产更新。
- Web 版本中心写入 update request 不等于服务器 updater apply 完成。
- AI 草稿不等于自动应用阶段计划或任务重排。
- `report_only` 对账不等于修复、删除、恢复或清理。
- 旧截图、旧 smoke 或历史 release 记录不能证明当前体验和当前生产健康。
- 旧完成记录不能自动覆盖 source docs 漂移；长期运营、release、residual 关闭或重大体验声明应记录 source docs、commit 或 hash 摘要。

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
