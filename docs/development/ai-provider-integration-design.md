# AI Provider 接入设计

## 状态

本文件最初用于 `tasks/done/0005-mvp-ai-discipline.md` 和 `tasks/backlog/0017-ai-stage-privacy-cost.md` 的实现前确认。当前 `tasks/done/0005-mvp-ai-discipline.md` 已完成 Package C 真实 AI Provider 第一版，Package D Batch D3 已完成长期阶段 AI 草稿显式触发路径；本文继续作为 provider 边界和后续长期 AI 扩展的约束说明。

Package C 已允许在 `AI_ENABLED=true` 且服务端配置完整时，由三条鉴权 AI POST route 显式触发真实 provider。Package D Batch D3 额外允许 `POST /api/simulation/stage-adjustment-drafts/ai` 显式生成长期阶段 AI 草稿。真实 key 生产烟测、保存调用历史、费用统计、自动应用阶段计划或发送更完整私密上下文，仍必须等用户后续明确确认后再做。

## 当前基线

已完成：

- `packages/ai` 定义了鞭策、每日复盘建议、明日任务建议的结构化 schema。
- `generateAdviceWithProvider` 支持 provider 抽象、schema 校验、失败 fallback 和敏感字段拦截。
- `packages/ai` 已实现 OpenAI-compatible JSON provider、`chat/completions` 请求、JSON 提取、超时、429/5xx 重试、401/403 不重试和错误码归一。
- 敏感字段拦截已覆盖常见 camelCase、snake_case 和 kebab-case 变体，例如 `apiKey`、`api_key`、`session-token`、`reviewText`、`dailyReviewSummary`、`moodText`、`pdfContent`、`attachmentFilePath`。
- Web AI API 已有：
  - `POST /api/ai/discipline`
  - `POST /api/ai/daily-review`
  - `POST /api/ai/tomorrow-plan`
- D3 后长期阶段 AI 草稿 API 已有：
  - `POST /api/simulation/stage-adjustment-drafts/ai`
- Web 服务已接入 env 驱动 provider 创建；只有上述鉴权 POST route 传入 `allowExternalProvider: true` 时才允许外呼。
- 首页普通 SSR 不传 `allowExternalProvider`，仍展示 `local_rule_fallback`，不会因为普通打开首页产生真实外呼成本。

仍待单独确认：

- D3 范围外长期阶段应用、自动计划覆盖、AI 调用历史、费用统计、完整 prompt/响应保存和更完整私密上下文外呼仍需单独确认。
- 真实生产 key 烟测仍需单独确认并使用最小测试数据。

## 接入范围

第一版真实 AI 和 D3 草稿只允许：

- 鞭策文案。
- 每日复盘建议。
- 明日最小任务建议。
- 用户显式触发的长期阶段调整草稿。

不允许：

- 自动创建、修改、删除任务、复盘、错题、附件或阶段计划。
- 默认发送动机档案、完整情绪记录、完整复盘正文、附件内容。
- 保存完整 prompt 或完整模型响应。
- 触发部署、备份、恢复、migration 或服务器命令。

长期阶段调整属于第二阶段；D3 已按 `tasks/backlog/0017-ai-stage-privacy-cost.md` 完成最小草稿字段清单和显式触发入口，后续扩展仍需继续沿用该确认包。

## Provider 设计

已在 `packages/ai` 增加：

- `createOpenAiCompatibleJsonProvider(config)`
- `AiProviderError`
- `AiProviderErrorCode`
- `createAiPrompt(kind, context)`

Provider config：

- `baseUrl`
- `apiKey`
- `model`
- `timeoutMs`
- `maxRetries`
- `logPrompts`
- `allowSensitiveContext`

行为：

1. `generateAdviceWithProvider` 仍负责敏感字段拦截和 schema 校验。
2. Provider 只负责把 safe context 转为 OpenAI-compatible chat/completions 请求。
3. 请求必须要求 JSON 输出，模型返回后只取 JSON 对象。
4. 输出不通过 schema 时返回 `ai_invalid_fallback`。
5. 外呼异常、超时、429、5xx 返回 `ai_error_fallback` 或沿用当前 fallback 状态映射，但核心流程必须成功返回本地规则建议。

