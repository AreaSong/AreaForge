# 数据模型

第一版核心实体：

- `User`：单管理员账号。
- `AuthSession`：登录会话，只保存 session token 哈希、过期时间和用户关联。
- `Subject`：数学、英语、政治、408 各子科目。
- `SyllabusNode`：考纲进度树节点。
- `StudyTask`：每日任务。
- `StudySession`：学习计时记录。
- `DailyReview`：每日复盘。
- `Note`：文字笔记和自己的理解。
- `Attachment`：图片、PDF、拍照笔记等文件 metadata。
- `Mistake`：错题与错因。
- `MotivationVault`：动机封存内容。
- `AuditEvent`：关键写操作审计。

PostgreSQL 是主状态源事实。附件本体存储在持久化上传目录，数据库只保存 metadata、hash 和 URI。

## 认证相关约束

- `User.email` 唯一。
- `User.passwordHash` 只保存哈希，不保存明文密码。
- `AuthSession.tokenHash` 唯一。
- `AuthSession` 过期或注销后应删除或标记失效。
- Cookie 中的明文 session token 不落库、不入日志。
