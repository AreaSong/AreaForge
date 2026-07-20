# 全项目功能图

> **视图型状态入口，不是第二套权威真相。** 功能状态与批次证据的权威入口是 [`feature-traceability.md`](feature-traceability.md)，残余缺口以 [`residual-risk-ledger.md`](residual-risk-ledger.md) 为准；三者冲突时以后两者为准，并在同一轮修正本文。
> Cursor Canvas `areaforge-feature-map.canvas.tsx`（工作区 canvases 目录）是本文的可视化投影，状态变化时同步更新。

快照日期：2026-07-20（长期运营优化轮，生产运行 `v0.1.7`，仓库候选 `0.1.8` 已搁置）

## 四态与映射

| 状态 | 含义 | 对应 traceability / 台账口径 |
|---|---|---|
| `done` | 代码、文档与验证证据已落地可用 | 「已完成」（名称含"基础版"的按状态列计，范围缺口写备注） |
| `partial` | 机制已落地但存在明确证据/生产缺口 | 「已完成」+ 残余风险台账 open 项或 backlog 缺口 |
| `planned` | 已写入约定、尚未实施或需先确认 | 「暂缓」中未来可能做的 + workflow 规划 + 待确认高风险项 |
| `wont` | 明确不做的永久边界 | 「暂缓」中定位排除项与 AGENTS 高风险禁区 |

## 1. 页面与导航

| ID | 名称 | 状态 | 关键路径 | 备注 |
|---|---|---|---|---|
| `page.dashboard` | 今日作战台首页 | done | `apps/web/app/page.tsx`、`GET /api/dashboard/today` | 状态主题外壳、专注计时、任务面板、长期风险面板同屏 |
| `page.login` | 登录页 | done | `apps/web/app/login/page.tsx` | 单管理员登录，含限速与错误态 |
| `page.syllabus` | 考纲进度树/作战地图页 | done | `apps/web/app/syllabus/page.tsx`、`components/syllabus-manager.tsx` | 状态筛选、掌握证明操作、地图摘要一体 |
| `page.notes` | 笔记与资料库页 | done | `apps/web/app/notes/page.tsx`、`components/note-library.tsx` | 科目/节点/掌握状态/复习提醒筛选，含附件 UI |
| `page.mistakes` | 错题库页 | done | `apps/web/app/mistakes/page.tsx`、`components/mistake-library.tsx` | 关联科目与考纲节点轻量选项树 |
| `page.analytics` | 数据统计页 | done | `apps/web/app/analytics/page.tsx` | 长期风险面板、逐日快照优先 |
| `page.reports` | 周报/月报页 | done | `apps/web/app/reports/page.tsx` | 报告确认/驳回/只读回放入口 |
| `page.simulation` | 模拟考试工作台页 | done | `apps/web/app/simulation/page.tsx`、`components/simulation-workbench.tsx` | 阶段计划与 AI 草稿生成入口 |
| `page.motivation` | 动机封存页 | done | `apps/web/app/motivation/page.tsx` | 封存与唤醒信号展示 |
| `page.settings` | 设置/版本中心页 | done | `apps/web/app/settings/page.tsx`、`components/update-version-popover.tsx` | 受控更新请求工作台，含全局版本弹窗 |
| `page.error-fallback` | 错误/404/加载兜底 | done | `apps/web/app/error.tsx`、`not-found.tsx`、`loading.tsx` | 配套 `error-recovery-matrix.md` |
| `page.pwa-manifest` | Web App Manifest | partial | `apps/web/app/manifest.ts` | manifest 与 maskable 图标已有；无 Service Worker/离线缓存，完整 PWA 未排期 |
| `nav.brand` | 品牌视觉与导航标识 | done | `components/brand-logo.tsx`、`assets/brand/` | `pnpm brand:validate` 已入 check 门禁 |
| `scope.mini-program` | 小程序 | planned | `docs/product/feature-scope.md` 暂缓表 | 私有 Web 优先，未来可能做 |
| `scope.native-app` | 原生手机 App | planned | 同上 | 后续可考虑 PWA 或独立 App |

