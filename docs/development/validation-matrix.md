# 验证矩阵

## 原则

验证从改动范围出发，选择最小充分集合。不要因为任务小就不验证，也不要每次都默认跑最大集合。

不能运行的验证必须说明原因。没有验证，不宣称完成。

## 路径到验证

| 改动范围 | 最小验证 |
|---|---|
| `docs/**`、`README.md`、`AGENTS.md` | `rg` 检查旧引用和入口路径，`pnpm docs:readiness`，`git diff --check` |
| `tasks/**`、`workflow/**` | 检查对应 `docs/**` 源事实是否存在，`pnpm docs:readiness`，`git diff --check` |
| `.codex/skills-src/**`、`.agents/skills/**` | `pnpm skills:validate`，`git diff --check`；若 skill 改变企业治理、发布、运维、观测、事故、安全、供应链、残余风险、AI 或文档同步口径，补跑 `pnpm docs:readiness` 和 `pnpm risk:preflight` |
| `package.json`、`pnpm-workspace.yaml` | `pnpm install --frozen-lockfile` 或说明无法运行原因，`pnpm check`；涉及 `pg` / Prisma adapter 时补跑 `pnpm pg:trace-deprecation` |
| `SECURITY.md`、`.github/dependabot.yml`、`.github/pull_request_template.md`、`docs/development/dependency-policy.md`、`scripts/quality/governance-preflight.ts` | `pnpm governance:preflight`，`pnpm docs:readiness`，`git diff --check` |
| `docs/development/operational-readiness.md`、`docs/development/residual-risk-ledger.md`、`docs/development/residual-risk-ledger.json`、`scripts/quality/ops-readiness-preflight.ts`、`scripts/quality/residual-ledger-validate.ts`、`scripts/ops/operational-readiness-summary.ts` | `pnpm ops:readiness`，`pnpm residuals:validate`，`pnpm ops:readiness:summary`，`pnpm docs:readiness`，`git diff --check` |
| `prisma/schema.prisma`、`prisma/migrations/**` | `pnpm db:validate`，涉及 migration 时补充迁移和回滚说明 |
| `packages/core/**` | 相关单元测试，至少 `pnpm typecheck` |
| `packages/db/**` | `pnpm db:generate`、`pnpm typecheck`，涉及查询行为时补测试或手动验证 |
| `packages/ai/**` | AI 输出 schema 校验测试，本地回退路径验证 |
| `packages/storage/**` | 上传策略测试，大小、MIME、路径穿越边界验证 |
| `apps/web/**` UI | `pnpm check`，可启动时用浏览器或截图检查主要页面；涉及核心学习闭环、附件、模拟、阶段或版本中心体验时，在本地临时库上补跑 `pnpm smoke:local-ux` |
| `infra/**`、`docker-compose*.yml` | `docker compose config`，部署文档同步检查 |
| `.github/workflows/**`、`ops/github-release-updater/**`、`ops/update-agent/**`、`scripts/ops/production-readonly-smoke.ts`、`infra/docker/migration.Dockerfile` | `pnpm audit:prod`、`pnpm shellcheck:updater`、`pnpm github-release-updater:preflight`、`pnpm governance:preflight`、`pnpm ops:readiness`，涉及镜像时补充 Docker build；变更 smoke 脚本时用临时 HTTP mock 或受控环境验证 `pnpm smoke:prod-readonly` |
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

注意：Batch 2 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `parentTaskId` 和 `model TaskDebtEvent` 在 schema 中出现；Batch 2 完成并更新台账后，门禁应要求 Batch 2 字段/模型存在。Batch 6 完成前，门禁继续阻止 Batch 6 未确认模型越界。

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

注意：Batch 3 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model RecoveryState` 在 schema 中出现；Batch 3 完成并更新台账后，门禁应要求 `RecoveryState` 存在。Batch 6 完成前，门禁继续阻止 Batch 6 未确认模型越界。

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

注意：Batch 4 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model MasteryConditionRecord`、`model MasteryEvidence` 和 `model MasteryRetest` 在 schema 中出现；Batch 4 完成并更新台账后，门禁应要求 Batch 4 模型存在。Batch 5 和 Batch 6 分别由各自批次台账解锁对应模型；复测失败或部分通过不能自动降低节点状态。

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

