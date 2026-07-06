# ADR 0003: PostgreSQL 作为主状态源事实

## 决策

AreaForge 使用 PostgreSQL 保存主要结构化状态。

## 范围

保存：

- 任务。
- 计时。
- 考纲进度。
- 笔记 metadata。
- 附件 metadata。
- 错题。
- 复盘。
- 动机档案。
- 审计事件。

不保存文件本体：

- 图片和 PDF 存储在持久化上传目录。
- 数据库只保存 metadata、hash 和 URI。

## 原因

- 长期学习数据需要可靠 migration。
- 统计、关联查询和阶段分析需要结构化数据。
- 代码更新不应影响数据。