导航拓扑与页面跳转关系见 [`../ux/site-navigation.md`](../ux/site-navigation.md)。

## 2. 核心学习闭环（第一版必须项）

| ID | 名称 | 状态 | 关键路径 | 备注 |
|---|---|---|---|---|
| `module.auth` | 单管理员登录与会话 | done | `packages/auth`、`/api/auth/*`、`AuthSession` | scrypt 口令 + 会话；`lastSeenAt` 5 分钟节流写 |
| `module.dashboard-today` | 今日作战台聚合 | done | `apps/web/lib/study/service.ts` | React `cache()` 消除首页重复查询编排 |
| `module.countdown` | 双节点倒计时 | done | `apps/web/lib/study/exam-dates.ts` | 2026/2027 节点单一事实源，与冲刺主题联动 |
| `module.tasks` | 每日任务 | done | `/api/tasks`、`StudyTask` | 今日任务表单写入已有 `StudyTask.type` |
| `module.task-debt` | 任务债务 | done | `StudyTask.debtStatus`、`TaskDebtEvent`、complete/defer/drop/recover/split/convert-review API | 自动阶段联动/批量应用需另行确认 |
| `module.timer` | 学习计时 | done | `/api/study-sessions/*`、`StudySession` | 结构化收口字段；并发一致性生产证据见 `ops.concurrency` |
| `module.focus-timer` | 专注计时模式 | done | `components/focus-timer.tsx` | active session 跨刷新恢复；恢复模式下聚焦恢复候选 |
| `module.check-in` | 打卡与连续性 | done | `packages/core` `evaluateDailyCheckIn`、`CheckIn` 日快照 | 打开应用不算打卡；active 时长实时展示、结束固化 |
| `module.review` | 每晚复盘 | done | `DailyReview`、`/api/reviews/today` | AI 建议与结构化统计持续增强 |
| `module.syllabus` | 考纲进度树 | done | `/api/syllabus/*`、`packages/core/syllabus-import.ts` | 仅受限 Markdown 导入；PDF 解析见 `ai.pdf-syllabus` |
| `module.mastery-state` | 知识点掌握状态 | done | `SyllabusNode.status/masteryLevel` | 显式证据优先，保留 `_count` fallback |
| `module.mastery-proof` | 知识点掌握证明 | done | `packages/core/mastery-proof.ts`、`MasteryConditionRecord/MasteryEvidence/MasteryRetest` | 校验失败返回 `MASTERY_PROOF_REQUIRED`；复测 failed/partial 不自动降级 |
| `module.notes` | 笔记与资料 | done | `/api/notes`、`Note` | 附件链路见组 5 |
| `module.mistakes` | 错题本 | done | `/api/mistakes`、`Mistake` | traceability 未单列，代码与任务证据齐备 |
| `module.emotion` | 情绪与状态记录 | done | `tasks/done/0010-motivation-emotion-stage.md` | 基础版范围：标签+备注；完整情绪历史表暂不做 |
| `module.recovery` | 恢复模式 | done | `RecoveryState`、`/api/recovery-states/*`、`createRecoveryPlan` | 规则触发幂等；自动应用恢复任务需另行确认 |
| `module.anti-fake` | 反假学习检查 | done | `packages/core` `evaluateAntiFakeStudy` | 双副本已合一为 core 单实现；历史 note 不解析 |
| `module.battle-map` | 考研作战地图概览 | done | `packages/core/syllabus-map.ts` | 树形进度 + 网格概览 |
| `module.motivation-vault` | 动机封存 | done | `MotivationVault`、`/api/motivation-vault` | AI 默认不读取动机档案 |
| `module.stage-levels` | 阶段称号 | done | `packages/core` 阶段规则 | 与模拟成绩联动已由第二阶段完成 |
| `module.analytics` | 基础统计 | done | `packages/core/analytics-summary.ts`、`/api/analytics/summary` | CheckIn 快照 + 长期风险 DTO 已接入 |
| `module.persistence` | 数据持久化 | done | `prisma/schema.prisma`（23 model / 9 enum） | PostgreSQL 主状态源；生产备份/恢复/回滚证据已闭环 |
| `scope.multi-user` | 多用户系统 | wont | feature-scope 暂缓表 | 单管理员自用定位，明确不做 |
| `scope.ranking` | 排名系统 | wont | 同上 | 不符合个人备考定位 |
| `scope.rbac` | 复杂权限系统 | wont | 同上 | 单管理员阶段不引入 RBAC |

