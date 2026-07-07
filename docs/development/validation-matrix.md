# 验证矩阵

## 原则

验证从改动范围出发，选择最小充分集合。不要因为任务小就不验证，也不要每次都默认跑最大集合。

不能运行的验证必须说明原因。没有验证，不宣称完成。

## 路径到验证

| 改动范围 | 最小验证 |
|---|---|
| `docs/**`、`README.md`、`AGENTS.md` | `rg` 检查旧引用和入口路径，`pnpm docs:readiness`，`git diff --check` |
| `tasks/**`、`workflow/**` | 检查对应 `docs/**` 源事实是否存在，`pnpm docs:readiness`，`git diff --check` |
| `package.json`、`pnpm-workspace.yaml` | `pnpm install --frozen-lockfile` 或说明无法运行原因，`pnpm check` |
| `prisma/schema.prisma`、`prisma/migrations/**` | `pnpm db:validate`，涉及 migration 时补充迁移和回滚说明 |
| `packages/core/**` | 相关单元测试，至少 `pnpm typecheck` |
| `packages/db/**` | `pnpm db:generate`、`pnpm typecheck`，涉及查询行为时补测试或手动验证 |
| `packages/ai/**` | AI 输出 schema 校验测试，本地回退路径验证 |
| `packages/storage/**` | 上传策略测试，大小、MIME、路径穿越边界验证 |
| `apps/web/**` UI | `pnpm check`，可启动时用浏览器或截图检查主要页面 |
| `infra/**`、`docker-compose*.yml` | `docker compose config`，部署文档同步检查 |
| `.env.example`、配置解析 | 配置 schema 覆盖检查，敏感字段不入库检查 |
| 高风险包确认前准备 | `pnpm risk:preflight`，确认只读护栏、配置键、文档引用和危险默认值 |

## Package B Batch 0 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 0 后，才允许修改 `prisma/schema.prisma` 和生成 migration。实现后至少运行：

- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：开始计时、结束计时、active session、dashboard、analytics、reports。
- 页面烟测：首页结束一次计时后刷新，仍能看到有效/低转化状态和收口文本。

注意：Batch 0 获确认后，`pnpm risk:preflight` 已调整为允许 Batch 0 字段存在，继续阻止 Batch 1-6 未确认模型越界。

## Package B Batch 1 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 1 后，才允许新增 `CheckIn` 模型、生成 migration 和改写快照读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：结束计时、保存复盘、任务 `create/update/complete/defer/drop/recover/split/convert-review` 后当日 `CheckIn` 被 upsert；计划日变化必须刷新旧学习日和新学习日；dashboard、analytics、reports 优先读快照，缺失日期 fallback 正常。
- active session 烟测：无关联任务开始计时但未结束时，首页可以实时展示正在运行的时长，但不得创建或改写 `CheckIn`；若关联任务从 `TODO` 改为 `IN_PROGRESS`，只允许刷新任务计划日的任务状态口径，不得写入未结束 session 时长；结束计时后才固化到日快照。
- 页面烟测：首页、`/analytics`、`/reports` 刷新后连续性、低效天和低转化提示保持一致。

