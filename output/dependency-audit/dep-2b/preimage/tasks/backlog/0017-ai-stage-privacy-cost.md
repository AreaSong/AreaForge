# 0017 长期 AI 阶段调整隐私与费用确认包

状态：部分完成。Package D Batch D3 已在用户确认后完成长期阶段 AI 草稿第一版；后续若要保存 AI 调用历史、费用账本、长期应用流、真实生产 key 烟测或更大字段清单，仍命中真实 AI 外呼、长期数据和阶段计划建议的高风险边界，需要另行确认。

## 目标

明确长期 AI 阶段调整的最小化数据、隐私边界、费用控制、失败回退、结构化校验和用户确认后应用规则。D3 已完成显式草稿路径，后续扩展仍按本文件继续约束。

## 范围

- 长期阶段调整 AI provider 调用边界。D3 已完成显式鉴权 `POST /api/simulation/stage-adjustment-drafts/ai`。
- 可发送字段清单和禁止发送字段清单。D3 已收敛为最小聚合字段和阶段目标摘要。
- 费用、超时、重试、限流和降级策略。D3 复用 Package C provider 闸门和本地规则 fallback。
- 输出 schema、校验失败回退和日志脱敏。D3 已新增 `stage_adjustment` schema 和 schema invalid fallback。
- AI 建议历史是否保存；若保存，另行确认 migration。
- 用户确认后应用阶段调整的审计记录；D3 只生成草稿，不新增应用流。

## 不包含

- AI 自动生成完整长期学习计划。
- AI 自动覆盖阶段计划、任务、复盘、错题或附件。
- 默认发送动机档案、完整情绪记录或完整复盘正文。
- 保存完整 prompt/raw response、token 明细或费用账本。
- D3 显式入口之外的普通页面、报告 GET、SSR 或后台长期 AI 外呼。
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

- 阶段目标摘要，最长只保留短摘要，不发送用户填写的长目标原文。
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
- D3 服务烟测必须证明 `StudyTask`、`TaskDebtEvent` 和 `StagePlan` 在生成草稿前后不变，审计 metadata 不含完整 prompt、response、API key、完整复盘、完整任务标题或附件内容。

## 验证

- AI mock 成功、失败、非法输出和敏感字段拦截测试。
- 真实 provider 烟测时使用最小测试数据，不使用真实隐私正文。
- 日志脱敏扫描。
- 客户端 bundle 密钥扫描。
- `pnpm check`。

## D3 完成记录

- 已完成：`POST /api/simulation/stage-adjustment-drafts/ai` 鉴权显式触发；`packages/ai` 新增 `stage_adjustment` schema、prompt 最小化和 schema invalid fallback；Web service 成功只写 `StageAdjustmentDraft.source="ai"`、`canAutoApply=false`、`requiresUserConfirmation=true` 和 `AI_STAGE_ADJUSTMENT_DRAFT_CREATED` 审计摘要；失败回退本地规则。
- 已验证：未登录 401、`AI_ENABLED=false` fallback、mock provider success、schema invalid fallback、禁止完整复盘/完整任务标题/prompt/response、任务/债务事件/阶段计划不变。
- 未完成：长期 AI 调用历史、费用账本、长期应用流、真实生产 key 烟测、附件或复盘正文解析，以及任何自动覆盖阶段计划或批量修改任务的能力。

## 风险

- 长期数据组合后可能暴露隐私画像。
- 外呼费用失控。
- AI 建议质量不稳定，影响阶段计划判断。
- 若保存 AI 建议历史，会引入新的 migration 和隐私留存风险。
