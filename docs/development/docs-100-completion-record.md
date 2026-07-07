# docs 100% 完成记录

## 目标

本文件记录 AreaForge 推进到 docs 100% 的当前证据状态。它不是目标清单，而是完成台账：只有实际代码、验证命令、烟测结果、部署状态和文档同步都存在时，才能把对应项标为完成。

`pnpm docs:completion` 会读取本文件和 `docs/development/feature-traceability.md`。当前仍有未完成项，因此该命令预期失败。

## 高风险包状态

| 包 | 当前状态 | 当前证据 | 缺口 | 下一步 |
|---|---|---|---|---|
| Package A | NOT_READY / 未完成 | `Attachment` schema 和 `packages/storage` 纯规则已有，已覆盖 MIME、magic bytes、随机存储名、安全 URI、相对上传目录拒绝和公开目录拒绝钩子；确认设计见 `docs/development/attachment-upload-access-design.md` | 缺上传/下载 API、UI、文件写入补偿、鉴权烟测和对账证据 | 等用户明确确认后实现附件上传与鉴权访问 |
| Package B | NOT_READY / 未完成 | 结构化 migration 设计和 Batch 0-6 已写入 `docs/development/structured-state-migration-design.md` | 缺 Prisma additive migration、临时库 deploy、结构化读写路径和页面/API 烟测 | 等用户明确确认后从 Batch 0 开始推进 |
| Package C | NOT_READY / 未完成 | `packages/ai` 本地 fallback、provider 抽象、schema 校验和敏感字段拦截已有；拦截已覆盖常见 key 命名变体；Web AI 服务当前不读取 AI provider env、不传真实 provider，只构造聚合上下文并返回本地规则 fallback；`pnpm risk:preflight` 已覆盖 Web provider 禁用边界、上下文最小化和首页本地 fallback 成本边界；确认设计见 `docs/development/ai-provider-integration-design.md` | 缺真实 provider、费用/隐私/限流验证、客户端密钥扫描和真实失败回退证据 | 等用户明确确认后接入真实 AI provider |
| Package D | NOT_READY / 未完成 | 模拟考试、报告、阶段调整已有基础版；`packages/core` 已提供任务债务重排建议、周期报告最大短板选择、短板来源/严重度/选择依据、周期报告策略、统计风险摘要、恢复候选选择和作战地图聚合摘要纯规则；只读报告服务、统计服务、首页恢复候选、首页债务重排建议、`GET /api/tasks/debt-reorder`、`/reports` 短板追溯信息、周期策略和本地复盘草稿 `canAutoApply=false` / `requiresUserConfirmation=true`、首页债务重排建议只读确认标签和 `/syllabus` 分科作战地图摘要、状态分布、推荐筛选、行动类型筛选及优先节点展示已消费部分 core 规则；`pnpm risk:preflight` 已覆盖债务重排只读 API、阶段调整只读草稿 API、阶段调整 confirm-only DTO/UI、报告 confirm-only DTO、报告/任务 UI 标签和文档边界；考纲服务已用已有任务、计时、笔记、错题更新时间派生证据新鲜度；`/notes` 已支持科目、节点、掌握状态和复习提醒筛选；今日任务表单已支持写入已有 `StudyTask.type`；确认范围见 `docs/development/high-risk-confirmation-packets.md` | 缺完整模拟考试、长期报告决策入口、债务事件账本、重排确认后应用、结构化复习历史、结构化遗忘风险和长期阶段调整闭环 | Package B/C 对应基础完成后推进第二阶段长期闭环 |
| Package E | NOT_READY / 未完成 | 生产发布 runbook 已写入 `docs/development/production-release-runbook.md` | 缺生产发布、备份、恢复演练、发布后烟测和回滚记录 | 产品能力闭环后再确认生产发布 |

## Package B 批次完成记录

完成单个批次不等于 Package B 完成。只有 Batch 0-6 全部完成、结构化读写路径和烟测证据齐全后，才能把 Package B 主行改为完成。

