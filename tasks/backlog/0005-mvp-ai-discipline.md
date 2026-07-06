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
- `docs/modules/ai-stage-adjustment.md`
- `docs/security/threat-model.md`

## 验收标准

- AI 输出必须通过 schema 校验。
- AI 失败不影响核心学习流程。
- 日志不打印 API Key、完整 prompt 或敏感正文。
- `pnpm check` 通过。

