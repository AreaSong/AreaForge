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
| `AUTH_MULTI_USER_ENABLED` | `false` | v1.4 邀请、成员和多 Workspace 选择闸门；只有 migration、隔离验证和 SMTP 配置完成后才在目标环境开启 |
| `AUTH_RBAC_ENABLED` | `false` | v1.5 角色、分享、Coach 与 Operator API 闸门；默认关闭，需独立确认与隔离验证 |
| `DATA_LIFECYCLE_ENABLED` | `false` | 数据任务/脱敏预览总闸门；单独开启不生成文件，不启用物理删除或生产操作 |
| `DATA_EXPORT_ENABLED` | `false` | 本人数据/READY 附件真实导出、独立 EXPORT 处理器与下载闸门；须同时开启生命周期开关并配置私有目录，执行前仍须环境对应的确认 |
| `RANKING_ENABLED` | `false` | v1.8 私有挑战/排名候选闸门；默认关闭，不开放公开榜或通知外呼 |
| `RANKING_PROJECTION_ENABLED` | `false` | 独立排名投影故障开关；关闭时挑战/个人学习主链仍可用，但投影读取与重建 fail closed |
| `RANKING_REBUILD_QUEUE_ENABLED` | `false` | 持久排名重建开关；须与 AUTH/RBAC、排名/投影及 worker 总开关同时满足，在入队、准备和提交时检查；不开放公开榜 |
| `PLATFORM_NOTIFICATIONS_ENABLED` | `false` | v1.8/v1.9 持久通知中心开关；关闭时排名流程不读写 `UserNotification`，不影响既有前台浏览器提醒 |
| `PLATFORM_NOTIFICATION_QUEUE_ENABLED` | `false` | 将排名通知在业务事务内写入持久 `DataJob`；须同时开启通知总开关，消费前重验权限和源实体；关闭后新事件走直接事务路径，已有队列不自动重放 |
| `DATA_JOB_WORKER_ENABLED` | `false` | 独立执行总开关，排名生产者也检查该许可；`worker:data-jobs:run` 要求非空显式处理器，可用 `--once` 和 `--workspace=<id>` 限定消费；`worker:exports:reclaim` 只回收登记副本，导出关闭后仍可显式运行；Web 不启动 worker |
| `AUTH_ACTION_TOKEN_SECRET` | 多人/邮件流程必填 | 邀请、邮箱验证和密码重置 token 的 purpose-separated HMAC 密钥，至少 32 字符且必须与 session secret 分离 |
| `AUTH_REAUTH_MAX_AGE_SECONDS` | `600` | 高风险成员操作允许的最近重新验证时间 |
| `AUTH_INVITATION_TTL_SECONDS` | `259200` | 邀请链接有效期，默认 72 小时 |
| `AUTH_EMAIL_VERIFICATION_TTL_SECONDS` | `86400` | 邮箱验证链接有效期，默认 24 小时 |
| `AUTH_PASSWORD_RESET_TTL_SECONDS` | `1800` | 密码重置链接有效期，默认 30 分钟 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | 空 / `587` / `false` | server-only 身份邮件传输；`SMTP_SECURE=false` 时强制 STARTTLS，生产配置不完整时 fail closed |
| `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | 空 | SMTP 服务端凭据和发件人；不得由浏览器输入、回显或写入日志 |

两个 `AUTH_ADMIN_*` 都存在且数据库没有账户时，seed 会创建 bootstrap 管理员；数据库已有一个或多个账户时不会静默创建第二个管理员或覆盖现有密码。v1.4 本地候选可在 `/settings/account` 修改密码、管理设备会话并发起验证邮件，在 `/settings/workspaces` 管理邀请和成员；稳定 Release/生产启用前仍以当前线上能力为准。

## AI

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AI_ENABLED` | `false` | 服务端硬闸门；关闭时全部走本地规则，Web 全局开关不能绕过；日常启停在 `/settings/ai` 管理 |
| `AI_BASE_URL` | 可选 | OpenAI-compatible 服务地址（含 `/v1`） |
| `AI_API_KEY` | 可选 | API key，只放服务器环境文件，不进 Git、不进浏览器 |
| `AI_MODEL` | 可选 | 模型名 |
| `AI_TIMEOUT_MS` | `30000` | 单次调用超时毫秒数，超时回退本地规则 |
| `AI_MAX_RETRIES` | `2` | 失败重试次数 |
| `AI_LOG_PROMPTS` | `false` | 是否在日志记录 prompt；保持 `false`，开启会把学习内容写进日志 |
| `AI_ALLOW_SENSITIVE_CONTEXT` | `false` | 是否允许把敏感上下文（完整复盘正文等）发给 AI；默认关闭是隐私边界，改动前先读 [文件与 AI 安全](../security/file-ai-safety.md) |
| `AI_CREDENTIALS_ENCRYPTION_KEY` | （可选）≥32 字符 | Web Provider 凭据的服务端 AES-256-GCM 加密主密钥；仅用于解密当前账户配置，不进入客户端；启用 Web 配置前必须设置 |
| `AI_PAYLOAD_BINDING_SECRET` | （可选）≥32 字符 | 四类显式 AI 草稿的 purpose-separated HMAC 与 opaque preview token 绑定密钥；**仅服务端**，禁止 `NEXT_PUBLIC_*`；缺失或过短时只阻止四类草稿外呼并稳定 fallback，不影响任务/计时/导入 preview |