注意：Batch 5 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model SimulationExam` 和 `model SimulationSubjectResult` 在 schema 中出现；Batch 5 完成并更新台账后，门禁应要求这些模型存在，并在 Batch 6 完成前继续阻止 Batch 6 未确认模型越界；本批不自动迁移旧任务型模拟，也不自动调整阶段计划。

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
- API 烟测：阶段计划创建/更新、草稿生成、驳回、确认应用、重复提交、审计记录、`canAutoApply=false`、`requiresUserConfirmation=true`、Batch 6 范围内不触发长期阶段 AI 外呼。
- 页面烟测：`/simulation` 和 `/reports` 中阶段计划、草稿边界和确认状态展示一致。

注意：Batch 6 获确认并完成前，`pnpm risk:preflight` 必须继续阻止 `model StagePlan` 和 `model StageAdjustmentDraft` 在 schema 中出现；Batch 6 完成并更新台账后，门禁应要求这些模型、migration、service、API、DTO、UI 和确认边界证据存在。Batch 6 只狭窄允许阶段草稿 `confirm/reject` 写路由，用于用户显式确认后更新关联 `StagePlan` 和写审计；任何自动任务重排、批量修改任务、报告决策应用、长期 AI 外呼或生产 migration deploy 都不属于本批。

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

注意：Package A 完成后，`pnpm risk:preflight` 必须改为要求上传/下载 route、`attachments-service.ts`、`/notes` 上传 UI、鉴权 `downloadApiPath` 和附件专项证据存在，同时继续阻止 public 暴露、内部 `uri` / `storedName` / 上传绝对路径泄露，以及 Package A 范围外的删除、跨对象附件、AI 解析和生产发布。

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

注意：Package C 完成后，`pnpm risk:preflight` 必须改为要求 provider、Web 服务端 env、显式 route 触发、fallback、标题脱敏和专项测试证据存在，同时继续阻止客户端公开 AI env、首页普通 SSR 外呼、敏感上下文发送、完整 prompt/raw response 持久化、长期阶段 AI 外呼和自动覆盖记录。

## Package D 专项验证

确认前只允许做只读规则、只读 API/UI 标签和护栏准备：

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm package-d:preflight`
- `pnpm risk:preflight`
- `git diff --check`
- 人工扫描：`rg --files apps/web/app/api | rg 'debt-reorder|reports|simulation/stage|simulation/exams' | rg 'apply|confirm|reject|ai'` 不应出现未确认的长期闭环写路由；Package D Batch D1 完成后，仅 `/api/reports/periodic/decisions` 属于已确认报告决策入口；Package D Batch D2 完成后，仅 `/api/tasks/debt-reorder/decisions` 和 `/api/tasks/debt-reorder/applications` 属于已确认债务重排所选项写入口；Package D Batch D3 完成后，仅 `/api/simulation/stage-adjustment-drafts/ai` 属于已确认长期 AI 草稿显式触发入口。
- 人工扫描：`rg 'ReportSnapshot|ReportDecision|TaskReorderApplication|StagePlanApplication|AiStageAdjustment|AiCall|AiUsage|promptHash|tokenUsage|rawResponse' prisma apps/web/lib/study packages/ai/src` 不应出现未确认的应用或长期 AI 持久化面；Package D Batch D1 完成后，仅 `PeriodicReportDecision` 与 `periodicReportDecision` 属于已确认报告决策账本；Package D Batch D3 完成后，仅 `aiStageAdjustmentDraftSchema` 这类草稿 schema 命名和 `StageAdjustmentDraft.source="ai"` 写入属于已确认范围，不允许新增长期 AI 调用历史或费用账本。
- 只读回归：`GET /api/tasks/debt-reorder`、`GET /api/reports/periodic`、`GET /api/simulation/stage` 只能暴露只读建议或草稿，返回体里的建议必须保留 `canAutoApply=false` / `requiresUserConfirmation=true`；对应 GET 路径不得出现 `POST`、`PATCH`、`PUT` 或 `DELETE` 应用语义。D2 的债务重排写入只允许在 `decisions` 和 `applications` 子路由中处理用户所选项。

