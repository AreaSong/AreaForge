# 0004 考纲、笔记与附件基础版

状态：进行中。考纲树与笔记基础能力已开始实现；附件上传、鉴权访问和上传目录属于高风险边界，落盘实现前必须等待明确确认。

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

## 当前实施切分

### 当前低风险进展

- 考纲树、笔记基础 API/UI 已实现。
- `POST /api/syllabus/import-markdown` 和 `/syllabus` Markdown 导入表单已实现：只新增节点，不删除、不覆盖、不做 AI/PDF 解析；解析规则位于 `packages/core/src/syllabus-import.ts`，限制行数、层级和标题长度。
- `packages/storage` 已补充纯校验能力：允许 MIME、大小限制、magic bytes 识别、声明 MIME 不一致拦截、安全 storedName/URI 规则和原始文件名元数据清理。
- `packages/storage` 已补充附件落盘前安全底座纯函数：metadata 草稿、sha256、允许 MIME 解析、安全上传目录路径拼接、目录逃逸判断和私有 `nosniff` 下载响应头生成。
- 这些能力尚未启用附件上传或文件落盘，只作为后续高风险实现的安全地基。

### 已允许直接推进

- 复用现有 `SyllabusNode`、`Note`、`StudyTask.syllabusNodeId`、`StudySession.syllabusNodeId`。
- 不做 schema 重设计，不新增 migration。
- 新增考纲树读取、创建、更新 API。
- 新增受限 Markdown 考纲导入 API。
- 新增笔记读取、创建 API。
- 首页任务创建和专注计时支持关联考纲节点。
- 新增 `/syllabus` 和 `/notes` 工作页。

### 必须确认后再推进

- 文件本体写入 `UPLOAD_DIR`。
- 附件上传 API。
- 附件鉴权下载或预览 API。
- 上传目录创建、权限、路径解析和软链接防逃逸。

## 附件高风险说明

### 影响

- 引入服务器文件写入能力，上传目录会成为数据库之外的第二类持久化状态。
- `Attachment` metadata 必须与文件本体保持一致，否则会出现记录可见但文件缺失，或文件存在但无记录的孤儿状态。
- 下载和预览会暴露用户上传资料，必须始终走鉴权 API，不能由 Nginx、Next public 静态目录或原始路径直接访问。

### 风险

- 恶意文件伪造 MIME 或扩展名。
- 超大文件占满磁盘。
- 原始文件名造成路径穿越或覆盖已有文件。
- 软链接或真实路径解析不严导致逃逸上传目录。
- 数据库写入失败后留下孤儿文件。
- 日志泄露上传目录绝对路径、文件内容、敏感文件名或后续 AI prompt 内容。

### 验证

- 未登录上传和下载返回 `401`。
- 登录后可上传允许的 PDF、PNG、JPEG、WebP。
- 超过 `MAX_UPLOAD_MB` 的文件被拒绝。
- 声明 MIME 与 magic bytes 不匹配的文件被拒绝。
- `../evil.pdf` 一类原始文件名不会影响磁盘路径。
- 软链接逃逸被拒绝。
- 文件不出现在 `apps/web/public` 或任何 public 静态目录。
- 下载响应包含 `X-Content-Type-Options: nosniff` 和私有缓存策略。
- `pnpm check` 通过。

### 回滚

- 若只完成考纲和笔记基础 API/UI，无 migration，可通过移除新增路由、服务和组件回滚。
- 若后续启用附件落盘，回滚前先停止上传入口，保留已有上传目录和 metadata，不做自动删除。
- 需要清理孤儿文件时，必须先生成只读审计清单，再经确认执行，不在本任务中默认删除。
