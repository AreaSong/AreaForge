# AI 边界

AreaForge 第一版使用用户自有 Sub2API / OpenAI 兼容接口。

AI 可以做：

- 生成鞭策文案。
- 生成每日复盘建议。
- 生成明日最小任务建议。
- 根据状态生成恢复动作。
- 经显式鉴权 POST 生成四类文本草稿（学习树、知识卡片、计划、动机）：须先选中文本，发送前预览全部 payload；结果只进入预览、学习树校验、卡片保存或计划收件箱。

AI 不可以做：

- 直接覆盖用户计划。
- 删除或改写原始记录。
- 默认读取动机档案、完整情绪记录、完整复盘正文、附件内容、上传路径、密钥或 session token。
- 触发部署、迁移或服务器命令。
- 通过 SSR、GET、定时任务或后台作业自动外呼 provider。

所有 AI 输出必须做结构化校验；失败时回退本地规则文案。

`packages/ai` 提供本地 fallback、结构化 schema、敏感字段拦截和 OpenAI-compatible JSON provider。敏感字段拦截会识别常见 camelCase、snake_case 和 kebab-case 变体；Web 层只在鉴权 POST AI route 中允许显式外呼，首页普通 SSR 保持本地 fallback。长期阶段调整 AI 草稿与四类草稿均通过鉴权 POST 显式触发；四类草稿使用 `AI_PAYLOAD_BINDING_SECRET` 做 purpose-separated HMAC 与 30 分钟 opaque preview token（密钥不得进入客户端）。调用历史、费用统计、发送更大字段清单或保存完整 prompt/响应仍需后续单独确认。权威契约见 `workflow/versions/v1.1-learning-action-center.md`。
