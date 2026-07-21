# 学习树导入（规划，未实现）

## 目标

允许用户下载标准 Markdown 模板，在本地或外部工具整理后上传；系统严格校验、差异预览并原子确认，保留规范化源版本历史。

## 规划行为

- 协议 `AREAFORGE_LEARNING_TREE_V1`；模板分全局、单科与分支。
- 五步：上传/粘贴 → 解析校验 → 差异预览 → 映射/跳过 → 原子确认。
- preview 不写考纲、卡片、资料、任务、Schedule 或 AuditEvent。
- confirm 重新解析、校验 hash/revision，并在幂等键保护下原子提交。
- 规范化 Markdown 无自动过期、仅软归档、随数据库备份；一次性 canonical 导出后不留服务器长期临时文件。
- 物理删除、备份副本同步删除与完整账户导出包不在本版本范围（见 `AF-RISK-DATA-001`）。

## 非目标

- 不内置 OCR；不因文件中未出现对象而静默删除/归档；不部分提交。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
