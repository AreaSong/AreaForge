# Codex 协作工作流

## 定位

AreaForge 采用轻量 Codex 工作流。它吸收 AreaMatrix 的源事实、验证、文件安全、残余风险分类和版本规划思想，也吸收 AreaFlow 的只读 operations readiness 思路，但不引入重型 task-loop、runtime registry、数据库化 residual ledger、command_requests 或自动 prompt 执行队列。

## 工作层次

1. `docs/**`：产品、架构、模块、安全和开发源事实。
2. `workflow/versions/**`：版本级计划、入口条件和验收标准。
3. `tasks/**`：轻量执行任务，不替代 `docs/**`。
4. 代码实现：只在对应源事实和任务边界清楚后推进。

若层次之间冲突，优先更新 `docs/**`，再同步 `workflow/**` 和 `tasks/**`。

仅在用户请求变更且事实已核实时才同步文件；审阅、解释和诊断请求默认只读。实现路径明确、可逆且不触及批准边界的跨文件工作，可给出简明计划后继续。仅当未决选择会改变范围、权限、数据、外部副作用或验收标准时提问；普通工程取舍由代理结合现有模式决定并说明。非阻断漂移不终止独立的安全工作。

## 条件阅读与交接

- 读取适用的 AGENTS 和目标代码/源事实。repo-local skill 的 `Read First` 是按任务选择的来源目录，不是无条件全量阅读清单；选中的指令文件须完整阅读。先读取该 skill 的职责/护栏及对应 reference，再按任务补充相关源事实，不沿全部 sibling skill 链递归展开。
- 同一任务已读且未变化的来源无需重复读取；新任务、范围变化或文件更新时重新检查。缺少关键安全/批准来源时停在受限动作前，仍可继续无关的只读调查。
- handoff 表示当前主代理切换到对应 owner 的规则，不要求新建任务或子代理，也不构成新的用户批准门。主代理持续承担实施、最终验证和收尾责任。
- 数据生命周期由 Security Governance 统一范围和确认；File Storage、AI、SRE 分别核验文件、Provider/费用、生产执行机制并回传。Residual 分类、Doc Sync 同步结论，不把同一范围反复路由回 Security；新边界才重新评估。

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
- 数据库 migration、数据修复、批量删除、不可逆变更。
- 上传、附件删除、备份和恢复。
- 租户隔离、密钥/加密、跨服务写一致性、Saga、Outbox、补偿逻辑，以及支付、计费、配额和计量。
- 数据导出、留存、删除权、用户迁移、AI history/token/cost/provider trace 留存，以及风险等级无法快速判断的破坏性操作。
- AI 默认读取动机档案、情绪记录、复盘正文。
- 部署、服务器命令、一键更新。

要求：

- 先说明影响、风险、验证和回滚。
- 改变高风险边界的实现和真实状态写入须等明确确认后再执行；只读调查、计划、文档准备、静态/mock 检查可先行。确认复用与重新确认条件见 `high-risk-confirmation-packets.md`，不能因切换 skill 重复索要同一批准。
- 结果必须报告未验证项和残余风险。

### Review

用户要求评审或风险检查时，优先输出问题，不先写总结。

要求：

- 按严重度排序。
- 带文件路径和行号。
- 区分 bug、风险、缺测试、缺文档和开放问题。

### 路径审阅分级

提交、PR 或 dirty worktree 的治理改动先运行 `pnpm governance:changed-paths --summary`。它按已见路径输出
`routine`、`protected-path` 或 `high-risk`：前两类仍需对应源事实和验证，`high-risk` 只表示必须进入确认包与专项验证检查，
不等于已经获得确认。涉及现有改动交接时，使用 `docs/development/protected-path-review-record-template.md`
记录审阅范围、worktree hash、protected-path fingerprint、发现与 claim boundary。

### Ops / Release

适合生产健康、备份、update-agent、GitHub Release、签名、自动更新策略、回滚目标和长期运营 readiness。

要求：