## 3. 第二阶段长期闭环

| ID | 名称 | 状态 | 关键路径 | 备注 |
|---|---|---|---|---|
| `loop.simulation-exam` | 全真模拟考试完整实现 | done | `SimulationExam/SimulationSubjectResult`、`/api/simulation/exams*` | 旧任务型模拟只读兼容，写 API 拒绝 legacy |
| `loop.first-sync-test` | 2026-12 同步自测专题流程 | done | `isFirstSynchronized`、`/api/simulation/first-diary` | 考后本地重校准草稿可持久化为待确认草稿 |
| `loop.weekly-report` | 周审判报告 | done | `/api/reports/periodic`、`packages/core/periodic-report.ts` | 时长/占比/欠账/低转化/短板/决策预览 |
| `loop.monthly-report` | 月复盘报告 | done | 同上（monthly 口径） | 展示最新持久阶段计划与草稿边界 |
| `loop.report-decision` | 报告确认/驳回/只读回放 | done | `PeriodicReportDecision`、`/api/reports/periodic/decisions` | 冻结 `reportSnapshot`；固定 `canAutoApply=false` |
| `loop.debt-reorder` | 任务债务自动重排建议 | done | `GET /api/tasks/debt-reorder` + decisions/applications | 只应用用户所选项，不自动应用全部 |
| `loop.forget-risk` | 知识点遗忘风险提醒 | done | `/api/analytics/long-term-risks`、`packages/core/long-term-risk.ts` | 报告/统计/笔记/模拟/首页读同一风险 DTO |
| `loop.note-review-reminder` | 笔记复习提醒 | done | `Note.nextReviewAt`、`/notes` 筛选 | 到期笔记用 `count` 查询 |
| `loop.map-advanced` | 作战地图高级可视化 | done | `/syllabus` 分科摘要/状态分布/优先节点 | 与显式掌握证明记录联动 |
| `loop.theme-state` | 状态主题深度联动 | done | `packages/core` `determineThemeState` | 不隐藏任务列表、不自动修改任务或阶段计划 |
| `loop.motivation-wake` | 动机唤醒机制 | done | `packages/core` `evaluateMotivationWake` | 只展示唤醒信号，不进 AI 默认上下文 |
| `loop.stage-plan` | 持久阶段计划与调整草稿 | done | `StagePlan/StageAdjustmentDraft`、confirm/reject API | 草稿确认边界持久化 |
| `loop.report-auto-apply` | 报告驱动自动任务/阶段应用 | planned | traceability「后续承接」列 | 明确不进当前范围；启动需单独高风险确认 |
| `future.v1.1` | v1.1 学习行动中心 | planned | `workflow/versions/v1.1-learning-action-center.md` | 规格已定案（五工作台/考试工作区/学习树模板导入），待实施授权 |
| `future.knowledge-canvas` | 全局知识关联画布 | planned | 同上 `/knowledge/canvas` 章节 | v1.1 组成部分：派生关系图非白板，仅保存个人布局 |

## 4. AI 边界

