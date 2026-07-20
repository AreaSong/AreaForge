# 治理责任边界矩阵

## 目标

本矩阵把目录责任、源事实、默认写入级别和最小验证放在同一处。它服务于开工前路由和评审，
不替代产品设计、发布授权、生产健康或 residual 台账。

使用方式：先按改动路径找到责任边界，再按 `docs/development/runtime-write-boundary.md` 判断动作级别，
最后从 `docs/development/validation-matrix.md` 选择验证。跨行改动以最高风险行决定 owner skill 和确认要求。

## 写入级别

| 等级 | 含义 | 默认处理 |
|---|---|---|
| R0 | 只读分析、文档或本地静态证据 | 不产生运行时写入；保留 claim boundary |
| R1 | 本地开发数据或可丢弃 fixture 写入 | 可按正常开发验证；不得暗示生产状态 |
| R2 | 用户显式确认的 Web 业务写入 | 需要认证、授权、审计和对应业务验证 |
| R3 | Web 提交受控更新请求 | 只创建请求；不等于服务器 apply |
| R4 | 生产 updater、backup、restore、migration、rollback 或服务器命令 | 高风险确认后由服务器侧受控执行 |

## 目录责任

| 路径 | 责任与源事实 | 默认等级 | 主要 owner | 必查边界 |
|---|---|---:|---|---|
| `apps/web/**` | UI、Route Handler、认证后的应用编排；`docs/modules/**`、`docs/ux/**`、`docs/architecture/api-surface.md` | R1/R2/R3 | 产品体验、QA；认证或版本中心改动加安全/Release | 页面不得直连 Prisma；Web runtime 不执行服务器运维命令 |
| `packages/core/**` | 平台无关业务规则；模块文档与测试 | R0/R1 | 业务规则、QA | 不依赖 Next.js、React、Prisma、浏览器 API 或环境变量 |
| `packages/db/**`、`prisma/**` | 数据访问、schema、migration；`docs/architecture/data-model.md` | R1/R4 | 数据/安全、验证 | schema/migration、数据修复和生产 deploy 都需要高风险确认 |
| `packages/ai/**` | Provider、最小化上下文、回退；`docs/architecture/ai-boundary.md`、`docs/security/file-ai-safety.md` | R1/R2 | AI 治理、安全 | 不发送完整私密内容；AI 只产出建议/草稿 |
| `packages/storage/**`、附件 route | 私有上传、鉴权下载、metadata/hash/URI；文件存储与安全文档 | R1/R2/R4 | 文件存储安全、安全 | 不放入 `public/`；删除、迁移、恢复需高风险确认 |
| `ops/**`、`scripts/ops/**` | 只读证据、runbook、服务器侧 updater；部署与运维文档 | R0/R4 | SRE、Release、供应链 | Web runtime 不调用；R4 必须明确确认、签名、备份和回滚边界 |
| `scripts/quality/**` | 本地 validator、preflight、自测；验证矩阵 | R0/R1 | 验证、治理 | 不以 schema validator 替代运行、Release 或 live evidence |
| `.github/**` | CI、Release、依赖与公开仓库治理；依赖策略与安全政策 | R0/R4 | 企业治理、供应链 | Actions 固定到 commit；stable release 签名失败闭合 |
| `docs/**`、`tasks/**`、`workflow/**` | 源事实、轻量执行拆分、版本计划 | R0 | 文档同步、残余风险 | `docs/**` 优先；历史证据不改写成当前事实 |
| `.codex/skills-src/**`、`.agents/skills/**` | Codex 工作流提示，不是产品源事实 | R0 | operating-loop、文档同步 | 改动同步 `agents/openai.yaml` 并运行 `pnpm skills:validate` |

## 路由规则

1. 单一 R0/R1 路径可以走 Quick 或 Change，但仍要有对应源事实和最小验证。
2. 跨 UI、业务规则、数据、AI、存储、Release 或 Ops 时，使用 `areaforge-operating-loop` 并由最高风险 owner 收口。
3. R2 变更必须证明用户确认、认证授权和审计边界；R3 只证明请求被接受；R4 不得由 Web runtime 执行。
4. 先运行 `pnpm governance:changed-paths --summary`：`routine` 走常规验证，`protected-path` 必须链接控制面证据，`high-risk` 必须回到确认包和专项验证。该报告不授予高风险确认。
5. 工作区不是干净状态时，先保存 [受保护路径审阅记录模板](protected-path-review-record-template.md) 或在 PR/完成声明中等价记录审阅范围、`git status` 指纹、受保护路径 fingerprint、发现和未证明项。
6. 模板校验通过只证明记录的形态；它不证明生产健康、所有目录均被审阅、工作区干净、没有未追踪改动或任何 R4 动作已经执行。
7. 治理权威来源、唯一 accountable owner、已有 package script 门禁和复审触发器统一登记在 `governance-register.json`；登记册不得承载 lifecycle 或 residual 状态。

## 最小验证

| 改动面 | 至少运行 |
|---|---|
| 本矩阵、协作或公共治理文档 | `pnpm docs:readiness`、`pnpm docs:completion`、`pnpm governance:preflight`、`git diff --check` |
| 路径审阅分类器 | `pnpm governance:changed-paths --summary`、`pnpm governance:changed-paths:selftest`、`git diff --check` |
| 受保护路径审阅记录 | `pnpm governance:protected-path-review:validate <record>`、对应 selftest、`git diff --check` |
| CI、Release、依赖或公开治理 | 上述命令加 `pnpm skills:validate` 与验证矩阵要求 |
| Ops、Release 或生产证据 | 先读 `pnpm ops:handoff --summary`；本地检查不替代 live evidence 或 R4 确认 |

## 不包含

- 不创建自动执行队列、自动审批器或数据库化任务系统。
- 不改变 `AREAFORGE_AUTO_APPLY=none`，不授权 production updater apply。
- 不关闭 `AF-RISK-*`，不补造 release backup hash、生产 smoke 或 update-agent 证据。
