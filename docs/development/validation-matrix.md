# 验证矩阵

## 原则

验证从改动范围出发，选择最小充分集合。不要因为任务小就不验证，也不要每次都默认跑最大集合。

不能运行的验证必须说明原因。没有验证，不宣称完成。

## 路径到验证

| 改动范围 | 最小验证 |
|---|---|
| `docs/**`、`README.md`、`AGENTS.md` | `rg` 检查旧引用和入口路径，`pnpm docs:readiness`，`git diff --check` |
| `tasks/**`、`workflow/**` | 检查对应 `docs/**` 源事实是否存在，`pnpm docs:readiness`，`git diff --check` |
| `package.json`、`pnpm-workspace.yaml` | `pnpm install --frozen-lockfile` 或说明无法运行原因，`pnpm check` |
| `prisma/schema.prisma`、`prisma/migrations/**` | `pnpm db:validate`，涉及 migration 时补充迁移和回滚说明 |
| `packages/core/**` | 相关单元测试，至少 `pnpm typecheck` |
| `packages/db/**` | `pnpm db:generate`、`pnpm typecheck`，涉及查询行为时补测试或手动验证 |
| `packages/ai/**` | AI 输出 schema 校验测试，本地回退路径验证 |
| `packages/storage/**` | 上传策略测试，大小、MIME、路径穿越边界验证 |
| `apps/web/**` UI | `pnpm check`，可启动时用浏览器或截图检查主要页面 |
| `infra/**`、`docker-compose*.yml` | `docker compose config`，部署文档同步检查 |
| `.env.example`、配置解析 | 配置 schema 覆盖检查，敏感字段不入库检查 |
| 高风险包确认前准备 | `pnpm risk:preflight`，确认只读护栏、配置键、文档引用和危险默认值 |

## Package B Batch 0 专项验证

确认前只允许做文档和护栏准备：

- `pnpm docs:readiness`
- `pnpm risk:preflight`
- `git diff --check`

用户明确确认 Batch 0 后，才允许修改 `prisma/schema.prisma` 和生成 migration。实现后至少运行：

- `pnpm db:validate`
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`，不要裸跑 deploy。
- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：开始计时、结束计时、active session、dashboard、analytics、reports。
- 页面烟测：首页结束一次计时后刷新，仍能看到有效/低转化状态和收口文本。

注意：`pnpm risk:preflight` 当前的 Package B implementation boundary 是确认前护栏。Batch 0 获确认并完成后，应同步调整脚本为“允许 Batch 0 字段存在，继续阻止 Batch 1-6 未确认模型越界”。

## docs 100% 最终门禁

- `pnpm docs:readiness` 只证明治理结构、入口和追踪关系存在。
- `pnpm risk:preflight` 只证明 Package A-E 的确认前护栏存在，不执行上传、migration、AI 外呼、部署或备份恢复；其中 Package C 还检查真实 provider 未接线、Web 侧不读取 AI env/key、AI 上下文保持聚合最小化、首页只允许本地 fallback 成本边界；Package D 还检查只读重排 API、只读阶段调整草稿 API、confirm-only DTO、UI 标签和文档边界。
- `pnpm docs:completion` 用于最终完成验收；在 `feature-traceability` 仍有“基础版 / 待确认 / 未实现”或缺少高风险完成记录时，预期应失败。
- 日常文档同步不要求 `pnpm docs:completion` 通过；声称 AreaForge docs 100% 完成前必须通过。

## 风险升级

以下情况必须扩大验证：

- 改动跨 `apps/web`、`packages/db`、`prisma`。
- 改动认证、会话、上传、AI、备份、部署。
- 改动会影响已有数据。
- 文档和代码出现不一致。
- 上一次验证失败或被阻塞。

## 验证报告格式

```text
改动范围:
- 

改了什么:
- 

为什么这样改:
- 

已运行:
- <command>: <result>

未运行:
- <command>: <reason>

结果:
- PASS / FAIL / BLOCKED / NOT-READY

残余风险:
- 
```

## 当前已知验证阻塞

仓库使用 pnpm 11.7.0，并通过 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 与 `allowBuilds` 允许 Prisma、Sharp 和相关解析依赖执行必要 build script。若当前机器仍提示 ignored builds，按 `docs/development/setup.md` 执行 `pnpm approve-builds --all` 后再跑 `pnpm check`。