| ID | 名称 | 状态 | 关键路径 | 备注 |
|---|---|---|---|---|
| `ai.provider` | OpenAI-compatible provider 接入 | done | `packages/ai/src/index.ts`、`AI_ENABLED` | 普通首页 SSR 不触发外呼 |
| `ai.discipline` | 鞭策文案 | done | `/api/ai/discipline` | 配置完整时显式外呼，首页仍展示本地规则 |
| `ai.daily-review` | AI 复盘建议 | done | `/api/ai/daily-review` | 只发送聚合字段，不发完整复盘正文 |
| `ai.tomorrow-plan` | AI 明日任务建议 | done | `/api/ai/tomorrow-plan` | 任务标题默认脱敏后不进入外呼 |
| `ai.stage-draft` | AI 长期阶段调整草稿 | done | `POST /api/simulation/stage-adjustment-drafts/ai` | 只写 `source="ai"` 草稿+审计摘要；不保存完整 prompt/raw response |
| `ai.fallback` | 本地规则回退与 schema 校验 | done | `createFallback*Advice`、`validate*Advice` | 外呼失败/校验失败一律回退本地规则 |
| `ai.privacy-boundary` | AI 数据最小化边界 | done | `docs/security/file-ai-safety.md`、`docs/architecture/ai-boundary.md` | 动机档案/完整情绪/复盘正文/附件永不外发；变更属高风险 |
| `ai.cost-ledger` | AI 调用历史与费用账本 | planned | `tasks/backlog/0017-ai-stage-privacy-cost.md` | 需先确认保存策略与生产 key 烟测 |
| `ai.auto-full-plan` | AI 自动生成完整学习计划 | wont | feature-scope 暂缓表 | 永久边界：AI 只出建议/草稿，用户确认后应用 |
| `ai.pdf-syllabus` | AI 自动解析复杂 PDF 大纲 | planned | 同上 | 当前仅受限 Markdown 导入 |

## 5. 文件与存储

| ID | 名称 | 状态 | 关键路径 | 备注 |
|---|---|---|---|---|
| `storage.upload` | 笔记附件上传 | done | `POST /api/notes/[noteId]/attachments`、`packages/storage` | PDF/PNG/JPEG/WebP；Content-Length 超限预检 |
| `storage.private-dir` | UPLOAD_DIR 私有落盘 | done | `Attachment`（metadata/hash/URI 入库） | 文件本体不进 `public/` |
| `storage.auth-download` | 鉴权附件下载 | done | `GET /api/attachments/[id]` | 未授权访问被拒 |
| `storage.reconciliation` | 附件对账（只读） | done | `pnpm attachment:reconciliation` | 只生成报告，不修复 metadata、不删孤儿文件 |
| `storage.crash-window` | 附件崩溃窗口原子写协议 | planned | `tasks/backlog/0021`、`ops-007` 设计 | 需独立确认 staging/fsync 与崩溃注入测试 |

## 6. 工程与质量

| ID | 名称 | 状态 | 关键路径 | 备注 |
|---|---|---|---|---|
| `eng.monorepo` | pnpm monorepo 分层 | done | `apps/web` + `packages/{core,db,ai,auth,config,storage,ui}` | core 平台无关且有单测；db 集中 Prisma 访问 |
| `eng.arch-boundary` | Prisma 分层边界静态检查 | done | `scripts/quality/arch-layer-boundary.ts` | 已入 `pnpm check` |
| `eng.docs-gates` | docs 链接完整性 + evergreen 检查 | done | `docs-link-integrity.ts`、`docs-evergreen-check.ts` | 防长期文档回归 |
| `eng.check-gate` | `pnpm check` 聚合门禁 | done | 根 `package.json` | brand/arch/docs/typecheck/test/lint/db:validate/build |
| `eng.ci` | CI workflow | done | `.github/workflows/ci.yml` | gitleaks、审计、shellcheck、Actions 40 位 SHA pin |
| `eng.secret-scan` | 密钥扫描 | done | `pnpm secrets:scan` + CI gitleaks | 本地 + CI 双入口 |
| `eng.dependabot` | 依赖自动更新 | done | `.github/dependabot.yml` | npm/Actions/Docker 三生态每周分组 |
| `eng.local-ux-smoke` | 本地 UX smoke | done | `pnpm smoke:local-ux` | 覆盖登录到主要旅程的本地真实运行 |
| `eng.experience-review` | 体验评审证据链 | partial | `pnpm experience:review:validate`、runtime probe | 记录随源指纹漂移失效，需 current-bound 重采（`AF-RISK-UX-001`） |
| `eng.selftest` | 校验脚本 selftest 惯例 | done | `scripts/quality/*.selftest.ts`（约 80 个） | 每个 validator/preflight 配套自测 |
| `eng.tasks-doctor` | tasks/workflow 一致性 doctor | done | `pnpm tasks:doctor` | 检查任务与版本计划漂移 |
| `eng.brand-pipeline` | 品牌资产生成与校验 | done | `scripts/brand/`、`pnpm brand:validate` | 资产导出 + 一致性校验 |

