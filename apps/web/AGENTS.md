<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AreaForge Web Agent Notes

先遵循仓库根 `../../AGENTS.md`，再遵循本文件的 Next.js 局部提醒。

当前状态：

- 最新稳定 GitHub Release 为 `v1.2.0` / commit `018cdfaa7a58cea2b32a33acaa0b968f29b9e09a`；Release workflow、签名资产与不可变镜像 digest 已严格验证。
- 当前 checkout 的 package version 为 `1.2.0`，`v1.2.0` annotated tag 和稳定 Release 已发布；production apply 尚未执行。
- 当前生产与回滚基线仍为 `v1.1.1` / commit `f995310e30c41270ee1e0a1c1ceeae9b6a8017eb`；`v1.2.0` 发布未触发 production apply。
- Package A-E 和 docs 100% 当前证据已闭环。
- Web 版本中心只能提交受控检查、应用、回退或策略请求；服务器侧 root update-agent/updater 执行签名校验、备份、migration、切换和回滚。
- 当前 `AREAFORGE_AUTO_APPLY=none`，不会静默自动更新。
- 当前 checkout 已实现学习行动中心 Batch 3–10、Update Request V2 和发布后产品化修复；`v1.1.1` Release commit 的能力已随 verified production runtime identity 进入线上。

Web 层边界：

- 页面和组件不直接调用 Prisma。
- 共享 UI 原语归口 `components/ui/**`；业务 TSX 不新增非豁免 raw `input/select/textarea/button`。
- 浏览器请求和 DTO 分别归口 `lib/api/**`、`lib/contracts/**`；浏览器组件/client adapter 不直接 `fetch`、解析 response body、访问 storage global 或显式比较 `401/409`。
- latest-wins 请求和互斥批次使用 `lib/client/operation-gates.ts`；pending 由 React state 呈现，请求开始时冻结输入/context/storage key 或 metadata 快照，迟到响应不能提交或释放新批次。
- 带 revision 的草稿必须持久化 `baseRevision`；stale/legacy 草稿先进入冲突。选择项唯一 identity 与完整 fingerprint 分离，短哈希不能单独承担 React key、删除或去重语义。
- `lib/contracts/study.ts`、`lib/study/service.ts`、`lib/study/types.ts` 已删除且禁止恢复；浏览器组件和 client 不 runtime-import `lib/study/**`。
- 非测试 TSX 使用 500 行硬上限；单函数超过 50 行只产生 observation/warning，不得误写成硬门禁。相关改动运行五个 `web:*` 专项 gate、各自 selftest 和 `pnpm web:governance:typecheck`。
- 普通首页 SSR 不触发真实 AI provider 外呼。
- 附件不放入 `public/`，必须走鉴权 API。
- Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令，也不挂载 `docker.sock`、生产 `.env`、备份目录或签名私钥。
