# 0004 考纲、笔记与附件基础版

## 目标

把学习记录从“时间”推进到“知识点和产出”，支持考纲节点、笔记和附件关联。

## 范围

- 手动维护考纲树。
- 任务和计时关联考纲节点。
- 新建笔记并关联科目、任务或考纲节点。
- 上传 PDF / 图片附件。
- 附件通过鉴权接口访问。

## 不包含

- AI 自动解析 PDF。
- 高级 OCR。
- 复杂富文本编辑器。

## 参考源事实

- `docs/modules/syllabus-map.md`
- `docs/modules/notes.md`
- `docs/architecture/file-storage.md`
- `docs/security/threat-model.md`

## 验收标准

- 附件不进入 `public/`。
- 数据库只保存 metadata、hash 和 URI。
- 文件大小、MIME、路径穿越都有防护。
- `pnpm check` 通过。

