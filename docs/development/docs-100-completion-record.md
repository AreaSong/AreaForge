# docs 100% 完成记录

## 目标

本文件记录 AreaForge 推进到 docs 100% 的当前证据状态。它不是目标清单，而是完成台账：只有实际代码、验证命令、烟测结果、部署状态和文档同步都存在时，才能把对应项标为完成。

`pnpm docs:completion` 会读取本文件和 `docs/development/feature-traceability.md`。它还会单独检查 Package A-E 完成行是否包含验证、烟测、文档同步和残余风险证据，并检查 Package B 的 Batch 0-6 是否全部为 `DONE / 已完成`，防止只改 Package B 主状态却遗漏批次证据。当前仍有未完成项，因此该命令预期失败。

## 高风险包状态

| 包 | 当前状态 | 当前证据 | 缺口 | 下一步 |
|---|---|---|---|---|
| Package A | NOT_READY / 未完成 | `Attachment` schema 和 `packages/storage` 纯规则已有，已覆盖 MIME、magic bytes、随机存储名、安全 URI、相对上传目录拒绝和公开目录拒绝钩子；确认设计见 `docs/development/attachment-upload-access-design.md`；确认前验收矩阵已写入 `docs/development/docs-100-acceptance-evidence.md` 并由 `pnpm risk:preflight` 检查 | 缺上传/下载 API、UI、文件写入补偿、鉴权烟测和对账证据 | 等用户明确确认后实现附件上传与鉴权访问 |
| Package B | NOT_READY / 未完成 | 结构化 migration 设计和 Batch 0-6 已写入 `docs/development/structured-state-migration-design.md`；用户已确认并完成 Batch 0 `StudySession` 结构化收口字段和 Batch 1 `CheckIn` 日快照；Batch 1 新增 additive `CheckIn` migration，写路径在结束计时、保存复盘、任务创建/计划日或状态变化后按学习日幂等 upsert；dashboard、analytics 和 reports 已改为逐日优先读 `CheckIn`，缺失日期 fallback 到 sessions/tasks/reviews 派生；临时库 migration deploy、服务级烟测、`pnpm check`、文档同步和残余风险记录见下方批次证据 | 缺 Batch 2-6 additive migration、债务事件账本、恢复状态、掌握证明显式证据、结构化模拟考试、阶段计划与整包页面/API 烟测 | 下一步等待用户单独确认 Batch 2：债务事件与父子任务 |
| Package C | NOT_READY / 未完成 | `packages/ai` 本地 fallback、provider 抽象、schema 校验和敏感字段拦截已有；拦截已覆盖常见 key 命名变体；Web AI 服务当前不读取 AI provider env、不传真实 provider，只构造聚合上下文并返回本地规则 fallback；`pnpm risk:preflight` 已覆盖 Web provider 禁用边界、上下文最小化和首页本地 fallback 成本边界；确认设计见 `docs/development/ai-provider-integration-design.md`；确认前验收矩阵已写入 `docs/development/docs-100-acceptance-evidence.md` 并由 `pnpm risk:preflight` 检查 | 缺真实 provider、费用/隐私/限流验证、客户端密钥扫描和真实失败回退证据 | 等用户明确确认后接入真实 AI provider |
| Package D | NOT_READY / 未完成 | 模拟考试、报告、阶段调整已有基础版；`packages/core` 已提供任务债务重排建议、周期报告最大短板选择、短板来源/严重度/选择依据、周期报告策略、统计风险摘要、恢复候选选择和作战地图聚合摘要纯规则；只读报告服务、统计服务、首页恢复候选、首页债务重排建议、`GET /api/tasks/debt-reorder`、`/reports` 短板追溯信息、周期策略和本地复盘草稿 `canAutoApply=false` / `requiresUserConfirmation=true`、首页债务重排建议只读确认标签和 `/syllabus` 分科作战地图摘要、状态分布、推荐筛选、行动类型筛选及优先节点展示已消费部分 core 规则；`pnpm risk:preflight` 已覆盖债务重排只读 API、阶段调整只读草稿 API、阶段调整 confirm-only DTO/UI、报告 confirm-only DTO、报告/任务 UI 标签和文档边界；考纲服务已用已有任务、计时、笔记、错题更新时间派生证据新鲜度；`/notes` 已支持科目、节点、掌握状态和复习提醒筛选；今日任务表单已支持写入已有 `StudyTask.type`；确认范围见 `docs/development/high-risk-confirmation-packets.md`；确认前验收矩阵已写入 `docs/development/docs-100-acceptance-evidence.md` 并由 `pnpm risk:preflight` 检查 | 缺完整模拟考试、长期报告决策入口、债务事件账本、重排确认后应用、结构化复习历史、结构化遗忘风险和长期阶段调整闭环 | Package B/C 对应基础完成后推进第二阶段长期闭环 |
| Package E | NOT_READY / 未完成 | 生产发布 runbook 已写入 `docs/development/production-release-runbook.md`；确认前验收矩阵已写入 `docs/development/docs-100-acceptance-evidence.md` 并由 `pnpm risk:preflight` 检查 | 缺生产发布、备份、恢复演练、发布后烟测和回滚记录 | 产品能力闭环后再确认生产发布 |