Provider 有两种来源：部署环境变量是兼容回退；登录用户也可以在 `/settings/ai` 为当前账户填写 Base URL、模型和 API Key。账户配置优先于环境变量，API Key 由服务端使用 `AI_CREDENTIALS_ENCRYPTION_KEY` 以 AES-256-GCM 加密保存，Web 端只允许更新、删除和测试，永远不回显密钥。首次启用 Web 配置前必须设置加密主密钥；删除账户配置不会立即物理删除历史备份中的密文。

即使 `AI_ENABLED=true` 且 Provider 配置完整，外部调用仍按 Web 全局开关和浏览器默认关闭；登录后先在 `/settings/ai` 开启全局 AI，再明确开启当前浏览器偏好。Web 全局开关存入数据库并写入审计事件；浏览器偏好保存在 HttpOnly Cookie 中，清除浏览器数据后恢复关闭。服务端硬闸门关闭时网页不能开启；任一开关关闭或保存失败时继续使用本地规则。

## 上传与附件

| 变量 | 默认值 | 说明 |
|---|---|---|
| `UPLOAD_DIR` | `/app/uploads` | 附件本体目录；必须在 `apps/web/public` 之外，本地开发改成本机可写绝对路径 |
| `EXPORT_DIR` | 未设置 | 导出专属 canonical 私有目录（0700），不得与 `UPLOAD_DIR` 相同或相互嵌套；独立 worker 写入，Web 仅读取已授权包，不静态公开 |
| `MAX_UPLOAD_MB` | `20` | 单文件大小上限 |
| `ALLOWED_UPLOAD_MIME` | `image/png,image/jpeg,image/webp,application/pdf` | 允许的 MIME 类型白名单 |

附件只通过鉴权 API 访问，数据库存 metadata 与 hash，文件本体在 `UPLOAD_DIR`；备份必须同时覆盖数据库和上传目录。
导出目录仅保存有时限的派生副本，不作为备份；开关、资源保护、下载与回收契约见 [本人数据导出](../modules/data-export.md)。

`DATA_DELETE_ENABLED=false` 控制新回收站/删除请求；`DATA_DELETE_WORKER_ENABLED=false` 独立控制删除进程启动，并须同时启用生命周期与删除开关。
Web 永不启动消费者。暂停新请求/进程不移除已有可见性保护，合法取消和恢复仍可进行；生产启用仍需独立 migration/apply 与恢复确认。
详细范围、24 小时冷静期、30 天恢复期及回退限制见[本人数据回收站与删除](../modules/data-deletion.md)。

## 受控运维执行

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPS_EXECUTION_ENABLED` | `false` | Web 创建带完整前态和不可变目标的执行绑定；关闭时旧请求只能预览 |
| `OPS_EXECUTION_CONTEXT_FILE` | 未设置 | 独立执行器生成的只读脱敏前态文件，不是命令或服务器配置 |
| `OPS_EXECUTION_SCOPE_ID` | 未设置 | 必须与前态文件中 root 配置的作用域指纹完全一致 |
| `OPS_EXECUTION_LOCAL_FIXTURE` | `false` | 仅专用合成测试池注入；生产禁止使用合成前态 |
| `OPS_AGENT_ENABLED` | `false` | 独立执行入口的总开关；Web 不读取它来启动进程 |
| `OPS_AGENT_PRODUCTION_ENABLED` | `false` | 生产入口的额外关闭门，仍要求 root 身份、私有配置和独立生产批准 |

Web 只挂载脱敏前态目录为只读，不挂载 root journal、updater 配置、备份、签名私钥或 Docker socket。
确认与审批冻结请求，过期、前态变化或身份变化不得在消费时自动刷新绑定。
执行机制、停止屏障与恢复规则见[受控运维](../modules/controlled-operations.md)；独立进程的配置与隔离验收见[运维执行器](../../ops/controlled-operation-agent/README.md)。

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
