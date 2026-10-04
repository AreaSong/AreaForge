recordId: product-experience-review-20260716-local
reviewedAt: 2026-07-16T19:36:30+08:00
reviewer: Codex
environment: local
baseUrl: http://127.0.0.1:3102
appVersion: 0.1.7
gitCommit: 089ccddac4e51da4121d5dc4a4584fde19762c52
sourceFingerprintSchema: ux-source-v2
productExperienceSourceHash: sha256:0df95204394fb11d406b3bc1e00a31b3cfefe80e2c4ec4ecca88e2531145d0f8
runtimeIdentityEvidence: output/playwright/runtime-identity-20260716T113308Z.json
runtimeIdentityEvidenceHash: sha256:3dc59d211c279f48f2fcaccf5ee7511780f62af2efdf5639dd520064285e435e
runtimeIdentityHash: sha256:49a9e40c1dfff76a835212cb655a8b2fabdbc7c268b6ae058efe58088b31ec08
source: current-checkout isolated local authenticated UX smoke plus Playwright desktop/mobile journey, unauthenticated, invalid-credential and not-found review
reviewCommand: pnpm smoke:local-ux and Playwright desktop/mobile browser review and pnpm experience:runtime:probe
reviewStatus: pass
reviewResultHash: sha256:e58e5f1f9895ccfd995eee183538a9298875d5b4b1fd2b09b4992612e25be9bb
viewports: desktop,mobile
journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center
screenshotEvidence: desktop=output/playwright/ux-20260716-dashboard-desktop.png,output/playwright/ux-20260716-update-center-desktop.png,output/playwright/ux-20260716-timer-closeout-desktop.png,output/playwright/ux-20260716-notes-desktop.png,output/playwright/ux-20260716-syllabus-desktop.png,output/playwright/ux-20260716-reports-desktop.png,output/playwright/ux-20260716-simulation-desktop.png,output/playwright/ux-20260716-login-desktop.png,output/playwright/ux-20260716-not-found-desktop.png; mobile=output/playwright/ux-20260716-dashboard-mobile.png,output/playwright/ux-20260716-mobile-nav.png,output/playwright/ux-20260716-update-center-mobile.png,output/playwright/ux-20260716-login-mobile.png,output/playwright/ux-20260716-login-error-mobile.png,output/playwright/ux-20260716-not-found-mobile.png
screenshotEvidenceHash: sha256:bf98dd7646b561e794b3c137d9fbcfa6cbe233e3a039dc04e58281f2335be325
nextActionWithin5s: yes
recommendationsExplainWhy: yes
confirmOnlyBoundariesVisible: yes
recoveryPathVisible: yes
mobileReadable: yes
emptyUnauthorizedErrorStatesChecked: yes
residualRiskIds: AF-RISK-UX-001
followUpTasks: tasks/active/0024-ux-residual-closure-review.md remains keep-open because this evidence is local development only; the 390px dashboard task selector approaches the viewport edge without causing page-level horizontal scrolling and should remain a polish follow-up
safetyFacts:
  productionWriteAttempted: no
  serverCommandAttempted: no
  destructiveActionAttempted: no
  secretValuePrinted: no
  realStudyContentIncluded: no
