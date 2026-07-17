# Product Experience Review Record Template

本模板用于记录 AreaForge 真实产品体验复核。它不运行 smoke，不打开浏览器，不读取密钥，不连接生产，
不执行服务器命令，不写生产数据，也不单独关闭 `AF-RISK-UX-001`。它只定义一份可复核、可脱敏的体验记录应包含的字段。

记录完成后运行：

```bash
pnpm experience:review:binding
pnpm experience:runtime:probe http://127.0.0.1:3102 output/playwright/runtime-identity-current.json
pnpm experience:review:hash <record> --print-record-hashes
pnpm experience:review:validate docs/development/product-experience-review-vX.Y.Z-or-date.md
```

先运行 `pnpm experience:review:binding` 获取当前 `appVersion`、`gitCommit`、`sourceFingerprintSchema` 和
`productExperienceSourceHash`，完成浏览器复核后把这四个值写入记录。
probe 只对 `/api/health` 执行无凭据 GET；生产或其他非本地域名必须显式允许且使用 HTTPS。
长期运营 gate 和 snapshot 优先使用 `AREAFORGE_LONG_TERM_UX_RECORD`；未设置时从
`docs/development/product-experience-review-*.md` 按 `reviewedAt` 选择最新记录，再由默认 validator
判定 current binding、版本和新鲜度。模板文件、符号链接和无法解析 `reviewedAt` 的文件不会被选中。

## 模板

```text
recordId: <product-experience-review-id>
reviewedAt: <ISO-8601 timestamp>
reviewer: <operator>
environment: local/staging/production
baseUrl: http://127.0.0.1:3102
appVersion: <version>
gitCommit: <40-character current checkout commit>
sourceFingerprintSchema: ux-source-v2
productExperienceSourceHash: sha256:<current product experience source fingerprint>
runtimeIdentityEvidence: output/playwright/runtime-identity-current.json
runtimeIdentityEvidenceHash: sha256:<hash of the probe evidence file>
runtimeIdentityHash: sha256:<identityHash from the probed runtime>
source: local UX smoke plus browser screenshots
reviewCommand: pnpm smoke:local-ux and playwright desktop/mobile browser review
reviewStatus: pass/fail
reviewResultHash: sha256:<64-hex>
viewports: desktop,mobile
journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center
screenshotEvidence: desktop=<path-or-record>; mobile=<path-or-record>
screenshotEvidenceHash: sha256:<hash of sorted viewport/path/file-hash entries>
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
- 默认 validator 会把 `appVersion`、`gitCommit`、`sourceFingerprintSchema` 和 `productExperienceSourceHash` 与当前 checkout 重新比较；指纹覆盖 Web、公共资产、核心 workspace、Prisma schema/migrations、依赖锁文件、本地 UX smoke 和 validator/template；任一漂移都不能作为当前 UX 证据。
- 当前记录必须同时绑定 runtime probe evidence；probe 的 base URL、版本、commit、source schema/hash 和
  `identityHash` 必须与记录及当前 checkout 三方一致。生产镜像缺失/损坏 immutable identity 时
  `/api/health` 返回 503，不能形成当前体验证据。
- runtime probe 禁止 redirect、凭据、query、fragment 和路径，响应必须是 16 KiB 内 JSON；输出使用
  no-clobber 原子发布，既有证据文件不会被覆盖。
- `reviewedAt` 必须是有效 ISO-8601 时间，默认不得早于当前时间 14 天，也不得超前超过 300 秒；历史记录只能使用 `--shape-only`。
- 历史旧记录可显式运行 `pnpm experience:review:validate <record> --shape-only`，但只验证结构，不能关闭 `AF-RISK-UX-001`、不能进入长期 live gate，也不能证明当前 UI。
- `reviewCommand` 必须引用 `pnpm smoke:local-ux`、`pnpm smoke:prod-readonly`、Playwright 或明确的 browser review。
- `viewports` 必须覆盖 desktop 和 mobile/narrow。
- `journeys` 必须覆盖 login、dashboard、timer-closeout、review、notes、syllabus、reports、simulation 和 update-center。
- `screenshotEvidence` 必须包含 desktop 和 mobile/narrow 的截图或浏览器观察记录，不得是 `none`、`missing` 或 `not-captured`。
- 当前记录必须用 `screenshotEvidenceHash` 绑定仓库内的 PNG/JPEG/WebP 普通文件；绝对路径、越界路径、
  symlink、空文件和大于 20MB 的文件不能通过。先填截图路径，再运行
  `pnpm experience:review:hash <record> --print-record-hashes` 获取 runtime evidence、runtime identity、
  screenshot 和 review 四个 hash。
- `reviewResultHash` 必须等于 validator 对除自身外全部必填字段的 canonical hash，字段或截图绑定变化后必须重算。
- 六个体验门必须为 `yes`：5 秒内可见下一步、建议解释原因、确认边界可见、恢复路径可见、移动端可读、空/未授权/错误态已检查。
- `residualRiskIds` 必须保留 `AF-RISK-UX-001`，直到最近一次真实体验复核记录通过并被对应发布或维护窗口引用。
- 记录不得包含 session cookie、数据库 URL、API key、生产 `.env`、smoke 密码、完整 prompt/raw response、附件内容、上传绝对路径、真实学习笔记或私密任务标题。