## Web 接入点

已在 `apps/web/lib/study/ai-service.ts` 中增加：

- `createConfiguredAiProvider()`
- 基于 `getAuthEnv()` 的服务端 env 读取和脱敏配置检查。

规则：

- `AI_ENABLED=false`：不创建 provider，保持当前本地规则路径。
- `AI_ENABLED=true`：必须同时存在 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`。
- 缺少必要变量时，不外呼，返回本地 fallback，并在服务端记录脱敏配置错误。
- 不把 `AI_API_KEY` 暴露给客户端；客户端只接收 `meta.status/externalCall/reason`。
- 普通首页 SSR 不传 `allowExternalProvider`；真实 provider 第一版只由鉴权 AI POST route 显式触发。
- 三条 AI POST route 传入 `userId`，Web 服务按用户和建议类型做轻量内存限流；超限时回退本地规则，不调用 provider。

## 数据最小化

第一版上下文只允许发送当前已实现的聚合字段：

### 鞭策

- 阶段名称。
- 风险状态。
- 连续打卡天数。
- 今日任务完成率。
- 今日有效学习分钟数。
- 一个薄弱科目或欠账科目名称。

### 每日复盘建议

- 今日总学习分钟数。
- 今日有效学习分钟数。
- 任务完成率。
- 低转化次数。
- 是否已提交复盘。
- 情绪标签。

不得发送：

- `DailyReview.summary`
- `DailyReview.lostControl`
- `DailyReview.keepAction`
- `DailyReview.tomorrowMinimum`

### 明日任务建议

- 风险状态。
- 是否恢复模式。
- 欠账数量。
- 当前 top task 脱敏标签。
- 一个薄弱科目名称。

注意：任务标题可能含私密内容；Package C 已完成 `topTaskTitle redaction` 决策。真实 provider 第一版默认不发送原始任务标题，只发送脱敏占位标签；若未来必须发送标题，需先做脱敏并在烟测中证明 `task title may contain private content` 不会进入外呼。

### 长期阶段调整草稿

- 周期范围。
- 阶段目标摘要，不发送长目标原文。
- 有效学习分钟数。
- 任务完成率、复盘完成率、低转化次数。
- 科目投入占比。
- 薄弱节点摘要。
- 模拟考试汇总。
- 阶段计划模式、状态、距阶段结束天数。
- 风险标签。

不得发送完整任务标题、完整复盘正文、完整情绪记录、动机档案、附件内容、文件路径、完整 prompt 或 raw response。

## 敏感字段拦截

保留当前 `findSensitiveContextKeys` 作为最后防线。默认禁止 key：

- 动机档案：`whyStarted`、`neverReturnTo`、`futureSelf`、`messageToFuture`、`firstSimulationDiary`
- 复盘正文：`summary`、`dailyReviewSummary`、`lostControl`、`keepAction`、`tomorrowMinimum`、`reviewText`、`reviewBody`
- 情绪正文：`moodText`、`moodRecord`、`emotionText`、`emotionRecord`
- 笔记和附件：`note`、`content`、`attachment`、`file`、`pdfContent`、`imageContent`、`filePath`
- prompt/key/path：`prompt`、`apiKey`、`api_key`、`authorization`、`sessionToken`、`uploadDir`、`uploadPath`

`AI_ALLOW_SENSITIVE_CONTEXT=true` 不应在第一版启用。当前实现会禁用 provider 并 fallback；`allowSensitiveContext remains disabled after Package C first version`。若未来要启用，必须另开高风险确认。

## 超时、重试和限流

建议默认：

- `AI_TIMEOUT_MS=30000`
- `AI_MAX_RETRIES=2`
- 单次请求整体最长不超过 `timeoutMs * (maxRetries + 1)`，实际实现应有总超时保护。
- 429 和 5xx 可重试；400、401、403 不重试。
- 失败统一 fallback，不影响任务、计时、复盘和首页。

费用保护建议：

- 第一版不自动后台刷新 AI。
- 只由用户显式触发的 AI API 调用真实 provider。
- 当前首页会在服务端渲染时调用每日复盘建议和明日任务建议，但不传 `allowExternalProvider`，因此只展示本地 fallback，不会外呼。
- Package C 已选定首页策略：`homepage local fallback only`；真实外呼策略为 `explicit trigger only`。若未来要改为后台刷新或缓存策略，必须满足 `cache or rate limit required` 并另走确认。
- 三条 AI API 已加基础内存限流；后续如保存调用历史或做分布式限流，必须另行确认 migration 或基础设施方案。
- 不保存 token 使用量前，不宣称已有精确费用统计。

## 错误映射

建议 provider 内部错误码：

- `missing_config`
- `request_timeout`
- `rate_limited`
- `auth_failed`
- `bad_request`
- `server_error`
- `invalid_json`
- `schema_invalid`
- `network_error`

对外响应不暴露 provider 原始错误正文，只返回当前 `meta.reason` 风格的中文摘要。

## 日志脱敏

允许记录：

- advice kind。
- provider 状态。
- 错误码。
- request id 或时间戳。
- 是否 fallback。

禁止记录：

- `AI_API_KEY`
- 完整 prompt。
- 完整模型响应。
- 动机档案正文。
- 情绪正文。
- 复盘正文。
- 附件内容或文件路径。

`AI_LOG_PROMPTS=true` 第一版不建议启用；若启用，必须只记录脱敏后的 prompt 摘要。

## 验证清单

包测试：

- AI disabled fallback。
- mock provider 成功。
- mock provider 非法输出 fallback。
- mock provider throw fallback。
- 敏感字段进入 context 时 provider 不被调用。
- OpenAI-compatible provider 使用 mock fetch 测试超时、429、401、5xx、invalid JSON。

工程检查：

- `pnpm --filter @areaforge/ai test`
- `pnpm --filter @areaforge/ai typecheck`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`