用户明确确认对应 Package D 批次后，才允许新增该批次范围内的任务重排应用、阶段计划应用、报告决策写入、报告快照持久化或长期 AI 阶段调整外呼。D3 已完成的长期 AI 只限显式草稿入口；D3 范围外能力仍需后续确认。实现后至少运行：

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：债务重排确认/驳回/应用、重复提交、部分失败摘要和审计记录；阶段草稿确认/驳回/应用；报告策略确认/驳回。
- 页面烟测：首页、`/reports`、`/analytics`、`/syllabus`、`/simulation` 展示确认边界和应用结果。
- 边界烟测：用户确认前不应用；D3 显式入口之外长期阶段 AI 外呼关闭；Package B 结构化模型缺失时仍有只读 fallback。

推荐批次验证：

| 批次 | 验证重点 |
|---|---|
| Batch D1 报告决策入口 | `pnpm db:generate`、`pnpm db:validate`、临时库 `pnpm db:migrate:deploy`；周/月报告确认、驳回、重复提交、审计摘要、冻结 `reportSnapshot`、下一周期草稿和只读回放；确认/驳回前后 `StudyTask`、`TaskDebtEvent`、`StagePlan`、`StageAdjustmentDraft` 不变 |
| Batch D2 债务重排确认流 | 不新增 migration；建议确认/驳回/应用、只处理所选项、`TaskDebtEvent` 和 `AuditEvent` 双证据、部分失败停止或返回跳过摘要、重复提交幂等、不自动延期/删除全部欠账 |
| Batch D3 长期阶段 AI 草稿 | 已完成：鉴权 POST-only `/api/simulation/stage-adjustment-drafts/ai`；长期 AI 最小字段清单和阶段目标摘要；禁止字段扫描；`AI_ENABLED=false` 本地规则；配置缺失 fallback；mock provider 成功写 `source="ai"`；schema invalid fallback；敏感字段拦截；客户端密钥扫描；草稿不自动应用；前后 `StudyTask`、`TaskDebtEvent` 和 `StagePlan` 不变 |
| Batch D4 长期风险和主题闭环 | 已完成：`GET /api/analytics/long-term-risks` 鉴权 GET-only；`long-term-risk-service` 调用 `summarizeLongTermRisks` 并保留 `evidenceFreshness`、`nextAction`、`canAutoApply=false`、`requiresUserConfirmation=true`；`/reports`、`/analytics`、`/syllabus`、`/notes`、`/simulation` 和首页状态主题共用同一长期风险 DTO；service/route smoke 证明业务表不变 |
| Batch D5 收口 | 已完成：`pnpm check`、`pnpm package-d:preflight`、`pnpm risk:preflight`、`pnpm docs:readiness` 通过；`pnpm docs:completion` 在 Package E E1-E4 收口后一并通过 |

注意：Package D 全部完成前，`pnpm risk:preflight` 必须继续阻止未确认批次的长期 AI 外呼和跨模块应用路径越界。Package B Batch 6 完成后，仅 `/api/simulation/stage-adjustment-drafts/:id/confirm|reject` 属于已确认的阶段草稿状态写入；Package D Batch D1 完成后，仅 `/api/reports/periodic/decisions` 属于已确认报告决策入口；Package D Batch D2 完成后，仅 `/api/tasks/debt-reorder/decisions` 和 `/api/tasks/debt-reorder/applications` 属于已确认债务重排所选项写入口；Package D Batch D3 完成后，仅 `/api/simulation/stage-adjustment-drafts/ai` 属于已确认长期 AI 草稿显式触发入口。其他 `apply/confirm/reject` 写路由、自动阶段应用、长期 AI 历史持久化和费用账本仍必须拦截。

`pnpm package-d:preflight` 采用批次感知门禁：D3 完成后只狭窄放行长期 AI 草稿 route/service 和 `source="ai"` 草稿写入；D4 完成后只狭窄放行长期风险 GET-only API、只读 service 和页面同源展示；D5 完成后要求 Package D 主状态和 `feature-traceability` 收口证据同时存在，并继续阻止 Package E 生产部署动作混入 Package D。

## Package E 专项验证

确认前只允许做文档、compose config 和护栏准备：

