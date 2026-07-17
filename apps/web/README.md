# AreaForge Web

`apps/web` 是 AreaForge 的 Next.js 私有 Web 应用。它承载作战台、任务、计时、复盘、考纲、笔记附件、统计、报告、模拟考试、阶段调整和版本中心 UI。

当前线上版本为 `0.1.7`，公网入口为 `https://forge.areasong.top/`。Web 运行时只处理业务请求和受控更新请求写入，不直接执行 Docker、备份、恢复、migration 或服务器命令。

## Getting Started

在仓库根目录启动本地开发：

```bash
pnpm dev
```

默认开发数据库连接与根 `.env.example`、根脚本和本地 `docker-compose.yml` 保持一致：

```text
postgresql://areaforge:areaforge@127.0.0.1:54329/areaforge
```

## 常用验证

```bash
pnpm --filter @areaforge/web typecheck
pnpm --filter @areaforge/web lint
pnpm --filter @areaforge/web build
pnpm check
```

## 本地真实体验 Smoke

仓库提供写入型本地 UX smoke，用于验证登录、任务、计时收口、每日复盘、笔记附件、错题、大纲、模拟考试、阶段草稿、版本中心请求和主要页面 SSR。它只允许打到 `localhost` / `127.0.0.1` / `[::1]`，任何非本地 URL 和 `AREAFORGE_SMOKE_ALLOW_NON_LOCAL` 配置都会直接失败；同时必须显式设置 `AREAFORGE_SMOKE_ALLOW_WRITES=true`，避免误跑到生产。脚本会在首个合成写入前检查不存在活跃计时，并要求 `AREAFORGE_SMOKE_PASSWORD_FILE` 是绝对路径、单一普通文件、仅 owner 可读（`0400`/`0600`）；不接受 `AREAFORGE_SMOKE_PASSWORD` 明文环境变量。

示例：

```bash
AREAFORGE_SMOKE_BASE_URL=http://127.0.0.1:3102 \
AREAFORGE_SMOKE_EMAIL=smoke@areasong.local \
AREAFORGE_SMOKE_PASSWORD_FILE=/private/tmp/areaforge-smoke-password \
AREAFORGE_SMOKE_ALLOW_WRITES=true \
pnpm smoke:local-ux
```

密码文件准备后应执行 `chmod 600 /private/tmp/areaforge-smoke-password`（或使用 `0400`），并运行 `pnpm smoke:local-ux:selftest` 验证本地 URL、活跃计时、密码文件和结构化失败边界。

macOS 上 `/tmp` 通常是指向 `/private/tmp` 的符号链接；附件安全检查会拒绝符号链接上传根。做本地附件 smoke 时，`UPLOAD_DIR` 使用真实路径，例如 `/private/tmp/areaforge-ux-smoke-uploads`。

若这次验证用于关闭体验残余项或 release/update 交接，还需要按 `docs/development/product-experience-review-record-template.md`
记录 desktop/mobile 浏览器观察或截图，并运行：

```bash
pnpm experience:review:validate <product-experience-review-record.md|txt>
```

涉及 Prisma schema、上传、AI、部署、备份恢复或自动更新时，还需要按根目录文档选择专项验证。

## 运行边界

- 页面和组件不直接调用 Prisma，数据库访问集中在 `packages/db` 和 Web service 层。
- AI 只生成建议或草稿，不直接覆盖用户记录；普通首页 SSR 不触发真实 provider 外呼。
- 附件不从 `public/` 暴露，下载必须走鉴权 API。
- `/api/system/update-requests` 只写入受控请求；真正的更新由服务器侧 update-agent/updater 执行。
- 更新请求入队前会做本地只读状态校验：同版本或旧版本 `apply`、无回退目标的 `rollback`、未变化的自动策略不会写入 request 文件。
- 不挂载 `docker.sock`、生产 `.env`、备份目录或签名私钥到 Web runtime。

## 关键入口

- 首页作战台：`app/page.tsx`
- 登录：`app/login/page.tsx`
- 笔记与附件：`app/notes/page.tsx`
- 考纲与作战地图：`app/syllabus/page.tsx`
- 报告：`app/reports/page.tsx`
- 模拟考试与阶段计划：`app/simulation/page.tsx`
- 设置和版本中心：`app/settings/page.tsx`
- 系统更新 API：`app/api/system/**`

更完整的源事实见根目录 `README.md`、`docs/README.md` 和 `docs/development/docs-100-completion-record.md`。

## 发布

AreaForge 不使用 Vercel 作为当前生产目标。当前生产路径是 Docker Compose + PostgreSQL + Nginx HTTPS + GitHub Release updater。

首次自托管上手见根目录 `docs/deployment/operator-onboarding.md`。发布和自动更新细节见 `docs/deployment/github-release-updater.md` 与 `docs/development/production-release-runbook.md`。
