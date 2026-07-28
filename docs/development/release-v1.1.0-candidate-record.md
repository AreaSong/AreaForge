# v1.1.0 本地完成与 Release Candidate 记录

schemaVersion: 2
scope: v1.1 Batch 11 local product completion and current worktree validation
summary: Current dirty worktree passes the v1.1 local product, isolated migration/runtime, browser, governance and recovery gates; Release admission remains blocked until a target commit is frozen and SC-002/SC-004 are recollected for that exact commit
evidenceClass: local-smoke
claimScope: local-runtime
evidenceUri: workflow/versions/v1.1-learning-action-center.md,output/playwright/v11-final-20260726/canvas-desktop.png,output/playwright/v11-final-20260726/canvas-mobile.png,tasks/active/0035-v11-batch11-minor-release.md
sourceBaseline:
  sourceDocs: workflow/versions/v1.1-learning-action-center.md,docs/development/v11-phase-packages.md,docs/development/validation-matrix.md,docs/development/high-risk-confirmation-packets.md
  sourceHashOrCommit: 552b23547ac4b216d5d77a822cc3f1c623136b plus the documented dirty local candidate
freshValidation:
  profile: full-local-candidate
  commands: pnpm check; pnpm db:validate; pnpm tasks:doctor; pnpm docs:readiness; pnpm docs:completion; pnpm risk:preflight; pnpm governance:preflight; pnpm residuals:validate; pnpm error-recovery:validate; pnpm smoke:local-ux:selftest; pnpm release:train:preflight; pnpm enterprise:operability:preflight; pnpm secrets:scan; git diff --check
  browserOrRuntimeEvidence: isolated PostgreSQL 24-migration runtime matrix; local UX smoke; Playwright desktop/mobile/error-recovery checks; output/playwright/v11-final-20260726
  checkedAt: 2026-07-26T04:35:33+08:00
validationFingerprint:
  algorithm: none-until-target-commit-freeze
  gitHead: 552b23547ac4b216d5d5d77a822cc3f1c623136b
  worktreeState: dirty-local-candidate
  worktreeHash: not-frozen
  changedPaths: v1.1 draft recovery, report history return, local UX smoke contracts, governance preflight and current completion evidence
  digest: not-frozen
unverified:
  skippedChecks: matching CI, exact-commit SC-002, fresh SC-004 readback/controlled PR, signed Release assets, production apply
  reason: no target candidate commit was created or pushed in this validation scope
blockers:
  product: none
  securityPrivacy: none
  dependencySupplyChain: exact target commit not frozen; SC-002 and SC-004 must be recollected
  ciRelease: current dirty worktree has no matching CI or signed Release
  gitCheckpoint: dirty worktree intentionally not committed or pushed
residualRiskIds: AF-RISK-SC-002,AF-RISK-SC-004,AF-RISK-DATA-001
releaseRequired: yes
highestRuntimeWriteBoundary: R1
highRiskConfirmation: yes
doesNotProve: exact-commit Release admission, signed Release, release asset trust, production health, production migration/apply/smoke/rollback, long-term operability, residual closure
result: PASS-LOCAL-NOT-ADMITTED
safetyFacts:
  productionTouched: no
  productionWriteAttempted: no
  serverCommandAttempted: no
  backupRestoreAttempted: no
  migrationAttempted: isolated-local-only
  updaterApplyAttempted: no
  releaseCreated: no
  secretValuePrinted: no

## 结论

- 目标版本：`1.1.0`。
- 分支：`codex/v1.1-learning-action-center`。
- v1.1 本地产品与功能逐项验收：`PASS`。
- 当前工作树完整门禁：`PASS`。
- complete minor Release admission：`NOT READY`。
- 原因：当前候选仍是 dirty worktree，没有冻结目标 commit；旧的 CI、SC-002、SC-004 和 PR 证据不能覆盖当前改动。

本记录只确认 v1.1 在本地隔离环境达到可验证的产品完成态。它不授权 commit、push、tag、GitHub Release、生产 backup/migration/apply/smoke/rollback、updater 或 residual 状态更新。

## 本轮补齐