注意：Batch 1 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model CheckIn` 在 schema 中出现，也必须阻止 `prisma.checkIn` / `tx.checkIn` 读写路径提前出现；Batch 1 完成并更新台账后，门禁应要求 `model CheckIn` 存在，并继续阻止 Batch 2-6 未确认模型越界。

## Package B Batch 2 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 2 后，才允许新增 `StudyTask.parentTaskId`、`TaskDebtEvent`、生成 migration 和改写债务事件写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：complete、defer、drop、recover、split、convert-review、end-session 自动完成路径和模拟考试完成路径同时写入 `AuditEvent` 与 `TaskDebtEvent`；拆小任务写入 `parentTaskId`；旧任务仍按 `StudyTask.status/debtStatus/plannedDate` fallback。
- 页面烟测：首页任务区、欠账预览和 `/reports` 对旧数据与新事件账本展示一致。

注意：Batch 2 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `parentTaskId` 和 `model TaskDebtEvent` 在 schema 中出现；Batch 2 完成并更新台账后，门禁应要求 Batch 2 字段/模型存在。Batch 5 完成后，门禁继续阻止 Batch 6 未确认模型越界。

## Package B Batch 3 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 3 后，才允许新增 `RecoveryState`、生成 migration 和改写恢复状态读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：无 active 状态时 dashboard fallback 实时规则；手动和规则触发创建 active `RecoveryState`；完成或取消只更新 `RecoveryState.status/endedAt/exitCondition`；`StudyTask` 不被批量改写。
- 页面烟测：首页恢复模式刷新后持久，计时器聚焦恢复候选但任务面板保留完整任务列表；退出后恢复正常任务展示和实时 fallback。

注意：Batch 3 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model RecoveryState` 在 schema 中出现；Batch 3 完成并更新台账后，门禁应要求 `RecoveryState` 存在。Batch 5 完成后，门禁继续阻止 Batch 6 未确认模型越界。

## Package B Batch 4 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 4 后，才允许新增 `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`、生成 migration 和改写考纲掌握证明读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：条件勾选、证据引用、复测 passed/failed/partial、标记 mastered 的 `evaluateMasteryProof` 拦截、无显式证据 fallback 到现有 `_count`。
- 页面烟测：`/syllabus` 条件、证据、复测、刷新后节点状态和历史 fallback 展示一致。

注意：Batch 4 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model MasteryConditionRecord`、`model MasteryEvidence` 和 `model MasteryRetest` 在 schema 中出现；Batch 5 完成并更新台账后，门禁应要求 Batch 4 和 Batch 5 模型存在，并继续阻止 Batch 6 未确认模型越界；复测失败或部分通过不能自动降低节点状态。

## Package B Batch 5 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 5 后，才允许新增 `SimulationExam`、`SimulationSubjectResult`、生成 migration 和改写结构化模拟考试读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：创建结构化模拟考试、保存科目结果、同一场同一科唯一性、旧 `StudyTask.type = "simulation_exam"` 只读兼容。
- 页面烟测：`/simulation` 列表、结果保存、刷新和第一次同步自测标记保持一致。

注意：Batch 5 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model SimulationExam` 和 `model SimulationSubjectResult` 在 schema 中出现；Batch 5 完成并更新台账后，门禁应要求这些模型存在，并继续阻止 Batch 6 未确认模型越界；本批不自动迁移旧任务型模拟，也不自动调整阶段计划。

## Package B Batch 6 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 6 后，才允许新增 `StagePlan`、`StageAdjustmentDraft`、生成 migration 和改写阶段计划/阶段调整草稿读写路径。实现后至少运行：

- `pnpm db:generate`
- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：阶段计划创建/更新、草稿生成、驳回、确认应用、重复提交、审计记录、`canAutoApply=false`、`requiresUserConfirmation=true`、Package C 未确认时长期 AI 外呼关闭。
- 页面烟测：`/simulation` 和 `/reports` 中阶段计划、草稿边界和确认状态展示一致。

注意：Batch 6 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model StagePlan` 和 `model StageAdjustmentDraft` 在 schema 中出现；Batch 6 完成并更新台账后，门禁应要求这些模型存在；任何自动任务重排、批量修改任务或真实 AI 长期外呼都不属于本批确认前边界。

## Package A 专项验证

确认前只允许做文档、storage 纯规则和护栏准备：

- `pnpm --filter @areaforge/storage test`
- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`
- 人工扫描：`rg --files apps/web/app | rg 'attachments|upload'` 不应出现上传/下载 route。
- 人工扫描：`find apps/web/public -name uploads -o -name attachments -o -name files` 不应出现公开上传目录。
- 人工扫描：`rg 'attachment\.uri|upload://attachment' apps/web/app apps/web/components` 不应出现 UI 直链内部 metadata。
- 人工扫描：`rg 'type=\"file\"|multipart/form-data|FormData|downloadUrl|/api/attachments' apps/web/app apps/web/components apps/web/lib` 不应出现附件上传 UI、提前下载 URL 或上传调用。

