# 2026-07-20 长期运营优化轮（非发布版本计划）

## 当前状态

- 计划状态：**已完成**（2026-07-21 收口）。四路审查修复、文档体系长期化重组、docs:links/arch:boundary/docs:evergreen 门禁、到期 residual keep-open 复核（OPS-001/SC-004/OPS-005，另含 OPS-006 提前复核）与 UX-001 current-bound 重采全部落地；后续发布环见 `workflow/versions/v0.1.9-long-term-operations-release.md`。
- 当前版本状态：本轮期间 workspace 保持 `0.1.8`；收口后由 v0.1.9 计划 bump 为 `0.1.9`。`v0.1.8` 发布候选计划保持搁置，候选链顶点保留在 `codex/long-term-operability` 分支。
- 是否已有线上 Release：生产仍运行签名 Release `v0.1.7` / 应用版本 `0.1.7`。
- 是否需要同步 `docs/**`、`tasks/**`、`workflow/**` 和入口 README：已按 doc-sync-checklist 收口。

## 目标

在不创建 tag、不创建 Release、不触碰生产的前提下，把当前 checkout 推进到"本地可完成的长期运营优化全部闭环"：四路独立审查（安全/代码质量/性能/真实体验）发现并修复本地缺陷，落地轻量文档与分层门禁，重采 current-bound UX 证据，并完成到期 residual 复核登记。

## Planning Gate

- 目标：本地优化闭环 + 到期 residual keep-open 复核 + current-bound UX 证据重采 + 轻量借鉴 AreaMatrix（docs 完整性检查）与 AreaFlow（Prisma 分层边界检查）。
- 非目标：不授权 tag/Release（含搁置的 `v0.1.8`）、生产 backup/migration/deploy/rollout/probe、OPS-001 服务器侧证据采集、residual 关闭决策、OPS-007/OPS-008 实施、v1.1 产品功能、`AREAFORGE_AUTO_APPLY` 策略变化。
- Exact docs：`docs/development/maintenance-cadence.md`、`docs/development/residual-risk-ledger.md`、`docs/development/validation-matrix.md`、`docs/development/doc-sync-checklist.md`、`workflow/versions/v0.1.8-long-term-operability.md`。
- Open questions：无；发布版本号留待未来 Release 决策时再定。
- Decisions：`v0.1.8` 候选搁置（维护者 2026-07-20 决定）；本轮在新分支 `codex/ltops-optimization` 推进；不搬运 AreaMatrix/AreaFlow 平台机制，只借鉴两项轻量检查。
- Owner skill：`areaforge-operating-loop` 编排；安全面 `areaforge-security-governance`，体验面 `areaforge-product-experience` / `areaforge-qa-smoke`，文档面 `areaforge-doc-sync`，验证 `areaforge-validation-driver`。
- Validation profile：常规改动 `pnpm check`；新增 script 附 selftest；docs 改动 `pnpm docs:readiness`；收口 `pnpm ops:readiness` + `pnpm residuals:validate`。
- Source docs：`docs/development/operational-readiness.md`、`docs/development/long-term-operability-control-plane.md`。
- Source baseline：`codex/long-term-operability` 分支顶点（`978af8e`）。
- Residual risk IDs：`AF-RISK-OPS-001`、`AF-RISK-SC-004`、`AF-RISK-OPS-005`（到期 keep-open 复核）；`AF-RISK-UX-001`（重采承接 `tasks/active/0024`）；审查新发现如构成残余风险则新增登记。
- Release trigger：本轮不触发；任何未来签名 Release 仍需用户以真实 40 位候选提交明确确认。
- Apply boundary：仅本地仓库写入与本地 runtime 验证；不进入生产。
- Evidence freshness：UX 证据必须绑定本轮最终代码提交；复核记录绑定 2026-07-20。
- 验证：`pnpm check`、`pnpm docs:readiness`、`pnpm ops:readiness`、`pnpm residuals:validate`、`pnpm residuals:closure:validate <records>`、新增检查的 selftest、`pnpm experience:review:validate <fresh review>`。
- 回滚：仅回滚本轮提交（分支删除或 revert）；不涉及生产回滚。

