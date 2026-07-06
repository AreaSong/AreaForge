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

## 验收标准

- AI 输出必须通过 schema 校验。
- AI 失败不影响核心学习流程。
- 日志不打印 API Key、完整 prompt 或敏感正文。
- `pnpm check` 通过。

## 当前低风险进展

- `packages/ai` 已补充鞭策、每日复盘建议和明日任务建议的结构化 schema 与本地规则 fallback。
- 已新增 `POST /api/ai/discipline`、`POST /api/ai/daily-review`、`POST /api/ai/tomorrow-plan`，当前全部返回 `local_rule_fallback`，不调用外部 AI。
- 首页已展示本地规则 AI 建议草稿；这些建议不自动覆盖任务、复盘或用户记录。
- 当前实现不读取动机档案，不发送完整情绪记录或完整复盘正文。

## 仍待高风险确认后推进

- 接入 Sub2API / OpenAI 兼容接口并发起真实外部 AI 调用。
- 实现 prompt 数据最小化、超时、失败回退、mock 成功/失败测试和日志脱敏验证。
- 若要保存 AI 建议审计历史，需要单独评估是否新增模型与 migration。

## 高风险确认

AI 调用属于高风险边界。开始实现前必须确认：

- 默认不发送动机档案。
- 默认不发送完整情绪记录。
- 默认不发送完整复盘正文。
- AI 只返回建议或草稿，不直接覆盖用户记录。
- 失败时必须回退本地规则文案。
- 日志不记录 API Key、完整 prompt 或敏感正文。

## 验证

- `pnpm check`
- AI disabled 时核心流程可用。
- AI mock 成功时输出通过 schema 校验。
- AI mock 失败或输出非法时回退本地规则。
- 客户端 bundle 不暴露 `AI_API_KEY`。
