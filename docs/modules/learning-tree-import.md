# 学习树导入

## 目标

允许用户下载标准 Markdown 模板，在本地或外部工具整理后上传；系统严格校验、差异预览并原子确认，保留规范化源版本历史。

## 当前行为

- 协议 `AREAFORGE_LEARNING_TREE_V1`；模板分全局、单科与分支。
- 隔离 API 提供模板下载、作用域导出与无业务写入 preview；preview 返回 HMAC opaque token 与逐项 diff。
- preview 不写考纲、卡片、资料、任务、Schedule 或 AuditEvent。
- 学习树 Markdown 内资料指令仅允许 HTTPS LINK；不内嵌二进制、不触发服务端抓取。
- 现有 `POST /api/syllabus/import-markdown` 保持 legacy append-only，不无声切换为 merge。

## 尚未开放

- 原子 confirm、导入批次历史与已确认源版本的一次性 canonical 导出（见 `AF-RISK-DATA-001`）。
- 生产可路由页面与导航入口。
- StudyResource FILE 上传与资料 CRUD API。

## 非目标

- 不内置 OCR；不因文件中未出现对象而静默删除/归档；不部分提交。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