## 7. 运维与发布

| ID | 名称 | 状态 | 关键路径 | 备注 |
|---|---|---|---|---|
| `ops.deploy-base` | Docker Compose 部署基座 | done | `docker-compose*.yml`、`infra/docker/`、`infra/nginx/` | 一次性 migration job 独立镜像 |
| `ops.release-workflow` | GitHub Release 签名流水线 | done | `.github/workflows/release.yml` | SBOM/provenance、SHA256SUMS.sig、cosign、GHCR digest |
| `ops.release-train` | Release train 固定发布路径 | done | `docs/development/release-train.md` | 证据链定义，不是发布授权 |
| `ops.update-center` | Web 版本中心受控请求 | done | `/api/system/update-requests`、`lib/system/update-center*.ts` | 只提交请求，不执行服务器命令 |
| `ops.update-request-v2` | Update Request V2 防陈旧绑定 | partial | `lib/system/update-request-v2.ts`、`AF-RISK-OPS-005` | 本地已实现+fixture；缺匹配签名 Release 与生产部署证据 |
| `ops.update-agent` | 服务器侧 update-agent | done | `ops/update-agent/` | root 身份领取并执行版本中心请求 |
| `ops.updater` | github-release-updater | done | `ops/github-release-updater/` | 签名校验、备份、migration、切换、回滚全在服务器侧 |
| `ops.auto-apply` | patch 自动应用策略 | planned | `AREAFORGE_AUTO_APPLY=none`、`AF-RISK-REL-001` | 当前安全默认不静默更新；启用需用户确认 |
| `ops.updater-journal` | updater 阶段日志与 hold/drain | planned | `tasks/backlog/0022`、`ops-008` 设计 | 需独立确认 root-only atomic phase journal |
| `ops.backup-restore` | 备份与恢复演练 | done | `docs/deployment/backup-restore.md`、`pnpm restore:drill:validate` | 每日 pg_dump + 上传目录 + env；生产演练证据闭环 |
| `ops.health` | 健康检查端点 | done | `GET /api/health` | 未鉴权响应含运行时身份，最小化留待独立提案 |
| `ops.prod-smoke` | 生产只读 smoke | partial | `scripts/ops/production-readonly-smoke.ts`、`AF-RISK-OPS-001` | 机制齐备；当前版本证据未重采，台账待人工关闭 |
| `ops.write-smoke` | 写入型生产 smoke | planned | `AF-RISK-OPS-002` | 仅有非执行草案；需专用账号与清理策略 |
| `ops.data-doctor` | 只读数据完整性 doctor | done | `pnpm ops:data-integrity:doctor` | 发现重复活跃计时/状态矛盾/对账缺口，不修复数据 |
| `ops.concurrency` | 业务状态并发一致性 | partial | `AF-RISK-OPS-006`、`tasks/active/0020` | 隔离 PostgreSQL 本地 `local_verified`；缺签名 Release + 生产 migration/deploy 证据 |
| `ops.alerting` | 告警策略与演练 | partial | `pnpm ops:alert:preview`、`AF-RISK-OPS-004` | 演练记录达 ready；外部告警接收人与 dashboard 未产品化 |
| `ops.evidence-chain` | 运营证据链工具族 | done | `ops:status/handoff/evidence:bundle/long-term:gate\|snapshot` | 只读聚合与校验，不等于执行 |
| `ops.post-release-obs` | 发布后 D14/D30 观察 | done | `post-release-observation-*` | UTC 日历日精确计算；不自动关闭 residual |
| `ops.v018-release` | v0.1.8 发布候选 | planned | `workflow/versions/v0.1.8-long-term-operability.md` | 维护者决定搁置；生产仍运行 v0.1.7 |
| `scope.web-exec` | Web runtime 直接执行服务器命令 | wont | AGENTS.md 高风险边界 | 永久禁区；受控请求 + 服务器侧 updater 是替代方案 |

