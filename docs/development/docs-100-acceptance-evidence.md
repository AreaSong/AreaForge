# docs 100% 验收证据矩阵

## 目标

本文件定义“AreaForge docs 100% 完成”需要哪些证据。它用于最终验收，不把当前基础版误判为完整完成。

完成状态只能来自当前代码、运行验证、测试结果、部署状态和文档同步结果，不能只凭计划或意图判断。

## 全局验收门

| 验收项 | 完成证据 |
|---|---|
| 源事实一致 | `docs/README.md`、`workflow/README.md`、`tasks/**` 与 `docs/product/**`、`docs/architecture/**` 无冲突 |
| 工程检查 | `pnpm check` 通过 |
| 核心规则 | `pnpm --filter @areaforge/core test` 通过 |
| AI 规则 | `pnpm --filter @areaforge/ai test` 通过 |
| 上传规则 | `pnpm --filter @areaforge/storage test` 通过 |
| 数据模型 | `pnpm db:validate` 通过；涉及 migration 时临时库 deploy 通过 |
| Compose | `docker compose config` 和 `docker compose --env-file .env.example -f docker-compose.prod.yml config` 通过；生产执行时必须使用真实生产 env |
| 页面烟测 | 首页、`/syllabus`、`/notes`、`/mistakes`、`/analytics`、`/reports`、`/simulation` 可打开 |
| 安全边界 | 未登录写 API 返回 `401`，客户端 bundle 不含密钥 |
| 文档同步 | 新 API、新模型、上传、AI、部署变化均同步对应 docs/tasks/workflow |
| 治理结构 | `pnpm docs:readiness` 通过 |
| 最终完成门禁 | `pnpm docs:completion` 通过；高风险完成记录和功能追踪状态均证明完成 |

## 第一版必须项验收

| 功能 | 当前目标状态 | 必要证据 |
|---|---|---|
| 单管理员登录 | 私有 Web 入口受保护 | 登录/登出/API `me` 烟测；Cookie `HttpOnly`；登录限速验证 |
| 今日作战台 | 展示真实数据库聚合 | `GET /api/dashboard/today` 返回真实任务、计时、复盘、风险、阶段和恢复信号 |
| 双节点倒计时 | 2026 自测和 2027 终局目标可见 | 首页显示倒计时；阶段规则使用对应日期 |
| 每日任务 | CRUD 和状态流转可用 | `/api/tasks`、complete/defer/drop/recover/split/convert-review 烟测 |
| 任务债务基础版 | 欠账可见且可处理 | 逾期任务进入债务；补做、延期、放弃、拆小、改复习有结构化或事件证据 |
| 学习计时 | start/pause/resume/end 持久化 | active session 恢复；结束后写入 session 和任务 actualMinutes |
| 专注计时模式 | 计时中 UI 聚焦 | 浏览器页面烟测或截图 |
| 打卡 | 不是打开应用，而是有效学习动作 | `CheckIn` 快照或兼容派生；连续打卡、断签、低效天数可验证 |
| 每晚复盘 | 今日复盘保存 | `GET/POST /api/reviews/today` 烟测；首页刷新后仍显示 |
| 考纲进度树 | 科目树和节点维护可用 | `/api/syllabus`、节点 CRUD、Markdown 导入烟测 |
| 知识点掌握状态 | 状态和掌握等级可见 | 考纲节点显示 status、masteryLevel 和下一步动作 |
| 掌握证明基础版 | 掌握不能只靠打勾 | 无证据无法标记掌握；证据、条件、复测记录可追溯 |
| 笔记与资料上传 | 文本笔记和附件闭环 | 笔记 CRUD；附件上传/下载鉴权；metadata/hash/URI 与文件一致 |
| 情绪与状态记录基础版 | 情绪标签参与复盘和建议 | 复盘 mood 保存；AI 默认只用标签，不发完整正文 |
| 恢复模式 | 连续失守后计时器聚焦最小任务，完整任务列表仍可查看 | 首页恢复状态、恢复任务聚焦、手动恢复状态、规则触发状态、完成/取消恢复可见 |
| 反假学习检查基础版 | 计时结束必须收口 | 结构化收口字段；低转化原因和补产出要求可查 |
| 作战地图概览版 | 树形 + 网格概览 | `/syllabus` 地图状态、标记、筛选和风险理由可见 |
| 动机封存 | 私密保存并按节点唤醒 | `/motivation` 保存；首页只显示唤醒信号，不展示正文 |
| 阶段称号基础版 | 根据真实数据计算 | 首页阶段称号、阶段分和压强来自规则 |
| 鞭策文案 | 本地或 AI 结构化建议 | AI disabled fallback；真实 AI 启用时 schema 校验 |
| AI 复盘建议 | 只生成建议，不覆盖复盘 | `/api/ai/daily-review` 返回结构化建议；失败 fallback |
| AI 明日任务建议 | 只生成草稿，不自动创建任务 | `/api/ai/tomorrow-plan` 返回结构化草稿；用户确认前不写任务 |
| 基础统计 | 数据指向行动 | `/api/analytics/summary`、`/analytics` 页面展示趋势、风险和下一步动作 |
| 数据持久化 | PostgreSQL 是主状态源 | 刷新、重启后记录不丢；Prisma schema 与 migration 可验证 |

## 第二阶段增强验收