用户明确确认 Package A 后，才允许新增上传/下载 route、附件服务、`/notes` 上传 UI 和真实 `UPLOAD_DIR` 写入。实现后至少运行：

- `pnpm --filter @areaforge/storage test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：未登录上传/下载 `401`；允许类型成功；超大、伪造 MIME、路径穿越、软链接逃逸失败；DB 写入失败补偿删除本次文件；文件写入失败不创建 metadata。
- API 状态码矩阵：多个 `file` 字段 `400`；空文件 `400`；畸形 multipart `400`；非法 `disposition` `400`；未登录 `401`；笔记不存在或文件缺失 `404`；metadata/hash 不一致 `409`；超大文件 `413`；不安全上传目录、文件写入失败或 metadata 写入失败 `500`，且响应不包含内部路径。
- 页面烟测：`/notes` 上传、刷新后附件列表、鉴权下载和响应头。
- 对账烟测：metadata hash/size 与文件 hash/size 一致；只读对账报告 `action=report_only`。

注意：Package A 获确认并完成前，`pnpm risk:preflight` 必须继续阻止上传/下载 route 和 `attachments-service.ts` 出现。

## Package C 专项验证

确认前只允许做文档、mock/fallback 测试和护栏准备：

- `pnpm --filter @areaforge/ai test`
- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Package C 后，才允许接入真实 OpenAI-compatible provider、读取真实 AI env/key 和发起外呼。实现后至少运行：

- `pnpm --filter @areaforge/ai test`
- `pnpm --filter @areaforge/ai typecheck`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- Provider 测试：`AI_ENABLED=false` fallback；配置缺失 fallback；mock 成功；超时、429、401、5xx、invalid JSON 和 schema invalid fallback；敏感字段拦截时 provider 不被调用。
- 安全扫描：客户端 bundle 搜不到 `AI_API_KEY`；日志不包含完整 prompt、完整模型响应、API Key、动机档案、完整复盘正文、完整情绪正文或附件内容。
- 标题隐私烟测：构造任务标题为 `task title may contain private content`，确认 mock provider 请求体不包含该原文；真实 provider 第一版只允许发送任务类型、科目、风险类别或脱敏占位标签。
- 成本边界烟测：首页普通 SSR 不触发真实 provider；真实外呼只能来自明确允许的 AI API 或用户显式触发入口。

注意：Package C 获确认并完成前，`pnpm risk:preflight` 必须继续阻止真实 provider token、Web AI env/key 读取和首页真实外呼成本边界越界。

## Package D 专项验证

确认前只允许做只读规则、只读 API/UI 标签和护栏准备：

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm risk:preflight`
- `git diff --check`
- 人工扫描：`rg --files apps/web/app/api | rg 'debt-reorder|reports|simulation/stage|simulation/exams' | rg 'apply|confirm|reject'` 不应出现长期闭环写路由。
- 人工扫描：`rg 'ReportSnapshot|ReportDecision|TaskReorderApplication|StagePlanApplication|AiStageAdjustment' prisma apps/web/lib/study` 不应出现报告快照、决策、应用或长期 AI 持久化面。
- 只读回归：`GET /api/tasks/debt-reorder`、`GET /api/reports/periodic`、`GET /api/simulation/stage` 只能暴露只读建议或草稿，返回体里的建议必须保留 `canAutoApply=false` / `requiresUserConfirmation=true`；对应路径不得出现 `POST`、`PATCH`、`PUT` 或 `DELETE` 应用语义。

用户明确确认 Package D 后，才允许新增任务重排应用、阶段计划应用、报告决策写入、报告快照持久化或长期 AI 阶段调整外呼。实现后至少运行：

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：债务重排确认/驳回/应用、重复提交、部分失败摘要和审计记录；阶段草稿确认/驳回/应用；报告策略确认/驳回。
- 页面烟测：首页、`/reports`、`/analytics`、`/syllabus`、`/simulation` 展示确认边界和应用结果。
- 边界烟测：用户确认前不应用；Package C 未确认时长期 AI 外呼关闭；Package B 结构化模型缺失时仍有只读 fallback。

