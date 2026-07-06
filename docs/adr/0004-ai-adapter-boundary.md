# ADR 0004: AI 适配边界

## 决策

AreaForge 通过 Sub2API / OpenAI 兼容接口接入 AI，并通过 `packages/ai` 封装。

## 原则

- AI 只生成建议或草稿。
- AI 不直接覆盖用户计划。
- AI 不删除或改写原始记录。
- AI 输出必须结构化校验。
- AI 失败时回退到本地规则文案。
- 默认不发送动机档案和完整情绪记录。

## 影响

- 业务规则先由 `packages/core` 判断状态。
- AI 根据状态生成表达和建议。
- API Key 和 prompt 不进入客户端。