| 功能 | 必要证据 |
|---|---|
| 完整全真模拟考试 | `SimulationExam` 和科目结果模型/API/UI；目标分、实际分、用时、空题、失分原因、心态、总结结构化保存 |
| 2026 同步自测专题 | 第一次同步自测标记、阶段日记、考后重校准草稿 |
| 周审判报告 | 周维度时长、有效时长、科目占比、完成率、欠账、低转化、错题复盘、最大短板和下周问题 |
| 月复盘报告 | 阶段目标有效性、长期落后科目、高投入低产出方式、是否调整阶段计划 |
| 任务债务自动重排建议 | 建议保留、延期、拆分、放弃或改复习，并说明原因；用户确认前不应用 |
| 知识点遗忘风险提醒 | 基于复习时间、错题集中、掌握等级或复测状态生成 |
| 笔记复习提醒 | 可按科目、节点、掌握状态和到期时间筛选 |
| 作战地图高级可视化 | 可按风险和行动类型筛选，不只是状态网格 |
| 状态主题深度联动 | 正常、锻造、警报、恢复、冲刺主题由真实信号驱动且不影响可读性 |
| 动机唤醒机制 | 连续失守、重大复盘、自测前后、危险期触发；不进入 AI 默认上下文 |
| AI 长期阶段调整建议 | 最小化长期数据字段；结构化输出；用户确认后才应用 |

## 暂缓项验收

暂缓项不能被误算为完成，也不能偷偷进入当前版本：

- AI 自动生成完整学习计划。
- AI 自动解析复杂 PDF 大纲。
- 小程序。
- 原生手机 App。
- 多用户系统。
- 排名系统。
- 网页内一键更新。
- 复杂权限系统。

若未来要重启任一暂缓项，必须先更新 `docs/product/feature-scope.md` 和对应任务。

## 高风险完成证据

| 高风险项 | 完成证据 |
|---|---|
| 附件上传与下载 | `Package A` 已确认；API/UI 实现；上传/下载/路径/软链接/补偿/对账烟测通过 |
| 结构化 migration | `Package B` 已确认；临时库 deploy；旧数据兼容；主要页面/API 烟测通过 |
| 真实 AI provider | `Package C` 已确认；AI disabled、配置缺失、mock 成功、失败 fallback、客户端密钥扫描通过 |
| 第二阶段长期闭环 | `Package D` 已确认；建议不自动应用；报告、地图、债务、遗忘风险验收通过 |
| 生产发布 | `Package E` 已确认；备份、恢复演练、发布后烟测和回滚记录存在 |

## 高风险确认前验收矩阵

本矩阵只用于确认前准备，不能替代完成证据。任何一项从“准备”进入“实现”前，都必须先获得对应确认包的明确确认。

| 包 | 确认前可安全推进 | 确认前禁止越界 | 确认后完成证据 |
|---|---|---|---|
| Package A | 上传/下载 API 烟测清单；对账清单格式；补偿失败用例；storage 纯规则测试复核 | 新增上传/下载 route；写入 `UPLOAD_DIR`；新增附件 UI；清理孤儿文件 | 未登录 401；允许类型成功；超大、伪造 MIME、路径穿越、软链接逃逸失败；metadata hash 与文件 hash 一致 |
| Package B | 分批确认包；migration 字段清单；临时库验证步骤；旧数据 fallback 口径 | 未确认批次的 schema/migration；批量删除、压缩历史或不可靠解析 | 每批临时库 deploy；核心/API/UI 烟测；completion record 只更新对应批次；Package B 主状态等 Batch 0-6 全部完成后再改 |
| Package C | 可发送/禁止字段清单；费用保护默认值；客户端密钥扫描步骤；mock/fallback 测试 | 真实 provider 外呼；Web 读取 `AI_API_KEY`；保存完整 prompt/响应；长期阶段调整外呼 | `AI_ENABLED=false` fallback；配置缺失 fallback；mock 成功；失败/非法输出 fallback；客户端 bundle 搜不到密钥 |
| Package D | 只读规则、只读 UI 标签、依赖矩阵、confirm-only DTO 检查；可先拆分 Batch D1-D5 的确认句、验证矩阵和烟测脚本草案 | 重排应用写 API；阶段计划应用；报告快照写入；长期 AI 外呼；自动覆盖任务或阶段计划 | Batch D1 报告决策、Batch D2 债务重排确认流、Batch D3 长期阶段 AI 草稿、Batch D4 长期风险/主题闭环、Batch D5 收口证据均完成；建议用户确认前不应用；确认/驳回/重复提交/部分失败可追溯；报告、地图、债务、遗忘风险页面/API 烟测通过 |
| Package E | compose config；变量清单；发布/回滚 checklist；临时库恢复步骤文档；可先拆分 Batch E1-E4 的确认句、验证矩阵和发布记录模板 | 生产部署；生产 migration deploy；真实备份恢复；服务器命令；发布后真实烟测 | Batch E1 预检、Batch E2 备份/恢复演练、Batch E3 生产发布、Batch E4 回滚/收口证据均完成；发布前备份；临时库恢复演练；生产发布记录；migration runner 选择；`release:evidence:validate` 通过；附件对账 `report_only`；发布后烟测；失败回滚记录 |

最终完成时还必须维护并更新 `docs/development/docs-100-completion-record.md`，逐项记录 Package A-E 的完成状态、验证命令、烟测证据、文档同步结果和残余风险。该记录是当前证据，不是目标清单。

## 最终完成判定

只有当本文件所有非暂缓项均有当前证据，`docs/development/feature-traceability.md` 不再存在“基础版 / 待确认 / 未实现”状态，Package B Batch 0-6 批次行全部为 `DONE / 已完成`，并且 `pnpm docs:completion` 通过时，才可以宣称 AreaForge docs 100% 完成。
