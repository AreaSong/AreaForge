recordId: product-experience-review-20260718-5bec626-local
reviewedAt: 2026-07-18T14:45:30+08:00
reviewer: Codex
environment: local
baseUrl: http://127.0.0.1:3102
appVersion: 0.1.7
gitCommit: 5bec62608d929a796b4ca00a91aa95bdf256b27c
sourceFingerprintSchema: ux-source-v2
productExperienceSourceHash: sha256:799d864c054c1ea3a36cfd1662c87beb31640bf13fd6c7d3295a352ef84c165b
runtimeIdentityEvidence: output/playwright/runtime-identity-5bec626.json
runtimeIdentityEvidenceHash: sha256:d1969b1a55b268cc1c751a3970f67aa3defbbd5e1ceb79c458995560f9d8dab7
runtimeIdentityHash: sha256:6b9e07cfaceed784d7db1ee4dcc8b33a1cc46ea50ff09683cba1a9633df63719
source: current-checkout isolated local UX smoke plus current-runtime Playwright desktop/mobile browser review
reviewCommand: pnpm smoke:local-ux and Playwright desktop/mobile browser review with 390px and 1440px overflow checks
reviewStatus: pass
reviewResultHash: sha256:aee84c51b6c9fdfd82a3bf8883b093c76167c065407dfac6adc60e158a4fe316
viewports: desktop,mobile
journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center
screenshotEvidence: desktop=output/playwright/ux-a80b1ac-dashboard-desktop.png,output/playwright/ux-a80b1ac-notes-desktop.png,output/playwright/ux-a80b1ac-syllabus-desktop.png,output/playwright/ux-a80b1ac-reports-desktop.png,output/playwright/ux-a80b1ac-simulation-desktop.png,output/playwright/ux-a80b1ac-update-center-desktop.png,output/playwright/ux-a80b1ac-login-desktop.png,output/playwright/ux-a80b1ac-not-found-desktop.png; mobile=output/playwright/ux-a80b1ac-dashboard-mobile.png,output/playwright/ux-a80b1ac-notes-mobile.png,output/playwright/ux-a80b1ac-syllabus-mobile.png,output/playwright/ux-a80b1ac-reports-mobile.png,output/playwright/ux-a80b1ac-simulation-mobile.png,output/playwright/ux-a80b1ac-update-center-mobile.png,output/playwright/ux-a80b1ac-login-mobile.png,output/playwright/ux-a80b1ac-login-error-mobile.png,output/playwright/ux-a80b1ac-unauthorized-notes-mobile.png,output/playwright/ux-a80b1ac-not-found-mobile.png
screenshotEvidenceHash: sha256:28e08c1acc4195594ca6de373d8b3c00759e4952459d42f3ddd51b8792d891d2
nextActionWithin5s: yes
recommendationsExplainWhy: yes
confirmOnlyBoundariesVisible: yes
recoveryPathVisible: yes
mobileReadable: yes
emptyUnauthorizedErrorStatesChecked: yes
residualRiskIds: AF-RISK-UX-001
followUpTasks: keep AF-RISK-UX-001 open because this current-bound review proves the isolated local runtime only; production experience still requires separate live evidence
safetyFacts:
  productionWriteAttempted: no
  serverCommandAttempted: no
  destructiveActionAttempted: no
  secretValuePrinted: no
  realStudyContentIncluded: no