注意：Package D 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `apply/confirm/reject` 写路由、报告快照/决策/应用模型、长期 AI 外呼和阶段计划应用路径越界。

## Package E 专项验证

确认前只允许做文档、compose config 和护栏准备：

- `docker compose config`
- `docker compose --env-file .env.example -f docker-compose.prod.yml config`
- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

注意：裸跑 `docker compose -f docker-compose.prod.yml config` 若没有生产 env，预期会因 `AUTH_SESSION_SECRET is required` 等 required production env 缺失而失败；确认前用 `.env.example` 的占位值验证 compose 结构，不代表生产密钥已准备。

用户明确确认 Package E 后，才允许生产部署、生产 migration deploy、真实备份恢复演练或服务器命令。完成后至少保留：

- 发布记录：git commit、release tag、`AREAFORGE_IMAGE`、镜像 digest、compose hash、Nginx 配置 hash、操作者和时间。
- 备份证据：PostgreSQL dump、上传目录归档、生产 `.env` 权限收紧备份、当前 compose/Nginx 配置副本。
- 恢复演练：临时库导入、临时上传目录恢复、登录、首页、任务、计时、复盘、附件 metadata/hash 对账。
- 发布后烟测：`GET /api/health`、登录、首页、任务、计时、复盘、`/syllabus`、`/notes`、`/analytics`、`/reports`；附件和真实 AI 若启用，只用小测试文件和最小测试数据。
- 回滚记录：上一镜像 tag、是否恢复数据库/上传目录、恢复耗时、失败原因、残余风险和后续修复任务。

注意：Package E 完成前，`pnpm docs:completion` 必须继续因生产发布、备份、恢复演练、发布后烟测和回滚证据缺失而失败。

## docs 100% 最终门禁

- `pnpm docs:readiness` 只证明治理结构、入口和追踪关系存在。
- `pnpm risk:preflight` 只证明 Package A-E 的护栏存在，不执行上传、后续 migration、AI 外呼、部署或备份恢复；其中 Package B 检查 Batch 0-5 字段/模型和运行时证据已存在、Batch 6 确认包和专项验证存在且未确认模型仍未越界；Package C 还检查真实 provider 未接线、Web 侧不读取 AI env/key、AI 上下文保持聚合最小化、首页只允许本地 fallback 成本边界；Package D 还检查只读重排 API、只读阶段调整草稿 API、confirm-only DTO、UI 标签和文档边界。
- `pnpm docs:completion` 用于最终完成验收；在 `feature-traceability` 仍有“基础版 / 待确认 / 未实现”、Package A-E 完成行缺少验证/烟测/文档同步/残余风险证据、Package B Batch 0-6 未全部完成，或缺少高风险完成记录时，预期应失败。
- 日常文档同步不要求 `pnpm docs:completion` 通过；声称 AreaForge docs 100% 完成前必须通过。

## 风险升级

以下情况必须扩大验证：

- 改动跨 `apps/web`、`packages/db`、`prisma`。
- 改动认证、会话、上传、AI、备份、部署。
- 改动会影响已有数据。
- 文档和代码出现不一致。
- 上一次验证失败或被阻塞。

## 验证报告格式

```text
改动范围:
- 

改了什么:
- 

为什么这样改:
- 

已运行:
- <command>: <result>

未运行:
- <command>: <reason>

结果:
- PASS / FAIL / BLOCKED / NOT-READY

残余风险:
- 
```

## 当前已知验证阻塞

仓库使用 pnpm 11.7.0，并通过 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 与 `allowBuilds` 允许 Prisma、Sharp 和相关解析依赖执行必要 build script。若当前机器仍提示 ignored builds，按 `docs/development/setup.md` 执行 `pnpm approve-builds --all` 后再跑 `pnpm check`。
