# Codex 协作工作流

## 定位

AreaForge 采用轻量 Codex 工作流。它吸收 AreaMatrix 的源事实、验证、文件安全、残余风险分类和版本规划思想，也吸收 AreaFlow 的只读 operations readiness 思路，但不引入重型 task-loop、runtime registry、数据库化 residual ledger、command_requests 或自动 prompt 执行队列。

## 工作层次

1. `docs/**`：产品、架构、模块、安全和开发源事实。
2. `workflow/versions/**`：版本级计划、入口条件和验收标准。
3. `tasks/**`：轻量执行任务，不替代 `docs/**`。
4. 代码实现：只在对应源事实和任务边界清楚后推进。

若层次之间冲突，优先更新 `docs/**`，再同步 `workflow/**` 和 `tasks/**`。

## 任务分级

### Quick

适合低风险文档修正、错别字、入口链接补充、小范围说明同步。

要求：

- 读最近的源事实。
- 修改后运行轻量检查，如 `rg`、`git diff --check`。

### Change

适合单模块功能实现、单文档主题扩展、单包内重构。

要求：

- 明确源事实。
- 明确包含和不包含。
- 按 `docs/development/validation-matrix.md` 选择验证。

### Mission-Critical

命中以下边界时进入高风险任务：

- 认证、会话、权限。
- 数据库 migration、数据修复、批量删除。
- 上传、附件删除、备份和恢复。
- AI 默认读取动机档案、情绪记录、复盘正文。
- 部署、服务器命令、一键更新。

要求：

- 先说明影响、风险、验证和回滚。
- 等明确确认后再执行。
- 结果必须报告未验证项和残余风险。

### Review

用户要求评审或风险检查时，优先输出问题，不先写总结。

要求：

- 按严重度排序。
- 带文件路径和行号。
- 区分 bug、风险、缺测试、缺文档和开放问题。

### Ops / Release

适合生产健康、备份、update-agent、GitHub Release、签名、自动更新策略、回滚目标和长期运营 readiness。

要求：

- 优先读取 `docs/development/operational-readiness.md` 和 `docs/development/residual-risk-ledger.md`。
- 默认只读检查；写入生产动作必须走高风险确认。
- 发布前本地和 CI 至少运行 `pnpm ops:readiness`、`pnpm github-release-updater:preflight`、`pnpm shellcheck:updater`、`pnpm docs:readiness`、`pnpm risk:preflight` 和 `pnpm check`；发布或更新后用 `pnpm ops:evidence:bundle` 生成运行态证据包 hash，并用 `pnpm ops:alert:preview` 预览告警动作；若形成演练记录，运行 `pnpm alert:drill:validate <record>`。
- 残余项使用稳定 ID，不把监控缺口或接受例外混成当前功能未完成。

## 子代理使用规则

- 只有用户明确要求使用子代理、并行审查或分工时才使用。
- 子代理适合只读审查、不同维度并行探索、互不重叠的实现切片。
- 主代理必须整合子代理结论，不能直接把子代理输出当最终验收。
- 子代理不能替代本地验证，也不能替代高风险确认。

## 开工前检查

正式改代码前，先检查：

- 是否有对应 `docs/**` 源事实。
- 是否有对应 `tasks/**` 任务边界。
- 是否命中高风险边界。
- 是否知道最小验证集合。
- 是否可能影响部署、AI、上传、认证或数据库。

## 功能完成后的发版规则

当一次功能更新准备进入线上时，默认走 GitHub Release 路径，而不是只在服务器上手动改代码：

1. 先同步 `docs/**`、`tasks/**` 和 `workflow/**`，确认源事实没有漂移。
2. 按 `docs/development/validation-matrix.md` 跑对应验证，至少覆盖 `pnpm check`、`pnpm docs:readiness`、`pnpm risk:preflight`、`pnpm ops:readiness` 和 `git diff --check`；涉及更新器时补跑 `pnpm github-release-updater:preflight` 与 `pnpm shellcheck:updater`。
3. bump 版本并提交干净 commit。
4. 创建并推送 `vX.Y.Z` tag，让 `.github/workflows/release.yml` 先执行 validate job，再生成 GitHub Release、GHCR Web/migration 镜像、manifest、`SHA256SUMS` 和 cosign bundle；stable release 缺签名密钥必须失败。
5. 通过 Web 版本中心提交受控更新请求，或由管理员在服务器执行 updater；Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令。
6. 更新成功后，把 Release tag、线上 health、镜像 digest、update-agent 状态、`pnpm ops:evidence:bundle` 的 `bundleHash` 和残余风险同步回发布记录或对应文档。

当前仓库已提供 repo-local Codex skills，源目录为 `.codex/skills-src/`，自动发现入口为 `.agents/skills/`。跨多个治理面时先触发 `areaforge-operating-loop` 做分级和 owner 路由；涉及企业治理、发布、真实体验、文档同步、生产运维、观测、事故响应、安全、供应链、残余风险、AI 或验证选择时，再触发对应 `areaforge-*` skill；变更 skill 后运行 `pnpm skills:validate`。

## 收尾报告

每次完成后必须说明：

- 改了什么。
- 为什么这样改。
- 跑了哪些验证。
- 哪些没有验证。
- 还有哪些风险或后续任务。