- 私密业务草稿覆盖笔记、错题、资料创建与详情、Inbox、快速复习、学习树导入、AI、动机、通知和工作区设置；按用户与对象隔离，7 天 TTL，主动退出统一清理。
- 401 保留草稿并安全回登录，网络失败保留输入且不自动重试；409 保留本地值并展示服务端最新 revision。
- AI 已生成未采用结果可跨刷新恢复；成功采用后清除输入、生成结果、operation 和本地草稿，避免重复采用。
- StudyResource 详情以服务端已保存状态为基线，仅在真实变更时持久化草稿；保存成功后不残留已提交草稿。
- 报告历史列表和详情使用统一列表返回上下文，恢复 `tab`、`period`、滚动与焦点。
- Local UX smoke 先建立 ACTIVE 工作区再检查活动会话；两条计时结束路径均使用 `expectedStatus`、`expectedUpdatedAt` 和 `idempotencyKey`。
- `risk:preflight` 只在 Package D D1 完成证据存在时允许精确报告决策路由，并只对白名单中的业务恢复端点排除 Web 运维误报。

## 隔离运行时证据

- 新鲜隔离 PostgreSQL 数据库应用全部 24 个 migration：PASS。
- M1-M3、M4、M5、M6、M8、5,000 对象画布、owner isolation、AI 四用途与防篡改、OPS-006 concurrency、OPS-007 attachment crash/reconciliation：PASS。
- `pnpm smoke:local-ux`：PASS，覆盖登录、ACTIVE 工作区、任务、计时、复盘、笔记附件、错题、模拟、阶段、画布 API、页面路由和版本中心只读边界。
- 所有写验证只使用隔离数据库和临时上传目录；没有访问或修改生产。

## 浏览器证据

- 桌面 `1440x1000`、移动 `390x844` 和窄视口 `720x1000`：页面级横向溢出为 0。
- 动机档案、动机内容库、AI、笔记、错题、资料外链与资料详情：刷新恢复通过；成功保存或采用后的草稿清理通过。
- 主动求助 Drawer：一条内容、三个恢复动作、焦点陷阱、Esc 关闭和返回触发按钮通过。
- 报告历史：确认生成冻结报告、进入详情、返回后恢复 `tab=history&period=week` 与列表焦点通过。
- 画布：桌面画布、移动查阅、等价列表、键盘布局命令入口和无横向溢出通过；截图位于 `output/playwright/v11-final-20260726/`。
- 登录 `returnTo`：外部绝对 URL 回退 `/today`，合法站内路径和查询参数原样恢复。
- 401 mock：本地通知草稿保留且没有写入服务端；409 mock：本地值不被覆盖并展示最新 revision；人工采用最新状态后草稿清除。
- 控制台唯一 error 为验收主动注入的 409 HTTP 响应，没有未解释的运行时错误。

## 最终门禁

以下本地门禁均通过：

- `pnpm check`：Core 80/80、AI 24/24、Storage 25/25、Auth 3/3，workspace typecheck/test、Web lint、Prisma validate 和 Next production build 全部通过。
- `pnpm db:validate`、`pnpm tasks:doctor`、`pnpm docs:readiness`、`pnpm docs:completion`。
- `pnpm risk:preflight`、`pnpm governance:preflight`、`pnpm residuals:validate`、`pnpm error-recovery:validate`。
- `pnpm smoke:local-ux:selftest`、`pnpm release:train:preflight`、`pnpm enterprise:operability:preflight`、`pnpm secrets:scan`。
- `git diff --check`。

## Release 与 residual 边界

- 旧记录中绑定 2026-07-22 commit 的 `READY-FOR-SIGNED-RELEASE` 不适用于当前工作树，现已撤销。
- `AF-RISK-SC-002` 必须在未来目标 commit 冻结后取得 matching successful CI/供应链记录。
- `AF-RISK-SC-004` 必须针对同一目标 commit 取得 fresh main protection readback 与受控 PR 证据。
- `AF-RISK-DATA-001` 保持 `deferred-work`；本轮不关闭、不降级、不改写接受边界。
- 签名 Release、GHCR digest、SBOM/provenance、checksums/cosign、生产 backup/migration/apply/health/smoke/rollback 均未执行。
- `AREAFORGE_AUTO_APPLY=none` 未改变，Web runtime 服务器命令禁区保持不变。
