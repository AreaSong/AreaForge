# 开发顺序

## 当前状态

已经完成：

- monorepo 基础。
- Next.js Web 应用。
- Prisma schema。
- Docker Compose 基础。
- 首页作战台雏形。
- 专注计时器前端状态。
- 核心规则包基础。
- 文档拆分。
- 单管理员登录、数据库会话、`HttpOnly` Cookie、登录限速。
- 数据库 seed：初始化管理员和 7 个基础科目。
- 生产/本地 Compose 配置校验。
- 首页作战台读取真实数据库数据。
- 每日任务 CRUD。
- 学习计时开始、暂停、继续、结束持久化。
- 每晚复盘保存。
- 考纲树与笔记基础 API/UI 已启动，受限 Markdown 考纲导入已实现；考纲节点已读取已有任务、计时、笔记和错题更新时间派生证据新鲜度，结束计时会同步累加关联考纲节点实际时长；笔记库已支持科目、节点、掌握状态和复习提醒筛选；Package A 已完成 noteId 绑定附件上传、私有落盘和鉴权下载。
- 任务债务、打卡检查、反假学习和恢复模式已有结构化闭环：本地规则、首页展示、恢复模式任务聚焦、补做/拆小/改复习任务轻量流转、只读债务重排建议和计时收口反假学习判断；`packages/core/src/study-integrity.ts` 已沉淀结构化收口、近窗打卡历史、轻量债务动作和债务重排建议规则；Package B Batch 0 已为 `StudySession` 追加结构化收口字段；Package B Batch 1 已新增 `CheckIn` 日快照并接入新写路径；Package B Batch 2 已新增 `TaskDebtEvent` 和 `StudyTask.parentTaskId`；Package B Batch 3 已新增 `RecoveryState`、手动恢复、规则触发记录和完成/取消恢复状态。
- 错题与掌握证明已完成显式记录闭环，考纲节点可看到任务、计时、笔记、错题证据计数和最近证据时间；Package B Batch 4 已新增 `MasteryConditionRecord`、`MasteryEvidence` 和 `MasteryRetest`，`/syllabus` 可保存条件、引用证据和写入复测，缺显式证据时保留 `_count` fallback；`packages/core/src/mastery-proof.ts` 已沉淀掌握等级、缺失条件、缺失证据、证据过旧风险和下一步动作的纯规则；`packages/core/src/syllabus-map.ts` 已沉淀作战地图格子状态、标记、原因、下一步动作和聚合摘要纯规则。
- 动机封存、情绪标签、阶段称号和动机唤醒基础版已完成，且默认不进入 AI 上下文。
- 基础统计与作战地图完善已完成低风险闭环：统计页、只读统计 API、近 7 天派生指标、`summarizeAnalyticsRisks` 统计风险规则、风险提醒、作战地图状态筛选和行动类型筛选。
- 周审判与月复盘报告已完成报告闭环：周期报告 API、报告页、`choosePeriodicWeakness` 最大短板选择规则、`summarizePeriodicReportStrategy` 周期策略规则、本地规则复盘草稿、`createPeriodicNextCycleDraft` 下周期草稿和 `createPeriodicReportDecisionSnapshot` 回放快照；Package D Batch D1 已新增报告确认/驳回、冻结快照、确认草稿、审计和只读回放；`decisionPreview` 与已保存决策均固定 `canAutoApply=false` / `requiresUserConfirmation=true`，仍不应用阶段计划或任务重排。
- 全真模拟考试已完成结构化主路径：Package B Batch 5 已新增 `SimulationExam`、`SimulationSubjectResult`、结构化模拟 API 和 `/simulation` 主写入；旧 `StudyTask.type = "simulation_exam"` 记录只读兼容；Package B Batch 6 已新增 `StagePlan`、`StageAdjustmentDraft`、阶段计划 API 和持久草稿确认边界；`packages/core/src/simulation-result.ts` 已沉淀模拟考试结果复盘纯规则，并接入结构化结果保存；`packages/core/src/stage-adjustment.ts` 已沉淀阶段调整草稿纯规则且明确不能自动应用。Package D Batch D1 报告决策入口、D2 债务重排确认流、D3 长期 AI 阶段草稿、D4 长期风险/主题闭环和 D5 收口已完成。
- AI 建议已完成 Package C 第一版：`packages/ai` 提供结构化 schema、本地规则 fallback、OpenAI-compatible JSON provider、mock/外呼错误测试和敏感上下文拦截，Web 提供 AI 建议 API 与首页本地草稿展示；Package D Batch D3 已在 `stage_adjustment` schema 下完成长期阶段 AI 草稿显式触发，D3 范围外长期 AI 应用仍需单独确认。
- Package E 已完成生产配置预检、备份恢复演练、本机单机生产发布、回滚收口和远端 `v0.1.5` GitHub Release 签名更新；线上 `https://forge.areasong.top/api/health` 返回 `0.1.5`，自动更新链路默认 `AREAFORGE_AUTO_APPLY=none`，Web 版本中心只提交受控更新请求，由服务器侧 update-agent/updater 执行签名校验、备份、migration、切换和回滚。
- 长期运营治理已补齐轻量入口：`areaforge-operating-loop` 负责跨 skill 编排，`operational-readiness.md` 聚合只读运营证据，`residual-risk-ledger.md` 维护影响发布/运维判断的稳定残余风险 ID，release workflow 在 build/push 前运行 validate job 且 stable 签名 fail closed。