- `docker compose config`
- `docker compose --env-file .env.example -f docker-compose.prod.yml config`
- `pnpm package-e:preflight`
- `pnpm release:evidence:validate <release-record.md|txt> [attachment-reconciliation.csv]`
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
- 发布证据记录校验：`pnpm release:evidence:validate <release-record.md|txt> [attachment-reconciliation.csv]` 通过；该命令只读发布记录和可选附件对账 CSV，附件对账 `action` 必须全部为 `report_only`。
- 发布证据硬门禁：发布记录必须包含 `migrationRunner`、`envBackupSha256`、compose/Nginx 副本路径、回滚计划、回滚演练结果、恢复耗时、是否需要数据库/上传目录恢复和失败原因；`migrationApplied=yes` 时 `migrationRunner` 只能是 `controlled_release_workdir` 或 `one_off_migration_job`，`migrationApplied=no` 时只能是 `not-applicable`。

推荐批次验证：

| 批次 | 验证重点 |
|---|---|
| Batch E1 生产配置与发布工件预检 | 已完成：`pnpm check`、`pnpm package-e:preflight`、compose config、生产 env 清单、镜像 tag、Nginx 配置、migration deploy 执行载体草案、发布记录草案和中止条件；不执行生产部署、不运行生产 migration、不触碰生产数据库或上传目录 |
| Batch E2 发布前备份与恢复演练 | 已完成：PostgreSQL dump、上传目录归档、生产 `.env` 本地替代备份权限收紧、compose/Nginx 副本、临时库导入、临时上传目录恢复、附件 metadata/hash 对账只读 `report_only`；记录见 `docs/development/package-e-e2-restore-drill-record.md`，当前无附件记录所以 `attachmentHashMatched=not-applicable` |
| Batch E3 生产发布与 migration deploy | 已完成本机单机生产目标发布：备份点、生产 env 私有备份、一次性 migration job、10 条 migration deploy、compose 启动、`GET /api/health`、登录、首页、任务、计时、复盘、附件和 AI fallback/provider 烟测，记录见 `docs/development/package-e-e3-prod-local-release-record.md`；本地 production-mode 演练记录仍保留在 `docs/development/package-e-e3-local-release-record.md`；E3 本机批次不单独代表远端切换，远端域名 HTTPS / Nginx / GHCR Release 已由后续 `v0.1.5` 记录补齐 |
| Batch E4 回滚演练与 Package E 收口 | 已完成本机生产目标回滚收口：上一镜像 tag、回滚步骤、回滚后 health/登录/页面/API smoke、任务/计时/复盘、附件 `report_only` 对账、是否恢复数据库/上传目录、失败原因、恢复耗时、roll-forward 和 `pnpm release:evidence:validate`，记录见 `docs/development/package-e-e4-prod-local-rollback-record.md`；早期本地机制演练记录保留在 `docs/development/package-e-e4-local-rollback-record.md` |

注意：Package E 已按本机单机生产目标完成，并已补充真实远端 `https://forge.areasong.top/` 的 GitHub Release `v0.1.5` 签名更新证据。当前远端 AreaForge 运行在服务器 `127.0.0.1:3020`，`127.0.0.1:3000` 在该服务器上属于 Grafana；后续域名、Nginx、端口或服务器迁移仍需另列外部部署验收。

`pnpm package-e:preflight`、`pnpm risk:preflight` 和 `pnpm docs:completion` 均采用 Package E 批次感知门禁：历史 E1-E4 收口时，Package E 主状态必须在所有批次证据齐全后才能标为完成；后续发布仍必须包含明确确认、`pnpm` 验证、烟测/备份/恢复/发布/回滚证据、文档同步和残余风险。Package E 最终完成行还必须包含发布、备份、恢复、回滚、`release:evidence:validate`、`report_only`、migration deploy 执行载体、镜像 digest 和 Nginx 证据。根 `package.json` 不允许新增生产 deploy、backup、restore、`docker compose up/down` 或服务器命令脚本；现有 `db:migrate:deploy` 只能作为高风险确认后的受控执行参考。

## GitHub Release 自动更新专项验证

服务器侧 GitHub Release updater 改动至少运行：