## Package B 批次完成记录

完成单个批次不等于 Package B 完成。只有 Batch 0-6 全部完成、结构化读写路径和烟测证据齐全后，才能把 Package B 主行改为完成。

| 批次 | 当前状态 | 确认记录 | 验证命令 | 烟测证据 | 同步文档 | 残余风险 |
|---|---|---|---|---|---|---|
| Batch 0：`StudySession` 收口字段 | DONE / 已完成 | 用户已明确确认“确认执行 Package B Batch 0” | `pnpm db:generate`；`pnpm db:validate`；`pnpm db:migrate:diff:empty`；`DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge_batch0_verify pnpm db:migrate:deploy`；`pnpm --filter @areaforge/core test`；`pnpm --filter @areaforge/web typecheck`；`pnpm --filter @areaforge/web lint`；`pnpm test`；`pnpm check`；`pnpm docs:readiness`；`pnpm risk:preflight`；`git diff --check` | 临时库 seed 后完成真实 API 烟测：登录、subjects、active session、start、end、active 清空、dashboard、analytics、reports；结束计时返回 `producedNote=true`、`producedMistake=true`、`isLowConversion=true`、`closeoutVersion=1`；dashboard 返回 `latestCompletedSession`；analytics/reports 低转化计数为 2；Playwright 首页登录和同会话 reload 后仍展示质量评分、低转化、最小产出、下一步、规则原因、补产出要求和产出记录 | 已同步 data-model、api-surface、feature-traceability、implementation-order、structured-state-migration-design、validation-matrix、high-risk-confirmation-packets、completion record 和 task 状态 | Package B 整包仍未完成；Batch 2-6 未执行；历史 note 不解析、不回填；本次只验证本地临时库，不代表生产 deploy |
| Batch 1：`CheckIn` 日快照 | DONE / 已完成 | 用户已明确确认“确认执行 Package B Batch 1：CheckIn 日快照” | `pnpm db:generate`；`pnpm db:validate`；`DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge_batch1_verify pnpm db:migrate:deploy`；`DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge_batch1_smoke pnpm db:migrate:deploy`；`pnpm --filter @areaforge/core test`；`pnpm --filter @areaforge/web typecheck`；`pnpm --filter @areaforge/web lint`；`pnpm check`；`pnpm docs:readiness`；`pnpm risk:preflight`；`git diff --check` | 服务级 smoke 覆盖 active session 无任务开始后不创建 `CheckIn`、结束有效计时后生成当日快照、保存复盘后 `reviewSubmitted=true`、任务 `create/update/complete/defer/drop/recover/split/convert-review` 刷新相关学习日、模拟任务创建/完成刷新快照；手动设置今日 `CheckIn.effectiveMinutes=777/effectiveSessionCount=9/lowConversionCount=5` 后，dashboard 和 analytics 优先读快照；昨日无快照但有 31 分钟有效 session 时 analytics fallback 为 31，周报有效分钟为 808 | 已同步 data-model、feature-traceability、implementation-order、structured-state-migration-design、validation-matrix、check-in module、completion record 和 task 状态 | Package B 整包仍未完成；Batch 2-6 未执行；本批不做生产 migration deploy、不删除历史数据、不做历史回填；服务级 smoke 出现 `pg@9` 未来弃用警告但断言通过 |
| Batch 2：债务事件与父子任务 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺债务动作烟测 | 待同步 | 依赖 Batch 1 |
| Batch 3：`RecoveryState` | NOT_READY / 未完成 | 待确认 | 未运行 | 缺恢复模式状态烟测 | 待同步 | 依赖 Batch 1/2 |
| Batch 4：掌握证明证据 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺掌握条件/证据/复测烟测 | 待同步 | 依赖考纲证据读写 |
| Batch 5：结构化模拟考试 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺模拟考试创建/复盘烟测 | 待同步 | 影响第二阶段 |
| Batch 6：阶段计划与调整草稿 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺阶段计划/草稿确认边界烟测 | 待同步 | 影响 Package D |

