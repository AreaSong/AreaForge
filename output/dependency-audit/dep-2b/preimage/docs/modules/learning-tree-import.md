# 学习树导入

## 目标

允许用户下载标准 Markdown 模板，在本地或外部工具整理后上传；系统严格校验、差异预览并原子确认，保留规范化源版本历史。

## 当前行为

- 协议 `AREAFORGE_LEARNING_TREE_V1`；模板分全局、单科与分支。
- API 与页面：模板、作用域导出、无业务写入 preview、原子 confirm、导入历史与一次性 canonical 导出；页面入口位于 `/knowledge/imports`。
- 页面默认是批次总览，唯一主操作进入导入工作态；导出使用独立工作态。模板和 AI 草稿只在导入工作态出现，草稿恢复会直接回到未完成导入。
- 导入工作态按内容、差异、显式确认推进；中断、登录失效和 confirm 冲突均保留 Markdown 与映射，但必须重新 preview。成功后进入批次结果，以中文应用/跳过摘要和考纲核验为主，协议、哈希与规范化源降为折叠技术信息。
- preview 不写考纲、卡片、资料、任务、Schedule 或 AuditEvent；confirm 成功后才创建 `LearningTreeImportBatch/Item`。
- 学习树 Markdown 内资料指令仅允许 HTTPS LINK；不内嵌二进制、不触发服务端抓取。
- StudyResource FILE/LINK CRUD、ZIP/Markdown 存储策略与重复三选一已落地，页面入口位于 `/knowledge/resources`。
- 数据生命周期边界已接受（`AF-RISK-DATA-001`）：仅 owner 可见、无自动过期、仅软归档、随库备份、一次性导出；residual **未**自动关闭。
- 现有 `POST /api/syllabus/import-markdown` 保持 legacy append-only，不无声切换为 merge。

## 尚未开放

- 物理删除导入历史/附件、完整账户导出。

## 非目标

- 不内置 OCR；不因文件中未出现对象而静默删除/归档；不部分提交。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