| 批次 | 当前状态 | 确认记录 | 验证命令 | 烟测证据 | 同步文档 | 残余风险 |
|---|---|---|---|---|---|---|
| Batch 0：`StudySession` 收口字段 | NOT_READY / 未完成 | 待用户明确确认 | 未运行 | 缺开始/结束计时、dashboard、analytics、reports 烟测 | 待同步 data-model、api-surface、task 状态 | migration 未执行；历史 note 仍仅文本 |
| Batch 1：`CheckIn` 日快照 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺打卡快照烟测 | 待同步 | 依赖 Batch 0 |
| Batch 2：债务事件与父子任务 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺债务动作烟测 | 待同步 | 依赖 Batch 1 |
| Batch 3：`RecoveryState` | NOT_READY / 未完成 | 待确认 | 未运行 | 缺恢复模式状态烟测 | 待同步 | 依赖 Batch 1/2 |
| Batch 4：掌握证明证据 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺掌握条件/证据/复测烟测 | 待同步 | 依赖考纲证据读写 |
| Batch 5：结构化模拟考试 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺模拟考试创建/复盘烟测 | 待同步 | 影响第二阶段 |
| Batch 6：阶段计划与调整草稿 | NOT_READY / 未完成 | 待确认 | 未运行 | 缺阶段计划/草稿确认边界烟测 | 待同步 | 影响 Package D |

## 当前阻塞完成的功能状态

以 `docs/development/feature-traceability.md` 为准，当前仍存在：

- 第一版必须项中的“基础版 / 待确认”能力。
- 第二阶段增强中的“基础版 / 待确认 / 未实现”能力。
- Package A-E 的真实完成证据缺失。

## 最近验证

- `pnpm docs:readiness`：通过，说明治理结构和追踪入口存在。
- `pnpm docs:completion`：预期失败，说明当前还没有达到 docs 100%。
- `pnpm check`：通过，说明当前工程基线可构建。
- `pnpm --filter @areaforge/core test`：通过，当前 39 条 core 规则测试覆盖周期报告最大短板选择、短板来源/严重度/选择依据、周期策略、任务债务重排、恢复候选、统计风险、作战地图和模拟/阶段规则。
- `pnpm --filter @areaforge/ai test`：通过，当前 10 条 AI 测试覆盖本地 fallback、mock provider 成功/失败、非法输出 fallback、敏感字段拦截和安全最小化上下文。
- `pnpm --filter @areaforge/storage test`：通过，当前 11 条 storage 测试覆盖 MIME/magic bytes、大小限制、随机 storedName/URI、路径穿越、公有目录拒绝和私有下载响应头。
- `pnpm test`：通过，说明当前所有 workspace 包内测试通过。
- `pnpm --filter @areaforge/web typecheck`：通过。
- `pnpm --filter @areaforge/web lint`：通过。
- `pnpm risk:preflight`：通过，说明 Package A/B/C/D/E 的确认前边界仍被拦住；Package B 额外覆盖 Batch 0 确认包、批次状态、批次完成记录和专项验证门禁；Package C 额外覆盖真实 provider 未接线、Web 侧不读取 AI env/key、AI 上下文保持聚合最小化、首页只允许本地 fallback 成本边界；Package D 额外覆盖债务重排只读 API、阶段调整只读草稿 API、阶段调整 confirm-only DTO/UI、报告 confirm-only DTO、报告/任务 UI 标签和文档边界。
- `git diff --check`：通过。

## 更新规则

- 每完成一个高风险包，必须把对应行改为“完成”，并写入验证命令、烟测证据、文档同步结果和残余风险。
- 每完成一个 Package B 批次，也必须追加批次证据；但在 Batch 0-6 全部完成前，不得把 Package B 主状态改成完成。
- 若只完成低风险基础版，不得把高风险包标为完成。
- 任何“未验证”“待确认”“未完成”的包都会阻止 `pnpm docs:completion` 通过。