## 最近确认前护栏补强

- Package A：`pnpm risk:preflight` 已扩展为扫描提前出现的附件/上传 route、附件 service、Web 层上传 IO、`public/` 上传路径、附件上传 UI、提前下载 href、UI 对 `Attachment.uri` / `upload://attachment` / `downloadApiPath` 的直链；`AttachmentDto` 现在只暴露未来鉴权 API 路径 `downloadApiPath`，不再把内部 `uri` 传给 UI；附件设计补充响应 DTO、状态码矩阵、`Content-Disposition` 文件名转义和附件内容默认不进入 AI 上下文。
- Package B：Batch 1 已在确认后完成 `CheckIn` 日快照；`buildDailyCheckInSnapshot` 继续作为唯一纯规则来源，测试覆盖显式 `isLowConversion=false` 覆盖历史 `isEffective=false` fallback；周/月 `taskCompletionRate` 默认采用逐日快照平均值，后续若要任务数加权需读任务明细或另行确认字段。
- Package C：`pnpm risk:preflight` 已覆盖客户端公开 AI env 禁区、`AI_LOG_PROMPTS=false` / `AI_ALLOW_SENSITIVE_CONTEXT=false` 默认值、首页 SSR 成本边界、任务标题脱敏决策、客户端 bundle key scan command，以及 `AiCall` / `AiUsage` / `tokenUsage` / `promptHash` 等调用历史或费用统计持久化禁区；真实 provider 第一版默认不发送原始任务标题，验证矩阵要求用 `task title may contain private content` 做标题隐私烟测。
- Package D：`pnpm risk:preflight` 已显式检查 `GET /api/reports/periodic` 只读、`GET /api/tasks/debt-reorder` 只读、`GET /api/simulation/stage` 只读，继续阻止报告、债务、阶段和模拟考试的 `apply/confirm/reject` 写路由，并把报告快照、报告决策、报告应用、任务重排应用、阶段调整应用、阶段计划应用和长期 AI 建议等持久化 token 扫描扩展到 `apps/web/lib/study/**`；长期闭环设计补充依赖-允许能力矩阵和只读回归要求。
- Package E：确认前 compose 校验已统一为 `docker compose --env-file .env.example -f docker-compose.prod.yml config`；裸跑生产 compose 若没有生产 env，预期会因 `AUTH_SESSION_SECRET is required` 等 required production env 缺失而失败；runbook 补充发布中止条件和恢复演练验收判定表，`pnpm risk:preflight` 继续阻止网页 API 触发 deploy/backup/restore/migration。

## 当前阻塞完成的功能状态

以 `docs/development/feature-traceability.md` 为准，当前仍存在：

- 第一版必须项：`知识点掌握证明基础版` 已用现有任务、计时、笔记、错题证据和请求级条件勾选闭环；`/syllabus` 可选择目标掌握等级、勾选本次证明条件，`PATCH /api/syllabus/nodes/:id` 校验证据后写入 `SyllabusNode.status/masteryLevel` 和 `AuditEvent` 摘要。显式条件记录、证据引用表和复测记录仍需 Package B Batch 4，但不再阻塞第一版基础证明；`笔记与资料上传` 已有文本笔记和 storage 纯规则，但附件上传/下载落盘与鉴权需 Package A；`鞭策文案`、`AI 复盘建议`、`AI 明日任务建议` 只有本地 fallback，真实 provider 需 Package C。
- 第二阶段增强：`全真模拟考试模式完整实现` 仍复用 `StudyTask.type = "simulation_exam"`，需 Package B Batch 5；`AI 根据长期数据生成阶段调整建议` 只有本地规则草稿，真实长期 AI 与确认应用闭环需 Package C、Package B Batch 6 和 Package D。`状态主题深度联动` 已由 core 五态规则、首页状态主题面板、恢复态任务裁剪、冲刺任务前置和页面可读性烟测覆盖，长期阶段计划主题信号后续随 Batch 6 / Package D 增强。
- Package A-E 均未达到完成证据要求；其中 Package B 已完成 Batch 0-1，Batch 2-6 仍待逐批确认和验证。

