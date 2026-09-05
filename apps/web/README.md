# AreaForge Web

`apps/web` 是 AreaForge 的 Next.js 私有 Web 应用。它承载开始学习、今日、知识、检验、路线、确认中心、设置以及版本中心 UI。

最新稳定 GitHub Release 为 `v1.2.0`；公网 `https://forge.areasong.top/` 生产和回滚基线仍为 `v1.1.1`。本次 `v1.2.0` 发布未执行 production apply；Web 运行时仍只处理业务请求和受控更新请求写入，不直接执行 Docker、备份、恢复、migration 或服务器命令。

当前 checkout 的 package version 为 `1.2.0`，对应已发布的 `v1.2.0` 稳定 Release；生产仍未更新，生产证据与 Release 工件证据保持分离。

当前分支还包含 v1.4 身份、Workspace 与 Membership 本地候选：账户安全、邀请制开户、设备会话、Workspace 生命周期和成员生命周期已进入最终验证，默认 `AUTH_MULTI_USER_ENABLED=false`。它尚未形成新 Release 或 production apply，现有学习正文继续保持 owner-only。

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
pnpm ops:v11:ai-provider-preference:selftest
pnpm check
```

## 共享能力边界

- UI 原语归口 `components/ui/**`；业务 TSX 不新增非豁免 raw `input/select/textarea/button`。
- 浏览器请求归口 `lib/api/**`，共享 DTO 归口 `lib/contracts/**`；浏览器组件和 client adapter 不直接 `fetch` 或解析 `response.json()`。
- 浏览器 storage 通过 `lib/client/storage-port.ts` / `draft-store.ts` 访问，`401/409` 通过 `lib/client/api-errors.ts` 识别；组件不直接访问 storage global 或显式比较这两个状态码。
- latest-wins 请求和互斥批次统一使用 `lib/client/operation-gates.ts`；React state 负责 pending 呈现，操作门只负责拒绝迟到响应、重复启动和过期释放。
- 带 revision 的本机草稿必须保存 `baseRevision`，stale/legacy 草稿不能直接提交；列表选择的唯一 identity 与去重 fingerprint 不得复用短哈希。
- `lib/contracts/study.ts`、`lib/study/service.ts`、`lib/study/types.ts` 已移除，不得恢复为兼容门面或重新导入。
- 非测试 TSX 文件不得超过 500 行；单函数超过 50 行只作为 observation/warning，不是硬门禁。

专项治理验证：

```bash
pnpm web:shared-boundary
pnpm web:api-parser-boundary
pnpm web:ui-primitives-boundary
pnpm web:client-boundary
pnpm web:component-complexity
pnpm web:shared-boundary:selftest
pnpm web:api-parser-boundary:selftest
pnpm web:ui-primitives-boundary:selftest
pnpm web:client-boundary:selftest
pnpm web:component-complexity:selftest
pnpm web:governance:typecheck
```

机器清单与长期契约见 `docs/architecture/web-shared-capability-inventory.json`、`docs/ux/shared-ui-foundations.md` 和 `docs/development/validation-matrix.md`。

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
- 页面和浏览器 client 通过 canonical contract、API adapter 与具体 domain service 协作，不依赖已删除的 study facade。
- AI 只生成建议或草稿，不直接覆盖用户记录；普通首页 SSR 不触发真实 provider 外呼。八条显式 AI POST 路径还要求当前浏览器在 `/settings/ai` 明确开启偏好，缺失或畸形时默认使用本地规则；Provider key 只存在于服务端环境。
- 附件不从 `public/` 暴露，下载必须走鉴权 API。
- `/api/system/update-requests` 只写入受控请求；真正的更新由服务器侧 update-agent/updater 执行。
- 更新请求入队前会做本地只读状态校验：同版本或旧版本 `apply`、无回退目标的 `rollback`、未变化的自动策略不会写入 request 文件。
- 不挂载 `docker.sock`、生产 `.env`、备份目录或签名私钥到 Web runtime。

## 关键入口

- 首页作战台：`app/page.tsx`
- 登录：`app/login/page.tsx`
- 账户安全：`app/(app)/settings/account/page.tsx`
- Workspace 与成员：`app/(app)/settings/workspaces/page.tsx`
- 忘记/重置密码与邀请：`app/forgot-password/page.tsx`、`app/reset-password/page.tsx`、`app/invitations/accept/page.tsx`
- 开始学习：`app/(app)/focus/page.tsx`
- 今日与投入安排：`app/(app)/today/page.tsx`、`app/(app)/roadmap/allocation/page.tsx`
- 知识与考纲：`app/(app)/knowledge/page.tsx`、`app/(app)/knowledge/syllabi/page.tsx`
- 检验与模拟：`app/(app)/test/page.tsx`
- 报告与确认中心：`app/(app)/roadmap/reviews/page.tsx`、`app/(app)/confirmations/page.tsx`、`components/global-confirmation-center.tsx`
- 设置和版本中心：`app/settings/page.tsx`
- 系统更新 API：`app/api/system/**`
- 身份与成员 API：`app/api/auth/**`、`app/api/workspace-invitations/**`、`app/api/exam-workspaces/**/members/**`

更完整的源事实见根目录 `README.md`、`docs/README.md` 和 `docs/development/docs-100-completion-record.md`。

## 发布

AreaForge 不使用 Vercel 作为当前生产目标。当前生产路径是 Docker Compose + PostgreSQL + Nginx HTTPS + GitHub Release updater。

首次自托管上手见根目录 `docs/deployment/operator-onboarding.md`。发布和自动更新细节见 `docs/deployment/github-release-updater.md` 与 `docs/development/production-release-runbook.md`。
