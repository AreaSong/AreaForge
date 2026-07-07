# 0005 AI 鞭策与复盘建议

状态：已完成。该任务对应 Package C：真实 AI Provider 第一版。

## 目标

接入 Sub2API / OpenAI 兼容接口，让 AI 生成鞭策文案、复盘建议和明日任务建议。

## 范围

- AI 适配器。
- 结构化输出校验。
- 失败回退到本地规则文案。
- 默认不发送动机档案、完整情绪记录和完整复盘正文。

## 不包含

- AI 自动改写用户记录。
- AI 自动执行部署或服务器命令。
- AI 自动生成完整长期计划。
- 长期阶段调整 AI、任务重排应用、报告决策应用或生产部署。

## 参考源事实

- `docs/architecture/ai-boundary.md`
- `docs/modules/discipline-engine.md`
- `docs/modules/review.md`
- `docs/security/file-ai-safety.md`
- `docs/security/threat-model.md`
- `docs/development/ai-provider-integration-design.md`

## 已完成实现

- `packages/ai` 已实现 OpenAI-compatible JSON provider，通过 `chat/completions` 请求结构化 JSON。
- `packages/ai` 已保留本地规则 fallback、provider 抽象、mock provider、AI 状态枚举和敏感上下文字段拦截。
- `generateAdviceWithProvider` 已覆盖 schema 校验、provider 成功、provider 抛错、非法 JSON、schema invalid、敏感字段拦截和 fallback。
- Web 层已通过 env 驱动 provider 创建：`AI_ENABLED=false` 保持本地规则；`AI_ENABLED=true` 但 `AI_BASE_URL`、`AI_API_KEY` 或 `AI_MODEL` 配置缺失时不外呼并 fallback。
- Web 层已固定第一版安全姿态：`AI_ALLOW_SENSITIVE_CONTEXT=true` 时禁用 provider；`AI_LOG_PROMPTS` 不用于记录完整 prompt。
- `POST /api/ai/discipline`、`POST /api/ai/daily-review`、`POST /api/ai/tomorrow-plan` 已改为鉴权 POST-only，并且只有这些显式 route 传入 `allowExternalProvider: true` 时才允许真实 provider。
- Web 层已按用户和建议类型加轻量内存限流；触发限流时不调用 provider，直接回退本地规则建议。
- 首页服务端渲染不得因为普通打开页面产生真实外呼成本；当前首页普通 SSR 不传 `allowExternalProvider`，只展示本地规则建议。
- 外呼上下文只发送聚合字段；明日任务建议不发送原始任务标题，`task title may contain private content` 作为标题隐私烟测不进入 provider 请求体。
- 日志只记录脱敏配置问题，不记录 API Key、完整 prompt、完整模型响应、动机档案、完整情绪记录、完整复盘正文或附件内容。
- 未新增 AI 调用历史、费用统计或 prompt/response 持久化模型。

## 确认后实施切入点

以下切入点已在 Package C 明确确认后完成：

- 在 `packages/ai` 新增 OpenAI-compatible JSON provider，覆盖 `chat/completions` 请求、JSON 提取、schema 校验失败 fallback、超时、429/5xx 重试、401/403 不重试和错误码归一。
- 在 `apps/web/lib/study/ai-service.ts` 增加 env 驱动 provider 创建：`AI_ENABLED=false` 时保持本地规则；`AI_ENABLED=true` 且配置缺失时不外呼并返回 fallback；配置完整时只对用户显式触发的 AI API 使用 provider。
- 首页服务端渲染不得因为普通打开页面产生真实外呼成本；首页普通 SSR 保持本地规则建议，真实 provider 第一版只由明确允许的 AI API 触发。
- 外呼上下文只能使用聚合字段：阶段、风险、连续天数、任务完成率、有效分钟、低转化次数、复盘是否提交、情绪标签和单个薄弱/欠账摘要；不得发送动机档案、完整复盘正文、完整情绪正文、附件内容、上传路径或 prompt/key。
- 日志只允许记录 advice kind、状态、错误码、fallback 结果和 request id；不得记录 API Key、完整 prompt、完整模型响应或隐私正文。
- 验证覆盖：`AI_ENABLED=false` fallback、配置缺失 fallback、mock provider 成功、轻量限流、超时、429、401、5xx、invalid JSON、schema invalid、敏感字段拦截时 provider 不被调用、客户端 bundle 搜不到 `AI_API_KEY`。

## 验收证据

- AI 输出必须通过 schema 校验；不通过时返回 `ai_invalid_fallback` 或本地规则建议。
- AI 失败不影响任务、计时、复盘和首页核心流程。
- 日志不打印 API Key、完整 prompt 或敏感正文。
- Package C 完成证据已写入 `docs/development/docs-100-completion-record.md`。
- 功能追踪已将鞭策文案、AI 复盘建议和 AI 明日任务建议标为已完成。

## 验证

- `pnpm --filter @areaforge/ai test`：通过。
- `pnpm --filter @areaforge/ai typecheck`：通过。
- `pnpm --filter @areaforge/web typecheck`：通过。
- `pnpm --filter @areaforge/web lint`：通过。
- `pnpm check`：通过。
- `pnpm risk:preflight`：通过。
- `pnpm docs:readiness`：通过。
- `git diff --check`：通过。

## 残余风险

- 本批不包含长期阶段调整 AI；该能力仍需 `tasks/backlog/0017-ai-stage-privacy-cost.md` 和 Package D 另行确认。
- 本批不包含保存完整 prompt、完整响应、token 用量或 AI 调用历史。
- 本批不包含把动机档案、完整情绪记录、完整复盘正文、附件内容、PDF、图片内容或 OCR 文本发送给 provider。
- 本批不包含真实生产 key 烟测或生产部署。

## 高风险确认记录

用户已明确确认：

> 确认执行 Package C：真实 AI Provider 第一版。范围仅限鞭策文案、每日复盘建议、明日最小任务建议的 OpenAI-compatible provider 接入、env 配置、超时/重试/限流/错误 fallback、日志脱敏和客户端密钥扫描；不包含长期阶段调整 AI、发送动机档案/完整情绪记录/完整复盘正文/附件内容、自动覆盖记录或保存完整 prompt/响应。