## 范围

- 到期 residual 复核：`AF-RISK-OPS-001` / `AF-RISK-SC-004` / `AF-RISK-OPS-005` keep-open 记录与台账 reviewAt 顺延。
- 四路独立审查：安全与边界、代码质量与架构分层、性能与数据层、真实产品体验；修复其中阻塞级与可控高价值发现。
- 轻量借鉴：docs 链接完整性自动检查（AreaMatrix 风格）、Prisma 分层边界静态检查（AreaFlow 风格），均含 selftest。
- 文档体系长期化重组：新增 `docs/guide/`（上手/使用指南/配置参考/FAQ）、根 `CHANGELOG.md`、`CONTRIBUTING.md`、`.env.example` 注释；模块/架构/部署长期文档去 Package/Batch 与版本叙事；入口 README 状态收敛；`docs/development/README.md` 分类索引；workflow 版本计划统一"计划状态"标头；doc-sync-checklist 文档分层规则；`pnpm docs:evergreen` 防回归门禁 + selftest 并入 `pnpm check`。
- `AF-RISK-UX-001` current-bound UX 重采：fresh desktop/mobile 旅程 + runtime probe + validator 通过。
- 文档同步与收尾快照：AGENTS/README/workflow/operational-readiness/tasks 状态、`ops:status` / `ops:handoff` 快照。

## 不包含

- 签名 Release、生产 rollout、controlled probe、服务器侧证据采集、residual 关闭、OPS-007/OPS-008、v1.1 功能、依赖大版本升级、GitHub Actions 扫描类新增（Trivy/CodeQL 等留待独立提案）。

## 入口条件

- 分支 `codex/ltops-optimization` 自 `978af8e` 创建；工作区干净。

## 验收标准

- 功能证据：审查发现清单与修复对应提交；新增检查脚本 selftest 通过。
- 文档分层：`docs/guide/` 四篇 + CHANGELOG + CONTRIBUTING 存在；长期文档通过 `pnpm docs:evergreen`；development 索引覆盖全部现存条目；8 个版本计划均有"计划状态"标头。
- 文档同步：AGENTS/workflow README/v0.1.8 计划搁置标注/operational-readiness 相关入口一致。
- 验证命令：`pnpm check`、`pnpm docs:readiness`、`pnpm ops:readiness`、`pnpm residuals:validate` 全部通过。
- 发布证据：不适用（本轮不发布）。
- 残余风险：三份 keep-open 复核记录通过 `residuals:closure:validate`；UX-001 fresh 证据通过 `experience:review:validate`；新发现残余风险已登记。

## 退出条件

- 上述验收标准全部满足，改动以干净提交推入 `codex/ltops-optimization`；不创建 tag，不部署。
- `docs/development/feature-traceability.md` 如受影响已同步。

## 审查发现与处置（2026-07-20）

四路独立审查结论：安全无阻塞项（3 项加固建议）；代码质量无阻塞项（重复副本与巨型文件债务）；性能 2 项 🔴（首页重复查询编排、考纲证据树过度获取）；真实体验路子代理运行超时未产出报告，体验检查并入本轮 UX-001 亲自重采。

已修复（对应提交 `78590a2`、`bf79003`）：

- 安全：`getClientIp` 改为信任 Nginx 覆写的 `X-Real-IP` 并只取 XFF 最后一跳，消除登录限速伪造绕过；附件上传增加 Content-Length 预检，超限请求在读表单前即拒绝。
- 性能：`getTodayDashboard`/`getAnalyticsSummary`/考纲地图/动机封存增加 React `cache()` 请求级共享副本，首页一次渲染的重复查询编排消除；新增 `listSyllabusOptions` 轻量考纲选项树替代全证据树供选择器使用；作战台逾期任务两条同条件查询合一；周期报表按消费字段 `select`、到期笔记改 `count`；会话 `lastSeenAt` 改 5 分钟节流写。
- 质量：反假学习规则双副本合一为 `packages/core` 的 `evaluateAntiFakeStudy` 单实现；`serializeTask`/状态映射提取为 `task-serializer.ts` 共享模块；版本中心 UI 文案工具提取为 `update-center-ui.ts`（修复弹窗缺失 `AUTO_APPLY_POLICY_UNSUPPORTED` 映射的漂移）；考试日期常量收敛到 `exam-dates.ts` 单一事实源。