## 8. 仓库治理约定

| ID | 名称 | 状态 | 关键路径 | 备注 |
|---|---|---|---|---|
| `gov.agents` | AGENTS 分层 agent 指南 | done | `AGENTS.md`、`apps/web/AGENTS.md` | 含 skill 快速路由表与高风险边界清单 |
| `gov.skills` | repo-local owner skills | done | `.codex/skills-src/`（17 个）、`.agents/skills/`、`pnpm skills:validate` | 工作流说明，非产品源事实 |
| `gov.residual-ledger` | 残余风险台账 | done | `residual-risk-ledger.md/json`、`pnpm residuals:validate` | schema V2，任务双向绑定 |
| `gov.maintenance` | 维护节奏与窗口记录 | done | `maintenance-cadence.md`、window 模板 + validator + index | 已实际运行周维护窗口 |
| `gov.incident` | 事故响应记录与索引 | done | incident 模板 + validator + `incident-index.json` | 索引是确定性只读投影 |
| `gov.ops-lifecycle` | SLO/lifecycle 机器契约 | partial | `operations-lifecycle.md/json` | 部分 SLO 仍 draft（availability/latency/RTO/RPO） |
| `gov.high-risk-gate` | 高风险确认包机制 | done | `high-risk-confirmation-packets.md` | migration/上传/AI/部署前先确认影响/风险/验证/回滚 |
| `gov.write-boundary` | R0-R4 运行时写边界矩阵 | done | `runtime-write-boundary.md` | 服务器命令禁区的机制化表达 |
| `gov.register` | 治理权威路径索引与预检 | done | `governance-register.md/json`、`pnpm governance:preflight` | 目录责任 + 审阅分级 |
| `gov.dependency-policy` | 依赖与供应链准入策略 | done | `dependency-policy.md` | 依赖/Actions/base image 变更走 governance:preflight |
| `gov.external-admission` | 外部能力准入边界 | done | `external-capability-admission.md` | MCP/subagent/浏览器控制不得绕过服务器命令禁区 |
| `gov.validation-matrix` | 验证选择矩阵 | done | `validation-matrix.md` | 按改动范围选最小充分验证集 |
| `gov.doc-sync` | 文档同步与分层规则 | done | `doc-sync-checklist.md`、`development/README.md` 分类索引 | 机制/状态入口/模板/历史四分层 |
| `gov.doc-system` | 长期文档体系 | done | `docs/{product,architecture,modules,ux,guide,adr,security,deployment}` | 19 份模块文档 + 4 份 guide |
| `gov.templates` | 证据记录模板库 | done | `docs/development/*-template.md`（约 18 份） | 新记录从模板复制并跑 validator |
| `gov.public-intake` | 公开支持入口 | done | `.github/ISSUE_TEMPLATE/`、`SUPPORT.md`、`SECURITY.md` | 含 metadata-only support bundle preview |
| `gov.main-protection` | main 分支保护 ruleset | partial | `tasks/backlog/0023`、`AF-RISK-SC-004` | ruleset Active + 受控 PR 验证通过；readback 证据超新鲜窗口需重采 |
| `gov.supply-chain` | 供应链证据记录体系 | done | `release-supply-chain-v0.1.7.md`、CI supply-chain records | SC-002 closed-evidence；SC-001 待维护者签名复核 |

## 统计（本快照）

| 状态 | 数量 |
|---|---|
| done | 95 |
| partial | 8 |
| planned | 12 |
| wont | 5 |

partial 与 planned 项的关闭条件一律以 `residual-risk-ledger.md` 与对应 tasks 为准，本文不承载关闭判定。

## 维护

1. 功能状态变化：先更新 `feature-traceability.md`（权威）与相关台账，再同步本文对应行与顶部快照日期。
2. 同步 Cursor Canvas 投影（`areaforge-feature-map.canvas.tsx`）。
3. 触发关系登记在 `doc-sync-checklist.md`。
