# 验证矩阵

## 原则

验证从改动范围出发，选择最小充分集合。不要因为任务小就不验证，也不要每次都默认跑最大集合。

不能运行的验证必须说明原因。没有验证，不宣称完成。

## 路径到验证

| 改动范围 | 最小验证 |
|---|---|
| `docs/**`、`README.md`、`AGENTS.md` | `rg` 检查旧引用和入口路径，`git diff --check` |
| `tasks/**`、`workflow/**` | 检查对应 `docs/**` 源事实是否存在，`git diff --check` |
| `package.json`、`pnpm-workspace.yaml` | `pnpm install --frozen-lockfile` 或说明无法运行原因，`pnpm check` |
| `prisma/schema.prisma`、`prisma/migrations/**` | `pnpm db:validate`，涉及 migration 时补充迁移和回滚说明 |
| `packages/core/**` | 相关单元测试，至少 `pnpm typecheck` |
| `packages/db/**` | `pnpm db:generate`、`pnpm typecheck`，涉及查询行为时补测试或手动验证 |
| `packages/ai/**` | AI 输出 schema 校验测试，本地回退路径验证 |
| `packages/storage/**` | 上传策略测试，大小、MIME、路径穿越边界验证 |
| `apps/web/**` UI | `pnpm check`，可启动时用浏览器或截图检查主要页面 |
| `infra/**`、`docker-compose*.yml` | `docker compose config`，部署文档同步检查 |
| `.env.example`、配置解析 | 配置 schema 覆盖检查，敏感字段不入库检查 |

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