## 下一步主线

1. `tasks/done/0004-mvp-syllabus-notes-upload.md`：附件上传与鉴权访问已由 Package A 完成。
2. `tasks/done/0005-mvp-ai-discipline.md`：真实 AI Provider 第一版已由 Package C 完成。
3. `tasks/backlog/0008-task-debt-checkin-recovery.md`：`CheckIn` 日快照、债务事件账本、`RecoveryState`、显式掌握证明记录、结构化模拟考试和阶段计划/草稿已由 Package B Batch 1-6 完成；Package D D1-D5 已完成长期闭环主线，未来自动应用或批量调整另行确认。
4. `tasks/backlog/0013-simulation-stage-adjustment.md`：结构化全真模拟考试主路径、阶段计划/草稿持久化、报告决策入口、债务重排所选项应用记录、长期 AI 草稿显式触发、长期风险/主题闭环和 Package D 收口已完成。
5. `tasks/backlog/0014-deployment-backup-release.md`：生产部署、备份恢复、GitHub Release 签名更新和版本中心受控请求流已完成；后续功能更新按 release runbook 逐次发布。
6. 长期运营优化：当前不引入 AreaMatrix/AreaFlow 的重型任务队列或 command API；后续只围绕 ops readiness、生产 extra smoke、残余风险关闭、完成证据纪律、运行时写边界和真实体验优化逐项推进。

实现前确认设计：

- 附件上传与鉴权访问：`docs/development/attachment-upload-access-design.md`。
- 结构化学习状态 migration：`docs/development/structured-state-migration-design.md`。
- 真实 AI provider 接入：`docs/development/ai-provider-integration-design.md`。
- 第二阶段长期闭环：`docs/development/second-stage-long-term-loop-design.md`。
- 生产发布、备份与恢复：`docs/development/production-release-runbook.md`。
- 高风险确认总表：`docs/development/high-risk-confirmation-packets.md`。
- docs 100% 验收证据：`docs/development/docs-100-acceptance-evidence.md`。
- 长期运营 readiness：`docs/development/operational-readiness.md`。
- 残余风险台账：`docs/development/residual-risk-ledger.md`。

## 高风险确认包状态

这些包命中仓库高风险边界。Package A、Package B、Package C、Package D 和 Package E 已完成；后续若新增 migration、上传/删除、AI 外呼字段、部署、备份恢复、自动更新策略升级或服务器运维入口，仍必须先确认对应影响、风险、验证和回滚。

| 确认包 | 影响 | 主要风险 | 验证 | 回滚 |
|---|---|---|---|---|
| 结构化业务 migration | 新增 `CheckIn`、任务债务事件、结构化收口、掌握证明、模拟考试和阶段计划等表/字段 | migration 失败、旧数据映射不完整、派生统计口径变化 | `pnpm db:validate`、migration deploy dry run、相关 API/页面烟测、`pnpm check` | additive migration 优先；不删除旧字段；失败时回滚代码并保留备份，已部署环境按备份恢复 |
| 附件上传与鉴权访问 | 服务器开始写入 `UPLOAD_DIR`，数据库和文件目录共同成为持久化状态 | MIME 伪造、路径穿越、软链接逃逸、孤儿文件、隐私文件泄露 | 未登录 401、允许类型成功、超大/伪造/路径攻击失败、响应头检查、metadata/文件对账、`pnpm check` | 先关闭上传入口；保留已有文件和 metadata；清理孤儿文件前先生成只读审计清单并再次确认 |
| 真实 AI provider | `AI_ENABLED=true` 时向外部 Sub2API / OpenAI 兼容接口发送最小化上下文 | API Key 泄露、费用失控、敏感正文进入 prompt、输出非法、外呼失败影响主流程 | mock/真实失败回退、schema 校验、日志脱敏扫描、客户端 bundle 密钥扫描、AI API 烟测、`pnpm check` | 关闭 `AI_ENABLED` 回到本地规则；保留 provider 代码但不外呼；不自动删除用户原始记录 |
| 部署、备份与恢复 | 引入生产发布、migration deploy、数据库/上传目录备份和恢复演练 | 发布中断、migration 后不可逆、备份缺失、附件 metadata 与文件不一致 | Compose config、生产变量检查、发布前备份点、临时库恢复、临时上传目录对账、登录和首页烟测 | 回滚到上一镜像 tag；使用发布前数据库和上传目录备份恢复；保留失败日志和版本记录 |

