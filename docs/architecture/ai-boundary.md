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

`packages/ai` 提供本地 fallback、结构化 schema、敏感字段拦截和 OpenAI-compatible JSON provider。敏感字段拦截会识别常见 camelCase、snake_case 和 kebab-case 变体；Web 层只在鉴权 POST AI route 中允许显式外呼，首页普通 SSR 保持本地 fallback。三条建议、四类文本草稿和一条长期阶段草稿共八条显式 POST 路径共享同一个当前浏览器外呼 gate：只有当前浏览器偏好明确开启、`AI_ENABLED=true` 且服务端 Provider 配置完整时才可外呼；偏好缺失、清除、关闭或畸形时一律 fail closed 到本地规则。

当前浏览器偏好只通过鉴权 `GET|PATCH /api/ai/preferences` 读取和保存。服务端使用 host-only、`HttpOnly`、`SameSite=Strict`、生产环境 `Secure` 的 Cookie，不写数据库；Cookie 不包含用户、Provider、模型、密钥、prompt、正文或内容 hash。`/settings/ai` 只展示 Provider 配置状态并在策略变化前确认，不提供 Provider key 编辑。长期阶段调整 AI 草稿与四类草稿仍通过鉴权 POST 显式触发；四类草稿继续使用 `AI_PAYLOAD_BINDING_SECRET` 做 purpose-separated HMAC 与 30 分钟 opaque preview token（密钥不得进入客户端）。调用历史、费用统计、发送更大字段清单或保存完整 prompt/响应仍需后续单独确认。权威契约见 `workflow/versions/v1.1-learning-action-center.md`。
