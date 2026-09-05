# 威胁模型

## 主要资产

- 学习记录。
- 动机档案。
- 情绪记录。
- 错题与复盘。
- 上传资料。
- AI Key。
- 数据库连接串。
- 部署密钥。

## 主要风险

- 未登录访问私密数据。
- API 写操作绕过鉴权。
- 上传恶意文件。
- 上传目录被直接暴露。
- AI prompt 泄露敏感内容。
- 日志记录密钥或隐私正文。
- migration 或部署操作造成数据丢失。
- Release 资产或容器镜像被篡改后进入生产。
- Web 运维入口越权执行服务器命令。

## 第一版防线

- 单管理员登录。
- 所有写操作服务端鉴权。
- 上传文件限制类型、大小和路径。
- AI 输出结构化校验。
- 默认不发送动机档案给 AI。
- `.env` 不入库。
- 数据库和上传目录定期备份。
- GitHub Release 更新必须校验 `SHA256SUMS`、cosign bundle 和镜像 digest；生产默认 `AREAFORGE_REQUIRE_SIGNATURE=true`。
- Web runtime 只能提交受控更新请求和读取状态，不能直接执行 Docker、备份、恢复、migration 或服务器命令。

## 细化规则

文件上传、附件访问、AI 调用、备份恢复和高风险确认规则见 `docs/security/file-ai-safety.md`。

## 学习行动中心新增资产

学习行动中心已把考试工作区归属、学习树规范化 Markdown 长期留存与导出、资料 HTTPS 外链、浏览器通知 payload、四类 AI 草稿 HMAC（基于哈希的消息认证码）token 纳入生产威胁面。导入 confirm 的生命周期边界已确认，但 `AF-RISK-DATA-001` 继续保持 `deferred-work`；AI 草稿仍禁止附件与未选择正文，物理删除与完整账户导出不在当前范围。发布后产品化修复尚未形成新的 Release 或 production apply，不改变这些安全边界。规格见 `workflow/versions/v1.1-learning-action-center.md`。

## v1.4 多用户威胁模型增量（本地已确认，未发布/未生产）

当前生产仍按单管理员 owner 语义运行。v1.4 `AUTH` 本地实施已于 2026-09-05 获得确认，当前工作树已形成身份、Workspace 与 Membership 主体代码及隔离 PostgreSQL 验证；默认功能开关仍关闭，最终浏览器/总门禁、Release、生产 migration/apply 和生产 SMTP smoke 尚未完成，因此不能把本地候选写成线上多人安全性已成立。

### 新增资产与信任边界

- 账户状态、邮箱验证、密码重置 token、设备 session 和重新验证时间。
- Workspace Membership、邀请 token、所有权转移和当前 Workspace 选择。
- 浏览器到 Web 的 session/邀请/重置请求，Web 到 PostgreSQL 的身份与成员事务，以及可选 SMTP 投递边界。
- `ExamWorkspace.userId` 兼容 owner 指针与新 Membership 授权源之间的双读、回填和切换边界。

### 主要攻击与失败路径

- IDOR（不安全的直接对象引用）：通过猜测 Workspace、成员、邀请或业务对象 ID 串读、串写或推断资源存在性。
- 邀请/重置 token 明文入库、日志、Referer 或审计，或被重复使用、并发消费、延长有效期。
- 使用别人的已登录 session 接受邀请，或以与邀请邮箱不一致的账户接管 Membership。
- 成员被移除、账户被冻结、密码已重置后，旧 session、长事务或后台操作仍继续提交。
- 删除或降级最后一名 Owner、普通成员自我提权、所有权转移只更新一半。
- 当前 Workspace 选择被当成授权证明，导致切换参数覆盖服务端 actor 或 Membership。
- 进程内限流在重启或多实例环境失效；登录、邀请、重置接口泄露邮箱是否存在。
- SMTP 配置、邮件正文、日志或客户端 bundle 泄露 token、账户列表、内部 URL 或服务端 secret。
- v1.3 应用回滚后无法理解多个 ACTIVE Workspace 或新 Membership，产生错误 owner/Workspace 选择。

### 必须成立的防线

- 所有私有 endpoint 从 session 解析 `actorId/sessionId`，不接受客户端自报 actor；Workspace ID 只作为候选 scope，必须在服务端校验账户状态和有效 Membership。
- 账户冻结、密码重置、撤销全部会话通过 `authRevision` 让旧 session 下一请求失效；高风险写入提交前重新授权并检查最近重新验证时间。
- 邀请与重置 token 使用至少 256 bit 随机值，只保存 purpose-separated hash；一次性消费、固定过期时间、事务 CAS、重放返回相同的非泄露结果。
- 邀请接受必须绑定规范化邮箱；已存在账户需先登录且邮箱一致，新账户只能从有效邀请建立，不提供公开注册。
- v1.4 只有 OWNER/MEMBER 初始语义；角色编辑、Coach、Viewer 和对象分享留到 v1.5。新增 Membership 不自动开放高敏正文或附件。
- 最后一名 Owner 保护、所有权转移、移除和离开在同一 serializable transaction 中执行，并写入不含 token/正文的审计摘要。
- WorkspaceSelection 仅为导航状态；读取、写入、下载和长操作提交都重新调用统一访问判定。跨 Workspace 与不存在对象对非成员返回一致的 404 语义。
- 登录、邀请和重置限流使用 PostgreSQL 持久状态；错误响应不区分邮箱不存在、账户冻结或 token 已被消费。
- 邮件投递采用可替换服务端适配器；生产未配置安全 SMTP 时 fail closed，不从浏览器输入 SMTP secret，不在日志输出完整链接。
- 首次生产开放多人前必须固定 compatibility floor；存在多个 ACTIVE Workspace 后不能直接回滚到不理解 WorkspaceSelection 的 v1.3 二进制。

### 验证门禁

- 两账户/两 Workspace 完整矩阵、邀请重放与并发接受、最后 Owner、冻结/移除即时失效、长事务 TOCTOU、session revocation、重置枚举与限流测试。
- 全新与 legacy fixture 的 migration apply/replay/backfill；owner 与 Membership 计数、唯一约束、当前 Workspace 选择逐项读回。
- 客户端 bundle、日志和审计扫描不得出现明文 session/invite/reset token、SMTP 密码、密码 hash、数据库 URL、附件路径或私有正文。
- 桌面/移动覆盖邀请接受、登录、账户安全、设备会话、Workspace 创建/切换/归档/恢复、成员移除/离开/所有权转移和所有失败状态。