## docs 100% 实施路线

以下路线以 `docs/product/**`、`docs/modules/**`、`docs/architecture/**`、`docs/security/**` 和 `docs/deployment/**` 为完整范围，不只覆盖 v0.1 或单个 MVP。

### 0. 当前基线收口

- 保持当前低风险基线可验证：登录、任务、计时、复盘、考纲、笔记、错题、动机、统计、报告、模拟基础入口、AI fallback、storage 纯规则，以及 core 中的收口、打卡、债务、掌握证明、作战地图、模拟结果和阶段调整规则。
- 每次进入高风险阶段前先跑与改动范围匹配的验证，至少包括相关包测试、`pnpm check` 和 `git diff --check`。
- 文档同步到 `docs/**`、`tasks/**`、`workflow/**`，避免后续按过时状态判断进度。
- 用 `docs/development/feature-traceability.md` 逐项追踪第一版、第二阶段和暂缓项，不能只用单个 MVP 的完成度代替 docs 100%。

### 1. 结构化数据模型批次

需要明确 migration 方案、验证和回滚后推进，按 additive migration（只新增字段/表，暂不删除旧字段）逐批确认：

1. Batch 0：`StudySession` 结构化收口字段：理解程度、最小产出、下一步动作、反假学习原因、是否产生笔记/错题。已完成。
2. Batch 1：`CheckIn` 每日快照：学习日、最低动作、总/有效时长、任务完成率、复盘完成、连续性辅助字段。已完成。
3. Batch 2：任务债务事件账本和父子任务关系：补做、延期、放弃、拆小、改复习和完成动作。已完成；重排确认、驳回和所选项应用记录已由 Package D Batch D2 完成。
4. Batch 3：`RecoveryState` 恢复状态：规则触发、手动触发、退出条件和恢复记录。已完成。
5. Batch 4：掌握证明：掌握条件、证据引用、复测记录。已完成。
6. Batch 5：结构化 `SimulationExam`：考试、科目结果、分数、空题、失分类型、心态和总结。已完成。
7. Batch 6：阶段计划与阶段调整草稿：阶段目标、调整建议、用户确认后的阶段计划更新和审计记录。已完成，且不包含任务重排、批量改任务、真实 AI 或生产 migration deploy。

Package A 附件、Package B Batch 0-6、Package C 真实 AI 第一版、Package D 长期闭环和 Package E 生产发布/远端签名更新已全部完成；后续 `docs 100%` 维护重点是每次功能变更同步源事实、验证记录和 release 证据。

### 2. 第一版功能补全

- 打卡与连续性已从派生统计升级为 `CheckIn` 结构化快照；恢复状态已由 `RecoveryState` 承接，后续继续补长期闭环。
- 任务债务已从轻量流转升级为事件账本；可审计重排确认、驳回和所选项应用记录已由 Package D Batch D2 完成。
- 恢复模式已从规则裁剪升级为持久化状态、手动触发和退出条件；后续只随长期阶段计划继续增强。
- 反假学习从文本化 note 升级为结构化收口和低转化统计。
- 掌握证明从证据计数升级为条件、证据和复测闭环。
- 笔记资料库已补齐附件上传、鉴权访问和复习提醒。
- 首页、统计、报告、作战地图统一读取结构化数据，而不是重复散落推导。

### 3. 附件与资料库闭环

Package A 已完成：

