# Product Experience Review v1.1 Batch 11 2026-07-22 Local

recordId: product-experience-review-20260722-v11-batch11-local
reviewedAt: 2026-07-21T21:00:44Z
reviewer: Codex local operator
environment: local
baseUrl: http://127.0.0.1:3109
appVersion: 1.1.0
gitCommit: 046cc701b37d73539309d2f110df9a72816d3b83
sourceFingerprintSchema: ux-source-v2
productExperienceSourceHash: sha256:6c4fcd28462ccaf5c8b7fe0791b90ce56fd9b9d23dfb8c0b2f99adec60e4d7f2
runtimeIdentityEvidence: output/playwright/v11-batch11-admission-046cc70/runtime-identity-046cc70.json
runtimeIdentityEvidenceHash: sha256:81d26840e106ad33c72bdf38b3af4e4e5dbefc5bb2364c2bd2ed4cd8aee51a5b
runtimeIdentityHash: sha256:55b53c693c7205e70411b2686263c520dbb273f8a6f3749e97534f08d4db96a5
source: isolated synthetic Batch 11 migration fixture plus local UX smoke and Playwright desktop/mobile browser review
reviewCommand: pnpm smoke:local-ux and Playwright desktop/mobile browser review
reviewStatus: pass
reviewResultHash: sha256:00cd74ade6af17cf4ad67f833ddec9e9e9e07a5aaeed273eb3c04ad7c7d285de
viewports: desktop,mobile
journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center
screenshotEvidence: desktop=output/playwright/v11-batch11-admission-046cc70/desktop-today.png,output/playwright/v11-batch11-admission-046cc70/desktop-ai-settings.png; mobile=output/playwright/v11-batch11-admission-046cc70/mobile-today.png,output/playwright/v11-batch11-admission-046cc70/mobile-ai-settings.png
screenshotEvidenceHash: sha256:d63e181e8956d5789af1afc8432c6a46fa801654e5e416ab8d9619af04179a0b
nextActionWithin5s: yes
recommendationsExplainWhy: yes
confirmOnlyBoundariesVisible: yes
recoveryPathVisible: yes
mobileReadable: yes
emptyUnauthorizedErrorStatesChecked: yes
residualRiskIds: AF-RISK-UX-001
followUpTasks: tasks/active/0035-v11-batch11-minor-release.md
safetyFacts:
  productionWriteAttempted: no
  serverCommandAttempted: no
  destructiveActionAttempted: no
  secretValuePrinted: no
  realStudyContentIncluded: no

## 脱敏观察摘要

- 当前源码提交在一次性 PostgreSQL 数据库完整应用 20 个 migration 后，`pnpm smoke:local-ux` 完成登录、工作区、计时收口、复盘、附件、知识、模拟、阶段、版本中心与 canonical 页面旅程。
- Desktop `1440x1000` 与 mobile `390x844` 均检查今日行动中心和 AI 设置；页面宽度等于 viewport 宽度，无横向溢出，主动作、确认边界与移动底栏可读。
- AI 草稿面板只在用户输入选中文本后开放发送前预览；Provider、payload binding 与本地 fallback 状态清晰，不展示或读取密钥值。
- 未登录访问 `/today` 会回到 `/login`；已登录页面控制台无 error。Next.js 开发工具 overlay 仅在截图前隐藏，未修改业务内容或运行数据。
- 本次只写隔离临时库中的合成数据；未访问生产、未执行生产 migration/apply/updater、未读取真实学习内容或密钥值，也未关闭任何 residual。
