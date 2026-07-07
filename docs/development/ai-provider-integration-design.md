# AI Provider 接入设计

## 状态

本文件是 `tasks/backlog/0005-mvp-ai-discipline.md` 和 `tasks/backlog/0017-ai-stage-privacy-cost.md` 的实现前确认设计，不是已启用真实 AI 外呼。任何 `AI_ENABLED=true` 的真实 provider 接入、真实 key 烟测或长期阶段调整外呼，都必须等用户明确确认后再做。

## 当前基线

已完成：

- `packages/ai` 定义了鞭策、每日复盘建议、明日任务建议的结构化 schema。
- `generateAdviceWithProvider` 支持 provider 抽象、schema 校验、失败 fallback 和敏感字段拦截。
- 敏感字段拦截已覆盖常见 camelCase、snake_case 和 kebab-case 变体，例如 `apiKey`、`api_key`、`session-token`、`reviewText`、`dailyReviewSummary`、`moodText`、`pdfContent`、`attachmentFilePath`。
- Web AI API 已有：
  - `POST /api/ai/discipline`
  - `POST /api/ai/daily-review`
  - `POST /api/ai/tomorrow-plan`
- 当前 Web 服务不传 provider，所以始终走 `local_rule_fallback`，不会外呼。

待接入：

- Sub2API / OpenAI 兼容 provider。
- env 驱动的 provider 创建。
- 超时、重试、限流、错误映射、日志脱敏。
- 长期阶段调整 provider 仍需单独确认。

## 接入范围

第一版真实 AI 只允许：

- 鞭策文案。
- 每日复盘建议。
- 明日最小任务建议。

不允许：

- 自动创建、修改、删除任务、复盘、错题、附件或阶段计划。
- 默认发送动机档案、完整情绪记录、完整复盘正文、附件内容。
- 保存完整 prompt 或完整模型响应。
- 触发部署、备份、恢复、migration 或服务器命令。

长期阶段调整属于第二阶段，必须按 `tasks/backlog/0017-ai-stage-privacy-cost.md` 再确认字段清单和费用边界。

## Provider 设计

建议在 `packages/ai` 增加：

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

建议在 `apps/web/lib/study/ai-service.ts` 中增加：

- `createConfiguredAiProvider()`
- `getSafeAiEnv()`

规则：

- `AI_ENABLED=false`：不创建 provider，保持当前本地规则路径。
- `AI_ENABLED=true`：必须同时存在 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`。
- 缺少必要变量时，不外呼，返回本地 fallback，并在服务端记录脱敏配置错误。
- 不把 `AI_API_KEY` 暴露给客户端；客户端只接收 `meta.status/externalCall/reason`。

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
- 当前 top task 标题。
- 一个薄弱科目名称。

注意：任务标题可能含私密内容；若后续用户把敏感内容写进标题，需要增加标题脱敏或改为只发任务类型/科目。

## 敏感字段拦截

保留当前 `findSensitiveContextKeys` 作为最后防线。默认禁止 key：

- 动机档案：`whyStarted`、`neverReturnTo`、`futureSelf`、`messageToFuture`、`firstSimulationDiary`
- 复盘正文：`summary`、`dailyReviewSummary`、`lostControl`、`keepAction`、`tomorrowMinimum`、`reviewText`、`reviewBody`
- 情绪正文：`moodText`、`moodRecord`、`emotionText`、`emotionRecord`
- 笔记和附件：`note`、`content`、`attachment`、`file`、`pdfContent`、`imageContent`、`filePath`
- prompt/key/path：`prompt`、`apiKey`、`api_key`、`authorization`、`sessionToken`、`uploadDir`、`uploadPath`

`AI_ALLOW_SENSITIVE_CONTEXT=true` 不应在第一版启用。若未来要启用，必须另开高风险确认。

## 超时、重试和限流

建议默认：

- `AI_TIMEOUT_MS=30000`
- `AI_MAX_RETRIES=2`
- 单次请求整体最长不超过 `timeoutMs * (maxRetries + 1)`，实际实现应有总超时保护。
- 429 和 5xx 可重试；400、401、403 不重试。
- 失败统一 fallback，不影响任务、计时、复盘和首页。

费用保护建议：

- 第一版不自动后台刷新 AI。
- 只由用户打开页面或点击建议入口触发。
- 当前首页会在服务端渲染时调用每日复盘建议和明日任务建议；若直接把这条路径接入真实 provider，打开首页就会产生外呼成本。第一版真实外呼前必须改为明确触发、缓存/限流保护，或保持首页只展示本地规则建议。
- 每个 API 可加基础内存限流或依赖现有登录态限速，后续如保存调用历史需另行确认 migration。
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
- provider 失败时核心页面和 API 仍可用。
- 客户端 bundle 搜索不到 `AI_API_KEY`。

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