- `POST /api/notes/:noteId/attachments`：单文件上传，第一版只关联笔记。
- `GET /api/attachments/:id`：鉴权下载或受控预览。
- 服务端写入 `UPLOAD_DIR`，随机 storedName，数据库只保存 metadata、hash、URI。
- 校验大小、允许 MIME、magic bytes、路径穿越、真实路径和软链接逃逸。
- 数据库写入失败时补偿孤儿文件；文件写入失败时不创建 metadata。
- 下载响应包含 `X-Content-Type-Options: nosniff` 和私有缓存策略。

### 4. AI 闭环

Package C 真实 AI Provider 第一版已完成：

- 已接入 Sub2API / OpenAI 兼容 provider，只在 `AI_ENABLED=true` 且三条鉴权 AI POST route 显式触发时外呼。
- 请求前做数据最小化，默认不发送动机档案、完整情绪记录和完整复盘正文。
- 输出必须结构化校验，失败回退本地规则。
- 超时、重试、轻量限流、错误映射和日志脱敏已落地。
- AI 第一版只返回鞭策、复盘建议和明日任务建议，不直接覆盖用户记录。
- 长期阶段 AI 草稿显式外呼已由 Package D Batch D3 单独确认并完成；若保存 AI 建议历史、费用账本、发送更大字段清单或自动应用阶段计划，必须再次确认模型、隐私边界和 migration。
- 若保存 AI 建议历史或费用账本，必须单独确认模型、数据字段和 migration。

### 5. 第二阶段长期能力

- 完整全真模拟考试和 2026 年 12 月同步自测专题流程。
- 周审判、月复盘从只读派生报告升级为阶段决策入口。
- 任务债务自动重排建议、知识点遗忘风险、笔记复习提醒。
- 作战地图高级筛选和风险可视化。
- 状态主题、阶段称号、动机唤醒和长期 AI 阶段调整联动。
- 所有“建议”都需要用户确认后才应用，不自动改写计划。

### 6. 部署、备份、恢复和发布闭环

Package E 已按高风险确认推进并完成：

- 生产 `docker-compose.prod.yml`、Next.js standalone 镜像、PostgreSQL 16、Nginx HTTPS 反代已落地到 `https://forge.areasong.top/`。
- 生产 PostgreSQL 不暴露公网端口，Web 在当前服务器绑定 `127.0.0.1:3020` 供 Nginx 反代。
- 发布前备份数据库、上传目录、生产 `.env` 和当前版本 tag/digest。
- 执行 Prisma migration deploy 前有备份点和回滚说明，远端 `v0.1.5` 使用一次性 migration image，结果为 `No pending migrations to apply`。
- GitHub Release workflow 先执行 validate job，再生成 manifest、compose、hash 和 cosign bundle；stable release 缺签名密钥时 fail closed；服务器 updater 校验签名和 digest 后更新。
- 每日 `pg_dump`、上传目录同周期备份和至少 14 天保留仍按部署文档执行。
- 已在本机生产目标做临时库/上传目录恢复演练与 E4 回滚演练；远端迁移、域名、Nginx 或备份策略变化仍需单独记录。

### 7. 全量验收

完成 docs 100% 需要逐项证明：

- `docs/product/feature-scope.md` 第一版必须项全部有真实代码、页面/API 或明确暂缓依据。
- 第二阶段增强项有对应模型、页面/API、规则和验证，暂缓项未被误算为完成。
- 所有写 API 服务端鉴权，页面和组件不直接访问 Prisma。
- `packages/core` 保持平台无关，`packages/ai` 不直接写用户数据，`packages/storage` 不把文件放入 `public/`。
- `pnpm check`、相关包测试、Prisma validate、Compose config、关键 API 烟测和主要页面验证通过。
- 上传、AI、migration、部署、备份恢复均有影响、风险、验证和回滚记录。

## 前置主闭环验收

达到以下条件才算完成 v0.1 前置主闭环；这不等于 `docs/product/feature-scope.md` 中的完整第一版：

- 登录后才能访问作战台。
- 可以创建任务。
- 可以开始、暂停、结束一次计时。
- 计时记录保存到数据库。
- 今日统计来自数据库。
- 可以提交晚间复盘。
- 可以手动维护考纲节点。
- 可以创建笔记并关联科目、任务或考纲节点。
- `pnpm check` 通过。

## 完整第一版验收

完整第一版已完成项：

- 打卡与连续性。
- 任务债务。
- 恢复模式。
- 反假学习检查。
- 知识点掌握证明。
- 笔记与资料上传。
- 情绪与状态记录。
- 考研作战地图概览。
- 动机封存。
- 阶段称号基础版。
- 鞭策文案。
- AI 复盘建议。
- AI 明日任务建议。
- 基础统计。
