# 配置参考（Configuration）

## 定位

本文集中解释 AreaForge 应用的环境变量：含义、默认值和注意事项。模板见根目录 [.env.example](../../.env.example)；服务器侧更新器有独立的配置文件（`ops/github-release-updater/areaforge-updater.env.example`），不在本文范围内，见 [GitHub Release updater](../deployment/github-release-updater.md)。

Web runtime 的变量由 `packages/config` 的 schema 统一解析校验；标注"部署层"的变量由 Docker Compose、备份或运维脚本消费，Web runtime 不直接读取。

## 基础运行

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | Node 运行环境；生产用 `production` |
| `APP_ENV` | `development` | 应用环境标识，随部署环境区分 |
| `APP_URL` | `http://127.0.0.1:3000` | 应用对外地址；生产填 HTTPS 域名 |
| `APP_VERSION` | `0.1.0` | 应用版本号；本地与根 `package.json` 保持一致，生产由发布流程注入，`/api/health` 会返回该值 |
| `WEB_PORT` | `3000` | 部署层。Web 容器绑定的本机端口，生产只绑定 `127.0.0.1` 由 Nginx 反代 |
| `AREAFORGE_IMAGE` | — | 部署层。生产 Web 镜像引用，应使用带 digest 的不可变引用（`ghcr.io/...@sha256:...`） |
| `AREAFORGE_OPS_STATE_DIR` | `/app/ops-state` | 容器内 ops-state 挂载点，版本中心从这里读取 update-agent 状态 |
| `AREAFORGE_OPS_STATE_HOST_DIR` | `/opt/areaforge/ops-state` | 部署层。宿主机 ops-state 目录 |

## 数据库

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | 必填 | PostgreSQL 连接串，结构化状态的唯一源事实 |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_PORT` | 见模板 | 部署层。Compose 启动 PostgreSQL 容器用；生产必须换强随机密码且不暴露公网端口 |

## 认证

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AUTH_SESSION_COOKIE_NAME` | `af_session` | 会话 Cookie 名 |
| `AUTH_SESSION_SECRET` | 必填 | 会话签名密钥，至少 32 字符随机值；泄露等于会话可伪造 |
| `AUTH_ADMIN_EMAIL` | 可选 | 管理员邮箱，`pnpm db:seed` 时写入 |
| `AUTH_ADMIN_PASSWORD_HASH` | 可选 | 管理员密码的 scrypt 哈希，用 `pnpm auth:hash '<密码>'` 生成；不要填明文密码 |

两个 `AUTH_ADMIN_*` 都存在时 seed 会创建或更新管理员；否则 seed 要求库里已有管理员。修改密码：重新生成哈希、更新环境文件、重启应用后再跑一次 `pnpm db:seed`。

## AI

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AI_ENABLED` | `false` | 总开关；关闭时全部走本地规则，AI 相关入口降级 |
| `AI_BASE_URL` | 可选 | OpenAI-compatible 服务地址（含 `/v1`） |
| `AI_API_KEY` | 可选 | API key，只放服务器环境文件，不进 Git、不进浏览器 |
| `AI_MODEL` | 可选 | 模型名 |
| `AI_TIMEOUT_MS` | `30000` | 单次调用超时毫秒数，超时回退本地规则 |
| `AI_MAX_RETRIES` | `2` | 失败重试次数 |
| `AI_LOG_PROMPTS` | `false` | 是否在日志记录 prompt；保持 `false`，开启会把学习内容写进日志 |
| `AI_ALLOW_SENSITIVE_CONTEXT` | `false` | 是否允许把敏感上下文（完整复盘正文等）发给 AI；默认关闭是隐私边界，改动前先读 [文件与 AI 安全](../security/file-ai-safety.md) |
| `AI_PAYLOAD_BINDING_SECRET` | （可选）≥32 字符 | 四类显式 AI 草稿的 purpose-separated HMAC 与 opaque preview token 绑定密钥；**仅服务端**，禁止 `NEXT_PUBLIC_*`；缺失或过短时只阻止四类草稿外呼并稳定 fallback，不影响任务/计时/导入 preview |

## 上传与附件

| 变量 | 默认值 | 说明 |
|---|---|---|
| `UPLOAD_DIR` | `/app/uploads` | 附件本体目录；必须在 `apps/web/public` 之外，本地开发改成本机可写绝对路径 |
| `MAX_UPLOAD_MB` | `20` | 单文件大小上限 |
| `ALLOWED_UPLOAD_MIME` | `image/png,image/jpeg,image/webp,application/pdf` | 允许的 MIME 类型白名单 |

附件只通过鉴权 API 访问，数据库存 metadata 与 hash，文件本体在 `UPLOAD_DIR`；备份必须同时覆盖数据库和上传目录。

## 日志与备份（部署层）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LOG_LEVEL` | `info` | 预留日志级别约定 |
| `TRUST_PROXY` | `true` | 反向代理部署标记，配合 Nginx 场景保留 |
| `BACKUP_DIR` | `/backups` | 备份产物目录，由服务器侧备份/恢复流程消费 |
| `BACKUP_RETENTION_DAYS` | `14` | 备份保留天数约定 |

## 修改配置的注意事项

- 生产环境文件只放服务器（如 `/opt/areaforge/.env.production`，权限 `600`），任何密钥不进 Git。
- 改动认证、AI、上传相关变量属于安全边界变化，先读 [认证与安全](../architecture/auth-security.md) 和 [文件与 AI 安全](../security/file-ai-safety.md)。
- 更新器（自动更新策略、签名校验、cosign 公钥）的配置独立于本文件，安全默认值是 `AREAFORGE_AUTO_APPLY=none` + 强制签名校验。
