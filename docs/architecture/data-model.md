# 数据模型

第一版核心实体：

- `User`：单管理员账号。
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

