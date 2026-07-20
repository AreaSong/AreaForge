# FAQ 与排障（Troubleshooting）

## 定位

本文回答使用和自托管 AreaForge 时的常见问题。深入的部署与恢复流程见 `docs/deployment/**`；向维护者求助的入口见根目录 [SUPPORT.md](../../SUPPORT.md)。

## 登录与账号

**忘记管理员密码怎么办？**
用 `pnpm auth:hash '<新密码>'` 生成新哈希，更新环境文件里的 `AUTH_ADMIN_PASSWORD_HASH`，重启应用后运行 `pnpm db:seed`（seed 会按 `AUTH_ADMIN_EMAIL` 更新该账号的密码哈希）。

**登录提示尝试次数过多？**
登录按 IP + 邮箱限速，返回 `TOO_MANY_ATTEMPTS` 时等待响应中的 `retryAfterSeconds` 后再试。失败尝试会写入审计事件。

**能注册第二个账号吗？**
不能。AreaForge 是单管理员私有应用，没有注册入口，多用户不在产品范围内。

## 日常使用

**为什么今天没算打卡？**
打卡不等于打开应用。必须完成至少一次有效学习动作——通常是结束一段计时并提交收口记录。进行中的计时只做实时展示，结束后才固化到当日快照。

**计时器还在跑，页面刷新/换设备了怎么办？**
进行中的计时保存在服务端，刷新或重新登录后会自动恢复。同一时间只允许一个进行中的计时，想开新的先结束旧的。

**任务没完成会怎样？**
自动进入任务债务池，不会消失。在首页任务区可以补做、延期、拆小、放弃或改成复习任务；系统的重排建议永远需要你勾选并确认后才应用。

**为什么节点标不了"掌握"？**
掌握证明需要证据。服务端返回 `MASTERY_PROOF_REQUIRED` 说明该节点缺少关联的任务、计时、笔记、错题或复测证据；先补最小证据（比如一条理解笔记 + 一次练习记录）再提交。

## 附件与上传

**上传失败怎么排查？**
按顺序检查三件事：文件类型是否在 `ALLOWED_UPLOAD_MIME` 白名单内（默认 PNG/JPEG/WebP/PDF）；文件是否超过 `MAX_UPLOAD_MB`（默认 20MB）；`UPLOAD_DIR` 是否存在且应用可写（本地开发常见问题是没有把它改成本机可写的绝对路径）。

**附件的原始文件在哪？**
文件本体在 `UPLOAD_DIR`，数据库只存 metadata 和 hash。不要直接在目录里增删文件；数据库与目录的一致性可用只读对账 `pnpm attachment:reconciliation` 检查，它只报告、不清理。

## AI

**AI 建议按钮不可用？**
`AI_ENABLED` 默认是 `false`。启用需要同时配置 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`（OpenAI-compatible），见 [配置参考](configuration.md)。

**AI 调用失败或很慢？**
超时（`AI_TIMEOUT_MS`）和重试（`AI_MAX_RETRIES`）用尽后会自动回退本地规则，功能不中断。持续失败先检查 base URL 连通性、key 有效性和模型名。

**AI 会看到我的复盘和动机档案吗？**
默认不会。动机档案、完整情绪记录、完整复盘正文、附件内容都在默认排除列表里，除非显式打开 `AI_ALLOW_SENSITIVE_CONTEXT`（不建议）。

## 部署与运行

**应用起不来或端口冲突？**
本地开发默认 Web 用 3000、PostgreSQL 用 54329（`POSTGRES_PORT`）；冲突时改 `.env` 对应端口。启动报配置错误时优先核对 `DATABASE_URL` 和不少于 32 字符的 `AUTH_SESSION_SECRET`——配置由 schema 严格校验，缺项会直接失败。

**怎么确认服务健康？**
`GET /api/health` 返回运行版本和状态；`/settings` 的版本中心展示运行状态与更新通道。服务器侧还可运行只读诊断：`pnpm ops:readiness:summary`、`pnpm ops:status --summary`。

**数据备份和恢复怎么做？**
至少备份 PostgreSQL dump 和上传目录两部分，流程见 [备份与恢复](../deployment/backup-restore.md)。恢复前先在演练环境验证；`pnpm ops:backup-restore:preview` 可生成 metadata-only 缺口预览，它不执行备份或恢复。

**更新失败或想回滚？**
版本中心只提交受控请求，真正的更新在服务器侧执行。排查顺序：看 update-agent 状态（版本中心或 ops-state 的 status 记录）、看服务器侧更新记录目录、按 [GitHub Release updater](../deployment/github-release-updater.md) 的回滚节执行回滚。更新器默认 `AREAFORGE_AUTO_APPLY=none`，不会静默更新。

**怀疑数据状态不对（比如出现两个进行中的计时）？**
运行只读诊断 `pnpm ops:data-integrity:doctor`，它会报告重复活跃计时、任务/计时状态矛盾和附件对账缺口，但不修复数据；结果异常时先保留现场再处理。

## 求助

**向维护者反馈问题时带什么信息？**
不要贴生产日志、环境文件或密钥。用 `pnpm ops:support:bundle-preview` 生成 metadata-only 支持包预览（只含版本、命令名、文档入口等安全事实），随问题描述一起提交，入口见 [SUPPORT.md](../../SUPPORT.md)。
