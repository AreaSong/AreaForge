# 0005 AI 鞭策与复盘建议

## 目标

接入 Sub2API / OpenAI 兼容接口，让 AI 生成鞭策文案、复盘建议和明日任务建议。

## 范围

- AI 适配器。
- 结构化输出校验。
- 失败回退到本地规则文案。
- 默认不发送动机档案、完整情绪记录和敏感复盘正文。

## 不包含

- AI 自动改写用户记录。
- AI 自动执行部署或服务器命令。
- AI 自动生成完整长期计划。

## 参考源事实

- `docs/architecture/ai-boundary.md`
- `docs/modules/discipline-engine.md`
- `docs/modules/review.md`
- `docs/security/file-ai-safety.md`
- `docs/security/threat-model.md`
- `docs/development/ai-provider-integration-design.md`

## 验收标准

- AI 输出必须通过 schema 校验。
- AI 失败不影响核心学习流程。
- 日志不打印 API Key、完整 prompt 或敏感正文。
- `pnpm check` 通过。

## 当前低风险进展

- `packages/ai` 已补充鞭策、每日复盘建议和明日任务建议的结构化 schema 与本地规则 fallback。
- `packages/ai` 已补充非外呼 provider 抽象、安全执行器、mock provider、AI 状态枚举和敏感上下文字段拦截。
- AI mock 成功、mock 失败、输出非法和敏感字段拦截已有包内测试覆盖；默认不调用外部 AI。
- 已新增 `POST /api/ai/discipline`、`POST /api/ai/daily-review`、`POST /api/ai/tomorrow-plan`，当前全部返回 `local_rule_fallback`，不调用外部 AI。
- 首页已展示本地规则 AI 建议草稿；这些建议不自动覆盖任务、复盘或用户记录。
- 当前实现不读取动机档案，不发送完整情绪记录或完整复盘正文。
- Web AI 服务当前不读取 `AI_API_KEY`、`AI_BASE_URL` 或 `AI_MODEL`，也不创建真实 provider；首页服务端渲染只能展示本地规则 fallback，不会因为打开首页产生真实外呼成本。
- `pnpm risk:preflight` 已把上述边界纳入确认前检查：真实 provider 未接线、Web 侧不读取 AI env/key、上下文保持聚合最小化、首页成本边界仍为本地 fallback。

## 仍待高风险确认后推进

- 接入 Sub2API / OpenAI 兼容接口并发起真实外部 AI 调用。
- 实现真实外呼 provider 的超时、重试、日志脱敏、限流与 provider 错误映射；当前只有非外呼 mock provider 和本地回退执行器。
- 将 `AI_ENABLED=true` 接入真实 provider 分支前，必须再次确认隐私、密钥、费用和外部调用边界。
- 若要保存 AI 建议审计历史，需要单独评估是否新增模型与 migration。
- 第一版 AI 只覆盖鞭策、每日复盘建议和明日任务建议；长期阶段调整另见 `tasks/backlog/0017-ai-stage-privacy-cost.md`。

## 确认后实施切入点

以下清单只用于获得 Package C 明确确认后的实现，不代表确认前可以接入真实 provider、读取真实 key 或发起外呼。

- 在 `packages/ai` 新增 OpenAI-compatible JSON provider，覆盖 `chat/completions` 请求、JSON 提取、schema 校验失败 fallback、超时、429/5xx 重试、401/403 不重试和错误码归一。
- 在 `apps/web/lib/study/ai-service.ts` 增加 env 驱动 provider 创建：`AI_ENABLED=false` 时保持本地规则；`AI_ENABLED=true` 且配置缺失时不外呼并返回 fallback；配置完整时只对明确允许的 AI API 使用 provider。
- 首页服务端渲染不得因为普通打开页面产生真实外呼成本；真实 provider 第一版需要改成用户显式触发、缓存/限流保护，或继续让首页只展示本地 fallback。
- 外呼上下文只能使用聚合字段：阶段、风险、连续天数、任务完成率、有效分钟、低转化次数、复盘是否提交、情绪标签和单个薄弱/欠账摘要；不得发送动机档案、完整复盘正文、完整情绪正文、附件内容、上传路径或 prompt/key。
- 日志只允许记录 advice kind、状态、错误码、fallback 结果和 request id；不得记录 API Key、完整 prompt、完整模型响应或隐私正文。
- 验证必须覆盖：`AI_ENABLED=false` fallback、配置缺失 fallback、mock provider 成功、超时/429/401/5xx/invalid JSON fallback、敏感字段拦截时 provider 不被调用、客户端 bundle 搜不到 `AI_API_KEY`。

## 高风险确认

AI 调用属于高风险边界。开始实现前必须确认：

- 默认不发送动机档案。
- 默认不发送完整情绪记录。
- 默认不发送完整复盘正文。
- AI 只返回建议或草稿，不直接覆盖用户记录。
- 失败时必须回退本地规则文案。
- 日志不记录 API Key、完整 prompt 或敏感正文。
- 需要明确超时、重试、限流和费用保护默认值。

## 验证

- `pnpm check`
- AI disabled 时核心流程可用。
- AI mock 成功时输出通过 schema 校验。
- AI mock 失败或输出非法时回退本地规则。
- 客户端 bundle 不暴露 `AI_API_KEY`。
