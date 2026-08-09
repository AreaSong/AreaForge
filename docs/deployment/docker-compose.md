# Docker Compose 部署

第一版部署目标：

- `web`：Next.js standalone 应用。
- `postgres`：PostgreSQL 16。
- `uploads`：附件持久化目录。

部署原则：

- PostgreSQL 不暴露公网端口。
- 上传目录不由 Nginx 直接暴露。
- 正式发布使用固定版本 tag，不直接依赖 `latest`。
- 发布前备份数据库和上传目录。
- migration 由部署流程执行，不提供网页按钮。
- GitHub Release 自动更新由服务器侧 updater 执行，不把 `docker.sock`、备份、恢复或 migration 能力放进 Web runtime。

## 本地开发

本地使用 `docker-compose.yml`。PostgreSQL 默认映射到宿主机 `127.0.0.1:54329`，和 `.env.example`、根脚本默认 `DATABASE_URL` 一致：

```bash
docker compose up -d postgres
```

如果 54329 已被其他项目占用，可以临时换端口：

```bash
POSTGRES_PORT=54330 docker compose up -d postgres
DATABASE_URL=postgresql://areaforge:areaforge@127.0.0.1:54330/areaforge pnpm db:migrate:dev
```

Web 开发仍推荐本机运行：

```bash
pnpm dev
```

如需本地完整容器启动：

```bash
docker compose up -d --build
```

## 本地 UI 测试池

需要以 production-build 容器保存当前 UI 候选或并排比较时，统一使用 `areaforge-dev-test` 测试池：

```bash
pnpm dev:test:refresh -- --note "当前迭代"
pnpm dev:test:snapshot -- --note "比较候选"
pnpm dev:test:latest
pnpm dev:test:list
pnpm dev:test:logs -- --slot 2
pnpm dev:test:stop -- --slot 2
pnpm dev:test:doctor
```

测试池固定三个 Web 槽位：

| 槽位 | 容器 | 默认地址 |
|---|---|---|
| 1 | `areaforge-dev-test-1` | `http://127.0.0.1:43171` |
| 2 | `areaforge-dev-test-2` | `http://127.0.0.1:43172` |
| 3 | `areaforge-dev-test-3` | `http://127.0.0.1:43173` |

`refresh` 默认重新构建并事务替换最新槽位，也可通过 `--slot 1|2|3` 指定槽位；没有实例时创建槽位 1。`snapshot` 优先使用空槽位，三个槽位已满时按候选进入池的时间淘汰最老实例。新镜像先完成构建，交换槽位时才加锁；旧容器在新实例通过 `/api/health` 的 commit、source fingerprint 和 build ID 校验后删除，失败则恢复旧容器。`--dry-run` 只显示将使用或淘汰的槽位，不构建镜像或修改 Docker 资源。

`pnpm dev:test:latest -- --json` 是“最新测试实例”的机器源事实：latest 按最后一次成功进入池的 generation、容器创建时间和 ID 确定，与槽位数字大小无关。`list`、`doctor`、`refresh`、`snapshot` 和 `stop` 使用同一选择函数并返回同一 `latest` 对象；健康检查失败并回滚的候选不会成为 latest，删除当前 latest 后则回退到剩余实例中最后成功的一个。任务收尾必须区分“本次已更新测试池”和“本次未更新、仅报告既有 latest”，并在已更新时明确报告 slot、port 和 URL。

候选构建先使用宿主机已安装的锁定依赖生成 Next.js standalone production build，再通过 `infra/docker/web.dev-test.Dockerfile` 封装运行产物；测试镜像不会在每次刷新时重新从 registry 下载整个 workspace 依赖。正式 Release 仍只使用 `infra/docker/web.Dockerfile`，测试池不改变生产构建链。