- 优先读取 `docs/development/operational-readiness.md` 和 `docs/development/residual-risk-ledger.md`。
- 默认只读检查；写入生产动作必须走高风险确认。
- 发布前本地和 CI 至少运行 `pnpm ops:readiness`、`pnpm github-release-updater:preflight`、`pnpm shellcheck:updater`、`pnpm docs:readiness`、`pnpm risk:preflight` 和 `pnpm check`；发布或更新后用 `pnpm ops:evidence:bundle` 生成运行态证据包 hash，并用 `pnpm ops:alert:preview` 预览告警动作；若形成生产只读 smoke 记录，运行 `pnpm smoke:prod-readonly:validate <record>`；若形成演练记录，运行 `pnpm alert:drill:validate <record>`。
- 残余项使用稳定 ID，不把监控缺口或接受例外混成当前功能未完成。

## 子代理使用规则

- 对具体、独立、可审计的只读探索或核验可主动使用子代理，不要求用户逐次点名；简单任务不为并行而并行。子代理默认不得修改文件或继续派生子代理。
- 主代理处理已知小文件、方案取舍、代码修改和最终验证；确需 worker 时遵守当前运行环境允许的委派权限和互不重叠写集，不把委派当成额外写权限。
- 主代理必须整合子代理结论，不能直接把子代理输出当最终验收。
- 子代理不能替代本地验证，也不能替代高风险确认。

子代理任务必须带明确边界：

```text
scope:
readOnly:
allowedPaths:
forbiddenActions:
forbiddenData:
writeSet:
expectedOutput:
validationHints:
mainAgentMustReview:
```

默认 `forbiddenActions` 至少包含 SSH/生产命令、updater apply、backup/restore、migration、rollback、Docker/Nginx/compose 切换、读取或打印 secrets、提交 secrets、关闭 residual 台账。只读 explorer 不得修改文件；worker 如需改文件，必须有互不重叠的 `writeSet`，且不得回滚他人改动。主代理收口时必须说明采纳了哪些结论、哪些只是建议、哪些仍需本地或 live evidence 验证。

## 开工前检查

正式改代码前，先检查：

- 是否有对应 `docs/**` 源事实。
- 是否有对应 `tasks/**` 任务边界。
- 是否命中高风险边界。
- 是否知道最小验证集合。
- 是否可能影响部署、AI、上传、认证或数据库。

## 失败归因

验证失败时先归因，再修复。不要把所有失败都当成当前补丁 bug，也不要因为某个 validator 通过就扩大完成声明。

优先按以下层级定位：

| 层级 | 常见信号 | 下一步 |
|---|---|---|
| 环境 / 依赖 | 缺 Node、pnpm、Docker、数据库、端口或网络 | 记录环境缺口；不要改业务代码掩盖环境问题 |
| 源事实 / 文档漂移 | README、docs、tasks、workflow、skill 说法冲突 | 先更新源事实，再同步入口和验证矩阵 |
| Schema / migration | Prisma validate、生成或临时库 migration 失败 | 不执行生产 deploy；先固定 migration 边界和回滚说明 |
| API / 业务规则 | typecheck、单测、API smoke 失败 | 从最小复现和调用链修复，避免顺手重构 |
| UI / 体验 | 页面 smoke、截图、移动端布局失败 | 用浏览器证据定位，区分真实体验问题和测试 fixture 问题 |
| Release / 供应链 | tag、GHCR digest、checksum、signature、SBOM/provenance 失败 | 不创建稳定 Release；先补签名/哈希/不可变 digest 证据 |
| Ops / live evidence | readiness、OPS-001、OPS-004、long-term gate 失败 | 区分 `needs_live_evidence` 与服务故障；缺证据不等于可本地伪造 |
| Residual / 完成声明 | residual close、completion evidence、claim scope 失败 | 不关闭台账；补齐 close-condition 证据或保留 blocker |
| Git / worktree | dirty worktree、diff check、无关文件改动 | 不回滚用户改动；只说明相关改动和验证范围 |

若失败属于“预期失败”，例如 `pnpm ops:long-term:gate` 因缺 post-version OPS-001 或 release backup hash 而返回 `needs_live_evidence`，应在收尾报告中明确写成 blocker evidence，不能改到通过。