烟测：

- `AI_ENABLED=false` 时三个 AI API 均返回 `local_rule_fallback`。
- `AI_ENABLED=true` 且配置缺失时不外呼并 fallback。
- mock/测试 provider 成功时返回 `ai_generated`。
- 轻量限流触发时不调用 provider 并 fallback。
- provider 失败时核心页面和 API 仍可用。
- 客户端 bundle 搜索不到 `AI_API_KEY`。
- client bundle key scan command：`rg "AI_API_KEY|AI_BASE_URL|AI_MODEL|NEXT_PUBLIC_AI|NEXT_PUBLIC_OPENAI|NEXT_PUBLIC_SUB2API" apps/web/.next/static apps/web/public`，其中 `NEXT_PUBLIC_` 只能作为扫描项出现，不能新增 `NEXT_PUBLIC_AI_*`。
- `AI_LOG_PROMPTS=false`、`AI_ALLOW_SENSITIVE_CONTEXT=false` 是第一版默认安全姿态；Package C 完成后仍不得通过 Web 接入绕过，`allowSensitiveContext remains disabled after Package C first version`。
- 不新增 AI 调用历史 migration：不得出现 `model AiCall`、`model AiUsage`、`tokenUsage` 或 `promptHash`。若后续需要费用统计或调用历史，必须另开高风险确认。

真实 provider 烟测：

- 必须使用最小测试数据。
- 不使用真实动机档案、完整复盘正文、完整情绪正文或附件。
- 记录只包含状态、错误码和 fallback 结果。

## 回滚策略

- 设置 `AI_ENABLED=false` 立即回到本地规则。
- 保留 provider 代码但不创建 provider。
- 不删除用户记录，不修改任务和复盘。
- 如果 provider 误返回非法输出，schema fallback 已保护主流程。
- 若发现隐私字段进入外呼，立即关闭 `AI_ENABLED`，保留日志摘要，审计字段来源，再单独确认修复。