因此当前准确进度是：治理、确认包、Batch 0-1 和大量低风险基础能力已完成；docs 100% 尚未完成，下一条实现主线应从 Package B Batch 2 债务事件与父子任务开始。

## 最近验证

- `pnpm docs:readiness`：通过，说明治理结构和追踪入口存在。
- `pnpm docs:completion`：预期失败，当前阻塞为第一版的附件上传、真实 AI 建议，第二阶段的完整模拟考试、长期 AI 阶段调整，Package B Batch 2-6 批次证据，以及 Package A-E 完成证据。
- `pnpm check`：通过，说明当前工程基线可构建。
- `DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge_batch0_verify pnpm db:migrate:deploy`：通过，3 条 migration 已在本地临时库成功应用。
- `pnpm --filter @areaforge/core test`：通过，当前 46 条 core 规则测试覆盖 Batch 1 `buildDailyCheckInSnapshot` 快照字段来源、低转化 fallback 和显式 `isLowConversion=false` 覆盖优先级、状态主题五态映射、恢复态任务裁剪、冲刺任务前置、周期报告最大短板选择、短板来源/严重度/选择依据、周期策略、任务债务重排、恢复候选、统计风险、掌握证明条件与证据门禁、作战地图和模拟/阶段规则。
- `pnpm --filter @areaforge/ai test`：通过，当前 10 条 AI 测试覆盖本地 fallback、mock provider 成功/失败、非法输出 fallback、敏感字段拦截和安全最小化上下文。
- `pnpm --filter @areaforge/storage test`：通过，当前 11 条 storage 测试覆盖 MIME/magic bytes、大小限制、随机 storedName/URI、路径穿越、公有目录拒绝和私有下载响应头。
- `pnpm test`：通过，说明当前所有 workspace 包内测试通过。
- `pnpm --filter @areaforge/web typecheck`：通过。
- `pnpm --filter @areaforge/web lint`：通过。
- `pnpm risk:preflight`：通过，说明 Package A/B/C/D/E 的确认前边界仍被拦住；确认前验收矩阵已被检查；Package A 额外覆盖上传/下载实现未提前出现、`public/` 下无上传目录、附件 DTO 不泄露内部 `uri`、UI 不直链 `attachment.uri` / `downloadApiPath` 且没有提前上传控件；Package B 额外覆盖 Batch 0-6 确认包、批次状态、批次完成记录和专项验证门禁；Batch 1 标 DONE 后要求 `model CheckIn` 存在并允许 CheckIn 读写路径，Batch 2-6 仍继续禁止对应 schema/migration token 越界；Package C 额外覆盖真实 provider 未接线、Web 侧不读取 AI env/key、AI 上下文保持聚合最小化、首页只允许本地 fallback 成本边界、AI route 保持鉴权 POST-only、schema 和 AI 服务不持久化完整 prompt/raw response；Package D 额外覆盖债务重排只读 API、阶段调整只读草稿 API、阶段调整 confirm-only DTO/UI、报告 confirm-only DTO、报告/任务 UI 标签、报告/决策/应用/长期 AI 持久化禁区和文档边界；Package E 额外覆盖发布、备份、恢复、烟测、回滚命令模板和网页运维 route 禁区。
- `docker compose config`：通过；`docker compose --env-file .env.example -f docker-compose.prod.yml config`：通过。确认前只用于本地结构校验，不执行生产部署。
- `git diff --check`：通过。

## 更新规则

- 每完成一个高风险包，必须把对应行改为“完成”，并在“当前证据”中写入验证命令、烟测证据、文档同步结果和残余风险；`pnpm docs:completion` 会检查这些关键词。
- 每完成一个 Package B 批次，也必须追加批次证据；`pnpm docs:completion` 会要求 Batch 0-6 全部为 `DONE / 已完成`；在 Batch 0-6 全部完成前，不得把 Package B 主状态改成完成。
- 若只完成低风险基础版，不得把高风险包标为完成。
- 任何“未验证”“待确认”“未完成”的包都会阻止 `pnpm docs:completion` 通过。