## 功能完成后的发版规则

当用户明确要求一次功能更新进入线上时，默认走 GitHub Release 路径，而不是只在服务器上手动改代码；仅完成开发、审阅或本地验证不触发发布：

1. 先按 `docs/development/release-train.md` 判断发布范围，再同步 `docs/**`、`tasks/**` 和 `workflow/**`，确认源事实没有漂移。
2. 按 `docs/development/validation-matrix.md` 跑对应验证，至少覆盖 `pnpm check`、`pnpm docs:readiness`、`pnpm risk:preflight`、`pnpm ops:readiness` 和 `git diff --check`；涉及更新器时补跑 `pnpm github-release-updater:preflight` 与 `pnpm shellcheck:updater`。
3. bump 版本并提交干净 commit。
4. 在用户已明确请求发布且前述门禁通过后，创建并推送 `vX.Y.Z` tag，让 `.github/workflows/release.yml` 先执行 validate job，再生成 GitHub Release、GHCR Web/migration 镜像、manifest、`SHA256SUMS` 和 cosign bundle；stable release 缺签名密钥必须失败。
5. 通过 Web 版本中心提交受控更新请求，或由管理员在服务器执行 updater；Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令。
6. 更新成功后，把 Release tag、线上 health、镜像 digest、update-agent 状态、`pnpm ops:evidence:bundle` 的 `bundleHash` 和残余风险同步回发布记录或对应文档。
7. 若本次 Release 用于关闭或复核 `AF-RISK-SC-001` / `AF-RISK-SC-002`，按 `docs/development/release-supply-chain-record-template.md` 记录供应链证据，同时配置 record/assets 运行 `pnpm sc:sc-002:preflight`，再运行 `pnpm release:supply-chain:validate <record> <release-assets-dir> --strict`。

当前仓库已提供 repo-local Codex skills，源目录为 `.codex/skills-src/`，自动发现入口为 `.agents/skills/`。跨多个治理面时先触发 `areaforge-operating-loop` 做分级和 owner 路由；涉及企业治理、发布、真实体验、文档同步、生产运维、观测、事故响应、安全、上传/附件存储、供应链、残余风险、AI 或验证选择时，再触发对应 `areaforge-*` skill；变更 skill 后运行 `pnpm skills:validate`。

完成声明默认遵循 `docs/development/completion-evidence-checklist.md`：先完成实施和受影响文档/metadata/residual 同步，再执行最终验证，最后收尾或进行用户请求的 Git checkpoint；验证后再次编辑须重跑受影响检查。说明证据等级、新鲜验证、未验证项、阻断项、是否需要 Release 和 residual risk IDs。写动作能力默认按 `docs/development/runtime-write-boundary.md` 的 R0-R4 矩阵判断，不能把 preview、本地 smoke、Web update request 或草稿说成生产 apply。

## 收尾报告

每次完成后必须说明：

- 改了什么。
- 为什么这样改。
- 跑了哪些验证。
- 哪些没有验证。
- 还有哪些风险或后续任务。
- 只有本地 UI/浏览器验收、测试池操作或本地测试 URL 查询在范围内时，本地 Docker 可用则运行 `pnpm dev:test:latest -- --json` 并说明本次是否更新测试池；成功 `refresh` 或 `snapshot` 后报告 latest 槽位、端口、URL 和 source fingerprint。未更新只能标为既有实例；source fingerprint 与当前 scope 匹配时可作为当前环境证据，但不能称为本任务更新后的 latest，不匹配或无法核验时不得证明本次源码；范围内但 Docker 不可用时报告 latest 未核验。纯文档、只读审阅和非 Web 任务为不适用，不为收尾启动 Docker 或刷新测试池。
- 浏览器验收沿用同一个 latest URL；禁止按对话、页面或截图启动新的长期 Web 容器。一次性 `areaforge-v11browser-runtime-*` 只允许在验收期间存在，结束后必须删除并在收尾报告中说明清理结果。
