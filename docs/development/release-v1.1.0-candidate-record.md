# v1.1.0 本地完成与 Release Candidate 记录

## 身份与结论

- 目标版本：`1.1.0`。
- 分支：`codex/v1.1-learning-action-center`。
- 证据等级：本地 runtime、隔离 PostgreSQL migration、构建、治理门禁与 current-bound desktop/mobile UX。
- 本地产品候选：`PASS`。
- complete minor Release admission：`NOT-READY`。
- UX/runtime 源提交 `U`：`046cc701b37d73539309d2f110df9a72816d3b83`。
- SC-002/SC-004 目标提交 `C`：本记录与 UX 证据形成的最终 evidence-only 候选 commit；提交后以 `git rev-parse HEAD` 冻结，SC 重采必须 exact-match `C`，不能只匹配 `U`。

`NOT-READY` 仅表示仍缺最终候选 `C` 的 SC-002/SC-004 重采与维护者签名 Release 确认句；current-bound UX 已通过，不否定 Batch 3–10 已通过的本地实现和隔离验证。

## 候选范围

- Batch 3–10 的学习行动中心实现：当前考试工作区、计划收件箱、学习树 preview/confirm、StudyResource、统一复习与 CheckIn v2、App Shell 与今日行动中心、知识工作台与关联画布、动机/通知/四类 AI 草稿、模拟失分/报告/阶段确认闭环。
- 八个有序 additive product migrations；不包含 production migration deploy、历史修复、destructive DDL 或文件移动。
- 根包、Web 与全部 AreaForge workspace package version 统一为 `1.1.0`。
- 修正 `risk:preflight` 对 canonical 页面与 StudyResource 软恢复路由的静态识别；Web runtime 的 Docker、backup、restore、migration、shell 与服务器命令禁区不变。

## 新鲜本地验证

以下验证在 2026-07-22、候选源码工作树上执行：

- `pnpm install --frozen-lockfile`：PASS。
- `pnpm db:generate`、`pnpm db:validate`：PASS。
- `pnpm --filter @areaforge/core test`：PASS，75 tests。
- `pnpm --filter @areaforge/core typecheck`、`pnpm --filter @areaforge/web typecheck`、`pnpm --filter @areaforge/web lint`：PASS。
- 五个一次性本地 PostgreSQL 数据库分别完成全部 20 个 migration；M1–3、M4、M5、M6、M8 runtime selftest：PASS；M8 重复 deploy 返回 `No pending migrations to apply`。
- `pnpm check`：PASS，覆盖 workspace typecheck/test、Web lint、Prisma validate 与 Next.js production build。
- `pnpm docs:readiness`、`pnpm docs:completion`、`pnpm docs:links`、`pnpm docs:evergreen`、`pnpm tasks:doctor`、`pnpm residuals:validate`：PASS。
- `pnpm risk:preflight`、`pnpm governance:preflight`、`pnpm secrets:scan`、`pnpm enterprise:operability:preflight`、`pnpm skills:validate`：PASS。
- `pnpm release:train:preflight`、`pnpm release:workflow:policy`、`pnpm release:admission:selftest`、`pnpm release:identity:probe:selftest`、`pnpm github-release-updater:preflight`、`pnpm shellcheck:updater`：PASS。
- Release/CI supply-chain record selftests、SC-002 preflight selftest、SC-004 validator/preflight selftests：PASS。
- `pnpm audit:prod --audit-level high`：PASS；报告 2 个 moderate，未报告 high/critical。
- 候选记录后的 StudyResource/学习树租户隔离加固在新一次性 `v11m5` 数据库重跑全部 20 个 migration 与 M5 runtime selftest：PASS，包含 owner 外拒绝、confirm 原子回滚、幂等冲突与无服务端临时文件。
- `pnpm smoke:local-ux`：PASS；覆盖 ACTIVE workspace fixture、计时收口、附件、analytics、结构化模拟结果、阶段草稿、canonical 页面与 App Shell 导航。
- [Batch 11 体验复核](./product-experience-review-20260722-v11-batch11.md)：PASS；绑定 `U=046cc701b37d73539309d2f110df9a72816d3b83`、runtime probe、desktop `1440x1000`、mobile `390x844` 与四张截图，控制台无 error、无横向溢出。
- `git diff --check`：PASS。

第一次 M1–3 runtime selftest 因未设置 `DATABASE_URL` 失败；确认是测试环境配置后，使用带 `v11m1m3` marker 的一次性本地数据库完成 deploy 并重跑 PASS。`risk:preflight` 首次暴露三条 canonical 路径静态规则漂移，已按当前架构收窄修复并重跑 PASS。Batch 11 current-bound smoke 又发现 ACTIVE workspace、结构化模拟 revision 和 Batch 10 导航三处旧 fixture 契约，均已补回 selftest、运行 `pnpm check` 并在新隔离库从头重跑 PASS。

## Admission 缺口

- `AF-RISK-SC-002`：当前只读 preflight 为 `needs_evidence`；候选 commit 冻结并获得匹配 CI run 后必须重采，不复用旧 commit 记录。
- `AF-RISK-SC-004`：当前只读 preflight 为 `needs_remote_readback`；必须按目标 commit/同一维护窗口重采 main protection readback 与 controlled PR 证据。
- UX：current-bound 本地证据已通过；它只证明 `U` 及合法 evidence-only 后代，不替代签名 Release 或生产 smoke。
- 签名 Release：尚未收到候选 commit 对应的明确确认句；未创建 tag、GitHub Release、SBOM/provenance、GHCR digest、checksum 或 cosign 资产。

## 不证明

本记录不证明签名 Release 已创建、Release assets 可信、生产 backup/migration/apply/smoke/rollback 已执行、线上运行 `1.1.0`、长期运营已完成或任何 residual 已关闭。

## 安全事实

- `AREAFORGE_AUTO_APPLY=none` 未改变。
- production touched：no。
- production write attempted：no。
- server command attempted：no。
- backup/restore attempted：no。
- production migration attempted：no。
- updater apply/rollback attempted：no。
- tag/Release created：no。
- residual ledger status changed：no；仅同步 0035 taskRef 与 DATA-001 控制面复核入口。
- secret value printed：no。

## Residual 与回滚边界

- 本候选继续关联 `AF-RISK-SC-002`、`AF-RISK-SC-004`、`AF-RISK-DATA-001`；不自动改变任何状态。
- 生产回滚目标必须由 complete minor Release admission 与后续生产确认重新冻结；新 workspace/custom subject 写入后不能直接把 `v0.1.7` 当 compatibility floor。
- 数据库/uploads restore、DROP、数据修复、附件移动或删除仍需独立高风险确认。
