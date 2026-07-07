# 数据模型

第一版核心实体：

- `User`：单管理员账号。
- `AuthSession`：登录会话，只保存 session token 哈希、过期时间和用户关联。
- `Subject`：数学、英语、政治、408 各子科目。
- `SyllabusNode`：考纲进度树节点，包含当前掌握状态和掌握等级；掌握证明基础版仍复用现有任务、计时、笔记和错题关联作为派生证据，不新增显式证据表。
- `StudyTask`：每日任务。
- `StudySession`：学习计时记录；Batch 0 已追加结构化收口字段，包括理解程度、最小产出、下一步动作、是否产生笔记/错题、低转化标记、反假学习原因、补产出要求和收口版本，同时保留旧 `note` 文本可读。
- `DailyReview`：每日复盘。
- `CheckIn`：每日打卡快照；Batch 1 已新增学习日唯一快照，记录最低动作、总/有效时长、有效 session 数、任务完成率、复盘状态、低效标记、低转化次数和来源版本。新写路径维护快照，历史无快照日期由读取侧 fallback 派生。
- `Note`：文字笔记和自己的理解。
- `Attachment`：图片、PDF、拍照笔记等文件 metadata。
- `Mistake`：错题与错因。
- `MotivationVault`：动机封存内容。
- `AuditEvent`：关键写操作审计；掌握证明基础版成功时记录请求等级、已勾选条件和证据计数摘要，不保存完整复盘正文或附件内容。

PostgreSQL 是主状态源事实。附件本体存储在持久化上传目录，数据库只保存 metadata、hash 和 URI。

## 认证相关约束

- `User.email` 唯一。
- `User.passwordHash` 只保存哈希，不保存明文密码。
- `AuthSession.tokenHash` 唯一。
- `AuthSession` 过期或注销后应删除或标记失效。
- Cookie 中的明文 session token 不落库、不入日志。
