<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AreaForge Web Agent Notes

先遵循仓库根 `../../AGENTS.md`，再遵循本文件的 Next.js 局部提醒。

当前状态：

- AreaForge 当前版本为 `0.1.5`，远端 `https://forge.areasong.top/` 已通过 GitHub Release `v0.1.5` 签名更新运行。
- Package A-E 和 docs 100% 当前证据已闭环。
- Web 版本中心只能提交受控检查、应用、回退或策略请求；服务器侧 root update-agent/updater 执行签名校验、备份、migration、切换和回滚。
- 当前 `AREAFORGE_AUTO_APPLY=none`，不会静默自动更新。

Web 层边界：

- 页面和组件不直接调用 Prisma。
- 普通首页 SSR 不触发真实 AI provider 外呼。
- 附件不放入 `public/`，必须走鉴权 API。
- Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令，也不挂载 `docker.sock`、生产 `.env`、备份目录或签名私钥。
