# 0017 长期 AI 阶段调整隐私与费用确认包

状态：待确认。该任务命中真实 AI 外呼、长期数据和阶段计划建议的高风险边界。

## 目标

在接入长期 AI 阶段调整前，明确最小化数据、隐私边界、费用控制、失败回退、结构化校验和用户确认后应用规则。

## 范围

- 长期阶段调整 AI provider 调用边界。
- 可发送字段清单和禁止发送字段清单。
- 费用、超时、重试、限流和降级策略。
- 输出 schema、校验失败回退和日志脱敏。
- AI 建议历史是否保存；若保存，另行确认 migration。
- 用户确认后应用阶段调整的审计记录。

## 不包含

- AI 自动生成完整长期学习计划。
- AI 自动覆盖阶段计划、任务、复盘、错题或附件。
- 默认发送动机档案、完整情绪记录或完整复盘正文。
- AI 触发部署、备份、恢复或服务器命令。

## 参考源事实

- `docs/architecture/ai-boundary.md`
- `docs/security/file-ai-safety.md`
- `docs/modules/ai-stage-adjustment.md`
- `docs/modules/simulation-exam.md`
- `docs/modules/periodic-reports.md`
- `docs/product/roadmap.md`
- `docs/development/ai-provider-integration-design.md`

## 默认可发送字段

- 阶段目标摘要。
- 任务完成率、有效学习时长、科目投入占比。
- 错题数量、错题复盘率、薄弱科目和薄弱节点摘要。
- 模拟考试分数、目标差距、空题数量和失分类型摘要。
- 连续打卡、断签次数、低转化学习次数。
- 情绪标签聚合，不发送完整情绪正文。

## 默认禁止发送字段

- 动机档案正文。
- 完整情绪记录正文。
- 完整复盘正文。
- 附件内容、PDF 原文、图片内容。
- API Key、数据库 URL、session token、上传目录绝对路径。

## 验收标准

- `AI_ENABLED=false` 时长期阶段调整只使用本地规则。
- `AI_ENABLED=true` 时请求字段符合最小化清单。
- AI 输出必须结构化校验；失败回退本地规则。
- 日志不记录 API Key、完整 prompt 或隐私正文。
- 超时、重试、限流和错误映射可测。
- AI 建议只生成草稿，用户确认后才应用。
- 客户端 bundle 不暴露 `AI_API_KEY`。

## 验证

- AI mock 成功、失败、非法输出和敏感字段拦截测试。
- 真实 provider 烟测时使用最小测试数据，不使用真实隐私正文。
- 日志脱敏扫描。
- 客户端 bundle 密钥扫描。
- `pnpm check`。

## 风险

- 长期数据组合后可能暴露隐私画像。
- 外呼费用失控。
- AI 建议质量不稳定，影响阶段计划判断。
- 若保存 AI 建议历史，会引入新的 migration 和隐私留存风险。
