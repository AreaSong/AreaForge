<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AreaForge Web Agent Notes

先遵循仓库根 `../../AGENTS.md`，再遵循本文件的 Next.js 局部提醒。

当前状态：

- 最新稳定 GitHub Release 为 `v1.1.2` / commit `5df38417b701f3511d06db235c5b94755ca03aba`；Release workflow、签名资产与不可变镜像 digest 已严格验证。
- 当前生产与回滚基线仍为 `v1.1.1` / commit `f995310e30c41270ee1e0a1c1ceeae9b6a8017eb`；`v1.1.2` 发布未触发 production apply。
- Package A-E 和 docs 100% 当前证据已闭环。
- Web 版本中心只能提交受控检查、应用、回退或策略请求；服务器侧 root update-agent/updater 执行签名校验、备份、migration、切换和回滚。
- 当前 `AREAFORGE_AUTO_APPLY=none`，不会静默自动更新。
- 当前 checkout 已实现学习行动中心 Batch 3–10、Update Request V2 和发布后产品化修复；`v1.1.1` Release commit 的能力已随 verified production runtime identity 进入线上。

Web 层边界：

- 页面和组件不直接调用 Prisma。
- 普通首页 SSR 不触发真实 AI provider 外呼。
- 附件不放入 `public/`，必须走鉴权 API。
- Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令，也不挂载 `docker.sock`、生产 `.env`、备份目录或签名私钥。