登记不修复（超出本轮边界或需独立决策）：

- 索引类（需 Prisma migration，命中高风险边界）：`Note.nextReviewAt` 常规索引；任务债务谓词（`plannedDate` + `status notIn`）部分索引。数据量增长后再评估收益。
- 安全加固建议：`/api/health` 未鉴权响应包含 `gitCommit`/`sourceHash` 运行时身份；该字段被 `experience:runtime:probe` 与 update-center 健康链路消费，最小化需连动观测契约，留待独立提案。
- 架构债（改动面大，无行为缺陷）：`service.ts` 1896 行按聚合面拆分；`audit()` 辅助函数多副本收敛；`apps/web` 经 `next.config.ts` 反向引用 `scripts/quality/product-experience-source` 的包自包含性问题。
- core 死导出（需产品口径决策）：`summarizeCheckInHistory`（与 `getEffectiveStudyStreak` 的连续天数口径分叉）、`summarizeLightweightDebtAction` 仅测试引用；接入或删除需先统一口径。

Bugbot 复审（2026-07-20 收口前）：

- 已修复：`getLongTermRiskSummary` 移除未使用的 `now` 参数，消除"共享副本内部取当前时间、外部又可传显式时间点"的不一致表面积（所有调用方本就无参调用）。
- 判为误报：欠账重排"合并查询截断到 12 条"——基线 `978af8e` 的原始 `debtReorderTasks` 查询本就是 `take: 12`，合并后单查询 `take: 12` 再切片前 5 作为债务卡片，行为与基线完全等价。

## UX-001 重采记录（2026-07-20）

- 隔离环境：本地 PostgreSQL 容器独立数据库 + 独立上传目录 + 本地 dev runtime，seed 合成账号，不触生产。
- 证据：34 项认证 local UX smoke 全部通过（含登录、计时开始/收口、复盘、笔记附件上传下载、错题、模拟、阶段计划、更新中心只读边界）；Playwright 桌面 1440px 六页 + 移动 390px 九张（含计时开始→结束→收口表单填写→保存的完整交互旅程）；runtime identity probe 绑定被复核提交。
- 结论：`pass`；record 见 `docs/development/product-experience-review-20260720-ltops.md`，通过 `pnpm experience:review:validate`。
- 边界：本地证据不证明生产体验；`AF-RISK-UX-001` 保持 open，人工 reaffirm 承接 `tasks/active/0024`。
- 过程噪音：采集期间并行会话两次推进 HEAD 且工作区出现指纹内中间态，导致两轮证据作废重采；最终证据绑定收口前的最终源提交。

## OPS-006 提前到期复核（2026-07-20）

- `AF-RISK-OPS-006` reviewAt 2026-07-22 即将到期，本轮顺带提前复核：结论 keep-open，记录见 `docs/development/residual-closure-review-20260720-ops-006.md`，通过 `pnpm residuals:closure:validate`；台账 reviewAt 顺延至 2026-07-27。
- 复核时 `pnpm ops:ops-006:preflight:strict` 返回 `local_validation` 且 strict gate blocked：本地实现仍在，但 doctor/runtime 证据绑定已随 HEAD 推进过期，需要在未来发布候选提交冻结后重新生成 `local_verified` 证据；关闭仍依赖匹配签名 Release、独立生产 migration/rollout、controlled probe 与 fresh production doctor。

## 运维边界

- Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令。
- 自动更新只能通过受控请求或服务器侧 updater 执行。

## 风险

- 影响：本地代码、脚本与文档；不影响生产。
- 风险：审查修复可能引入回归；靠 `pnpm check` 全量门禁与 Bugbot 复审兜底。
- 验证：见 Planning Gate 验证条目。
- 回滚：revert 本轮提交或废弃分支即可完全回退。