- `pnpm audit:prod`
- `pnpm github-release-updater:preflight`
- `pnpm shellcheck:updater`
- `pnpm check`
- 如改动 Dockerfile：`docker build -f infra/docker/migration.Dockerfile .`

CI/Release workflow 还必须通过 `pnpm governance:preflight` 的 GitHub Actions pinning 检查：所有外部 `uses:` 应 pin 到 40 位 commit SHA，并保留行内版本注释以便升级审查。

验证重点：

- Release manifest 必须包含 `webImageDigest`、`migrationImageDigest`、`sbomAsset`、`provenanceAsset`、`SHA256SUMS`、`SHA256SUMS.sig` 和 `autoApply` 策略；`SHA256SUMS` 必须覆盖 manifest、SBOM、provenance 和 compose。
- updater 必须校验签名/hash、拒绝 `latest`、使用锁、发布前备份、一次性 migration image、健康 smoke 和应用镜像回滚。
- updater 日志不得打印数据库 URL、生产 `.env` 内容、密码、AI key、完整 prompt、附件内容或上传绝对路径。
- Web runtime 不得新增 updater route、Docker/backup/restore/migration 命令入口或 `docker.sock` 访问。
- `AREAFORGE_AUTO_APPLY=none` 是默认策略；patch 自动应用必须同时满足服务器配置和 manifest `autoApply.patch=true`。

当前远端 `v0.1.5` 已验证：Release asset 包含 `areaforge-release-manifest.json`、`docker-compose.prod.yml`、`SHA256SUMS` 和 `SHA256SUMS.sig`；服务器 `cosign verify-blob --bundle` 返回 `Verified OK`，`sha256sum -c` 通过；Web image digest 为 `ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9`；migration image digest 为 `ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:04aa20e92323c9f9b14c8bd096d8cfa9ea62d9baab23f94d4976d7882bfa2ae7`；`GET https://forge.areasong.top/api/health` 返回 `0.1.5`；update-agent 状态为 `signatureRequired=true`、`timerEnabled=true`、`timerActive=true`、`blocker=null`。`v0.1.5` 是历史发布证据，不包含本次新增的 SBOM/provenance 资产；`AF-RISK-SC-001` 必须等下一次签名 Release 生成并校验这些资产后关闭。

## docs 100% 最终门禁

- `pnpm docs:readiness` 只证明治理结构、入口和追踪关系存在。
- `pnpm risk:preflight` 只证明 Package A-E 的护栏存在，不执行上传、后续 migration、AI 外呼、部署或备份恢复；其中 Package B 检查 Batch 0-6 字段/模型和运行时证据已存在，并继续确认没有越过已确认范围；Package C 完成后检查真实 provider、Web 服务端 env 和显式 route 触发证据已存在，同时继续检查客户端密钥禁区、AI 上下文最小化、首页普通 SSR 成本边界和 prompt/raw response 持久化禁区；Package D 还检查只读重排 API、D1 报告决策证据门禁、D2-D5 批次解锁门禁、报告/任务应用禁区、Batch 6 阶段草稿确认边界、confirm-only DTO、UI 标签和文档边界；Package E 还检查 E1-E4 批次 ledger、root scripts 运维禁区、Web ops route 禁区和生产发布 runbook 边界。
- `pnpm docs:completion` 用于最终完成验收；在 `feature-traceability` 仍有“基础版 / 待确认 / 未实现”、Package A-E 完成行缺少验证/烟测/文档同步/残余风险证据、Package B Batch 0-6 / Package D D1-D5 / Package E E1-E4 未全部完成，或缺少高风险完成记录时，预期应失败。
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

证据新鲜度:
- 本次运行 / CI 运行 / 历史 release 记录 / 未提供

阻断状态:
- 工程质量:
- 安全/隐私:
- 依赖/供应链:
- CI/release:
- Git checkpoint:

结果:
- PASS / FAIL / BLOCKED / NOT-READY

残余风险:
- 
```

## 当前已知验证阻塞

仓库使用 pnpm 11.7.0，并通过 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 与 `allowBuilds` 允许 Prisma、Sharp 和相关解析依赖执行必要 build script。若当前机器仍提示 ignored builds，按 `docs/development/setup.md` 执行 `pnpm approve-builds --all` 后再跑 `pnpm check`。
