<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AreaForge Web Agent Notes

先遵循仓库根 `../../AGENTS.md`。根文件的安全、批准、数据和生产边界不可被本文件弱化；本文件只补充 `apps/web` 的 Next.js 和 Web 技术约束。

Next.js 自动生成提醒只适用于 Next route、config、server/client boundary、框架 API 或升级相关改动；本句是对上方自动提醒的适用范围限定。纯文案/CSS、测试 fixture、独立脚本和不使用 Next API 的静态检查不因本块而停工；Next 相关实现缺少所需本地 guide 时暂停该部分并记录环境缺口，其他非 Next 工作继续，不把缺文档当成生产批准，也不豁免根验证矩阵及 UI 验收。

当前共享版本、Release、production 和 Package 状态以仓库根 `AGENTS.md` 的 canonical 当前状态为准；本文件只保留 Web-specific 状态和边界，避免复制易漂移的版本事实。下方若保留版本锚点，仅作为 docs readiness 的受校验根状态镜像，不是独立 source of truth。

- Web 生产交付记录锚点为 `v1.1.1` / commit `f995310e30c41270ee1e0a1c1ceeae9b6a8017eb`；新鲜公网 health 已观测到 `v1.2.0`，但其服务器交付证据未核验。该记录锚点不代替实际状态，详细差异以根入口和 operational-readiness 为准。
- 当前分支的 Web-specific AUTH/RBAC/Coach、数据任务/删除预览、受控运维请求、私有挑战/排名投影和持久排名通知仍是默认关闭的本地候选；敏感学习正文只允许资源 owner 或有效 grant 读取。候选 migration、完整浏览器矩阵、受保护 PR/合并、Release 和生产证据是否完成，回到根状态入口和对应 evidence 文档核对。
- Web 版本中心只能提交受控检查、应用、回退或策略请求；服务器侧 root update-agent/updater 执行签名校验、备份、migration、切换和回滚。当前 `AREAFORGE_AUTO_APPLY=none`，不会静默自动更新。
- 学习行动中心 Web 入口、Batch 和发布后修复状态以 `apps/web/README.md` 与根状态入口为准；本文件不复制历史 Release 记录。

Web 层边界：

- QUOTA 仅在已授权新请求的共同入队处计量；开启时三域使用 Serializable，坏限额不影响通用身份/学习/控制路径。错误反馈归 API 层，不在类型专用 contracts 导出运行时函数；范围与验证见 `docs/modules/data-job-quotas.md`。

- 搜索索引仅收录当前用户在所选工作区有权查看的标题；Web 只申请/控制本人任务，独立 worker 原子发布。失效或关闭时安全直查，身份/工作区变化丢弃旧回执；默认 `SEARCH_INDEX_ENABLED=false` / `SEARCH_INDEX_QUEUE_ENABLED=false`。本地专项与交付限制以 `tasks/backlog/0045-platform-hardening.md` 为准。

- 页面和组件不直接调用 Prisma。
- 共享 UI 原语归口 `components/ui/**`；业务 TSX 不新增非豁免 raw `input/select/textarea/button`。豁免和 legacy budget 以 `docs/architecture/web-shared-capability-inventory.json`、`docs/development/validation-matrix.md`、`scripts/quality/web-ui-primitives-boundary.ts` 为准，测试、fixture 和 generated 目录不被误当成生产业务 TSX。
- 浏览器请求和 DTO 分别归口 `lib/api/**`、`lib/contracts/**`；浏览器组件/client adapter 不直接 `fetch`、解析 response body、访问 storage global 或显式比较 `401/409`。
- latest-wins 请求和互斥批次使用 `lib/client/operation-gates.ts`；pending 由 React state 呈现，请求开始时冻结输入/context/storage key 或 metadata 快照，迟到响应不能提交或释放新批次。
- 带 revision 的草稿必须持久化 `baseRevision`；stale/legacy 草稿先进入冲突。选择项唯一 identity 与完整 fingerprint 分离，短哈希不能单独承担 React key、删除或去重语义。
- `lib/contracts/study.ts`、`lib/study/service.ts`、`lib/study/types.ts` 已删除且禁止恢复；浏览器组件和 client 不 runtime-import `lib/study/**`。
- 非测试 TSX 使用 500 行硬上限；单函数超过 50 行只产生 observation/warning，不得误写成硬门禁。涉及 Web runtime/shared-boundary 文件时按 `docs/development/validation-matrix.md` 选择受影响专项 gate；需要完整 Web governance 证据时再运行五个专项 gate（`web:shared-boundary`、`web:api-parser-boundary`、`web:ui-primitives-boundary`、`web:client-boundary`、`web:component-complexity`）及各自 `:selftest` 和 `pnpm web:governance:typecheck`。纯文案、CSS、测试/fixture 或非 Web 目录不自动触发整套 gate。
- 普通首页 SSR 不触发真实 AI provider 外呼。
- 附件不放入 `public/`，必须走鉴权 API。
- Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令，也不挂载 `docker.sock`、生产 `.env`、备份目录或签名私钥；这是根 `AGENTS.md` 的同一 canonical 禁区，本文件不另行扩大或缩小它。
- 受控运维仅登记冻结绑定与确认/审批/控制，并读取经过校验的脱敏前态/阶段投影。`OPS_EXECUTION_ENABLED=false` 默认关闭；运行中 hold/cancel 保留租约直到独立执行器确认，Web 不启动消费者。当前本地验收和交付状态见 `tasks/backlog/0042-controlled-operations-center.md`。
- 完整数据导出由独立 worker 写入私有 `EXPORT_DIR`，Web 仅申请任务、校验本人下载授权并读取已验证 ZIP；不写归档、不执行副本回收或源数据删除，默认 `DATA_EXPORT_ENABLED=false`。
- 独立删除入口只预览、登记和控制意图，物理删除与恢复重放不在 Web 执行。默认 `DATA_DELETE_ENABLED=false` / `DATA_DELETE_WORKER_ENABLED=false`；最终源码验收与环境限制以 `tasks/backlog/0041-data-lifecycle.md` 为准。
- 排名重建只提交 Owner 显式持久任务并读取经权限/来源/冻结重验的投影；`RANKING_REBUILD_QUEUE_ENABLED=false` 默认关闭且无同步 fallback，Web 不启动消费者。旧身份或挑战版本的迟到回执不得回填新视图；不能验证的榜单返回 stale 和空列表。本地验收与交付状态见 `tasks/backlog/0043-ranking-platform-hardening.md`。