测试池只管理同时具有 `com.areaforge.dev-test.pool=areaforge-dev-test` ownership label 和固定槽位名的容器及镜像。同名但无 label 的容器会阻断操作，不会被删除。Web 端口只绑定 `127.0.0.1`；默认端口可通过 `AREAFORGE_DEV_TEST_PORTS=<port1>,<port2>,<port3>` 整体覆盖，但三个端口必须固定、唯一且位于 `1024-65535`。

浏览器/Playwright 验收必须复用 `pnpm dev:test:latest -- --json` 返回的 URL，不得为每个对话、页面或截图创建新的 Web 容器。若外部验收工具创建 `areaforge-v11browser-runtime-*` 一次性 runtime，必须在验收结束时清理；测试池不会接管这类容器，也不会把它们算入三个 slot。

三个 Web 实例共享 `apps/web/.env.local` 指向的本地 PostgreSQL 和 `areaforge-dev-test-uploads` volume，以相同数据比较 UI。管理器只接受 loopback PostgreSQL 地址和 `areaforge` dev/test/local 数据库名，强制 `AI_ENABLED=false`，不读取生产 `.env`，不运行 migration，不清空数据库，不删除 uploads volume，也不执行全局 Docker prune。共享 PostgreSQL 不计入三个 Web 实例名额。历史 `areaforge-v11*` 容器和镜像不由测试池自动接管或清理。

## 生产建议

生产使用 `docker-compose.prod.yml`，不要叠加本地开发 compose 文件：

```bash
docker compose -f docker-compose.prod.yml up -d
```

第一次自托管建议先按 `operator-onboarding.md` 完成生产 env、管理员密码、私有上传目录、Nginx HTTPS、GitHub Release updater、备份恢复、smoke 和残余风险检查。

生产环境要求：

- `postgres` 不映射公网端口。
- `web` 只绑定 `127.0.0.1:${WEB_PORT:-3000}`，由 Nginx 反代访问。
- `.env` 只保存在服务器，权限收紧。
- `POSTGRES_PASSWORD`、`AUTH_SESSION_SECRET`、`AI_API_KEY`、`AI_CREDENTIALS_ENCRYPTION_KEY` 使用强随机值；后者用于账户 Provider 密文，必须只存在服务端环境。
- 上传目录和数据库卷必须备份。

发布前必须先备份数据库和上传目录，再执行 Prisma migration deploy；失败时回滚镜像版本，并使用备份恢复数据库和上传目录。

当前远端生产事实：`forge.areasong.top` 的 AreaForge Web 容器绑定 `127.0.0.1:3020->3000/tcp`，公网经 Nginx HTTPS 访问 `https://forge.areasong.top/`；该服务器上的 `127.0.0.1:3000` 是 Grafana，不是 AreaForge。生产健康检查为 `https://forge.areasong.top/api/health`，当前返回 `version=0.1.7`。

## GitHub Release 自动更新

远端单机部署可以使用 `docs/deployment/github-release-updater.md` 中的服务器侧 updater。该 updater 从 GitHub Release 读取 `areaforge-release-manifest.json`、`SHA256SUMS` 和 `SHA256SUMS.sig`，拉取 `image@sha256`，备份数据库和上传 volume，通过 `infra/docker/migration.Dockerfile` 构建的一次性 migration image 执行 `pnpm db:migrate:deploy`，再切换 `AREAFORGE_IMAGE` 和 `APP_VERSION`。

默认策略应为 `AREAFORGE_AUTO_APPLY=none`。若要定时自动应用 patch 版本，再改为 `patch`，并要求 release manifest 中 `autoApply.patch=true`。minor/major 更新建议人工执行 `apply --yes --tag <tag>`。

当前远端服务器已安装 `cosign v3.1.1`，`AREAFORGE_REQUIRE_SIGNATURE=true`，`AREAFORGE_COSIGN_PUBLIC_KEY=/etc/areaforge/cosign.pub`，并通过 GitHub Release `v0.1.7` 完成签名校验更新。当前记录见 `docs/development/release-v0.1.7-record.md`；`docs/development/package-e-remote-github-release-record.md` 保留 `v0.1.5` 历史记录。
