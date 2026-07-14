# Product Experience Review Record Template

本模板用于记录 AreaForge 真实产品体验复核。它不运行 smoke，不打开浏览器，不读取密钥，不连接生产，
不执行服务器命令，不写生产数据，也不单独关闭 `AF-RISK-UX-001`。它只定义一份可复核、可脱敏的体验记录应包含的字段。

记录完成后运行：

```bash
pnpm experience:review:validate docs/development/product-experience-review-vX.Y.Z-or-date.md
```

## 模板

```text
recordId: <product-experience-review-id>
reviewedAt: <ISO-8601 timestamp>
reviewer: <operator>
environment: local/staging/production
baseUrl: http://127.0.0.1:3102
appVersion: <version>
source: local UX smoke plus browser screenshots
reviewCommand: pnpm smoke:local-ux and playwright desktop/mobile browser review
reviewStatus: pass/fail
reviewResultHash: sha256:<64-hex>
viewports: desktop,mobile
journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center
screenshotEvidence: desktop=<path-or-record>; mobile=<path-or-record>
nextActionWithin5s: yes/no
recommendationsExplainWhy: yes/no
confirmOnlyBoundariesVisible: yes/no
recoveryPathVisible: yes/no
mobileReadable: yes/no
emptyUnauthorizedErrorStatesChecked: yes/no
residualRiskIds: AF-RISK-UX-001
followUpTasks: <task/docs/workflow links or none>
safetyFacts:
  productionWriteAttempted: no
  serverCommandAttempted: no
  destructiveActionAttempted: no
  secretValuePrinted: no
  realStudyContentIncluded: no
```

## 关闭条件

- `reviewStatus` 必须是 `pass`。
- `reviewCommand` 必须引用 `pnpm smoke:local-ux`、`pnpm smoke:prod-readonly`、Playwright 或明确的 browser review。
- `viewports` 必须覆盖 desktop 和 mobile/narrow。
- `journeys` 必须覆盖 login、dashboard、timer-closeout、review、notes、syllabus、reports、simulation 和 update-center。
- `screenshotEvidence` 必须包含 desktop 和 mobile/narrow 的截图或浏览器观察记录，不得是 `none`、`missing` 或 `not-captured`。
- 六个体验门必须为 `yes`：5 秒内可见下一步、建议解释原因、确认边界可见、恢复路径可见、移动端可读、空/未授权/错误态已检查。
- `residualRiskIds` 必须保留 `AF-RISK-UX-001`，直到最近一次真实体验复核记录通过并被对应发布或维护窗口引用。
- 记录不得包含 session cookie、数据库 URL、API key、生产 `.env`、smoke 密码、完整 prompt/raw response、附件内容、上传绝对路径、真实学习笔记或私密任务标题。
