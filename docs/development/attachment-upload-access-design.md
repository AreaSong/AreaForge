# 附件上传与鉴权访问设计

## 状态

本文件是 `tasks/active/0004-mvp-syllabus-notes-upload.md` 的附件实现确认设计，不是已启用上传能力。任何服务端写入 `UPLOAD_DIR`、附件下载或预览路由，都必须等用户明确确认后再做。

## 目标

实现第一版笔记附件闭环：

- 登录后可给笔记上传 PDF、PNG、JPEG、WebP。
- 文件本体写入持久化 `UPLOAD_DIR`，不进入 `public/`。
- 数据库只保存 metadata、hash、URI 和 `noteId`。
- 下载或受控预览必须走鉴权 API。
- 文件写入和数据库写入之间有补偿，避免孤儿文件和孤儿 metadata。

## API 设计

### `POST /api/notes/[noteId]/attachments`

请求：

- `multipart/form-data`
- 字段：
  - `file`：必填，单文件。

流程：

1. `requireApiUser(request)`，未登录返回 `401`。
2. 解析 form data，只接受一个 `file`。
3. 校验路径参数 `noteId` 存在；第一版不支持无归属附件。
4. 读取文件 bytes，使用 `MAX_UPLOAD_MB` 和 `ALLOWED_UPLOAD_MIME` 构造 policy。
5. 调用 `createAttachmentMetadataDraft`：
   - magic bytes 识别真实 MIME。
   - 拒绝空文件、超大文件、未知 magic bytes、声明 MIME 不一致。
   - 生成随机 `storedName`、sha256、`upload://attachment/...` URI。
6. 创建上传目录，解析安全路径，真实路径不能逃逸。
7. 使用独占写入模式写文件，避免覆盖同名文件。
8. 写入 `Attachment` metadata，并创建 `AuditEvent`。
9. 如果数据库写入失败，删除本次已写入文件。
10. 返回 `201 { attachment }`。

响应 DTO：

- `attachment.id`
- `attachment.noteId`
- `attachment.originalName`
- `attachment.mimeType`
- `attachment.sizeBytes`
- `attachment.hash`
- `attachment.downloadApiPath`

响应不得包含内部 `uri`、绝对路径、上传根目录、`storedName` 或补偿删除路径。UI 只能使用 `downloadApiPath = /api/attachments/:id` 访问附件，不能把 `Attachment.uri` 或 `upload://attachment/...` 当作 href。

错误码建议：

- `UNAUTHORIZED`：`401`
- `NOTE_NOT_FOUND`：`404`
- `ATTACHMENT_FILE_REQUIRED`：`400`
- `ATTACHMENT_INVALID_FILE`：`400`
- `ATTACHMENT_TOO_LARGE`：`413`
- `ATTACHMENT_UNSUPPORTED_TYPE`：`400`
- `ATTACHMENT_MIME_MISMATCH`：`400`
- `ATTACHMENT_MULTIPLE_FILES`：`400`
- `ATTACHMENT_EMPTY_FILE`：`400`
- `ATTACHMENT_BAD_MULTIPART`：`400`
- `ATTACHMENT_INVALID_DISPOSITION`：`400`
- `UPLOAD_DIR_UNSAFE`：`500`
- `ATTACHMENT_WRITE_FAILED`：`500`
- `ATTACHMENT_METADATA_WRITE_FAILED`：`500`，响应不得包含补偿删除路径。
- `ATTACHMENT_FILE_MISSING`：`404`
- `ATTACHMENT_FILE_MISMATCH`：`409`

### `GET /api/attachments/:id`

请求：

- 必须登录。
- 可选 query：
  - `disposition=attachment|inline`，默认 `attachment`。

流程：

1. `requireApiUser(request)`，未登录返回 `401`。
2. 查询 `Attachment`，不存在返回 `404`。
3. 解析 `uri` 得到 `storedName`；失败返回 `ATTACHMENT_URI_INVALID`。
4. 通过 `createSafeAttachmentFilePath(UPLOAD_DIR, storedName)` 得到路径。
5. 校验上传根目录真实路径和文件真实路径仍在同一根目录内。
6. 读取文件；缺失返回 `ATTACHMENT_FILE_MISSING`。
7. 可选校验 size/hash 与 metadata 一致；不一致返回 `ATTACHMENT_FILE_MISMATCH`。
8. 使用 `createAttachmentResponseHeaders` 返回：
   - `Content-Type`
   - `Content-Disposition`
   - `Cache-Control: private, no-store`
   - `X-Content-Type-Options: nosniff`
   - `Content-Length`

`Content-Disposition` 的文件名必须做响应头安全转义：去除 CR/LF，转义引号，必要时同时提供 ASCII fallback 和 RFC 5987 `filename*`。原始文件名不得直接拼接进响应头。

`disposition=inline` 只允许 PDF、PNG、JPEG、WebP；不支持的值返回 `ATTACHMENT_INVALID_DISPOSITION`。

第一版不提供删除接口，避免破坏性操作。

## 服务层职责

建议新增 `apps/web/lib/study/attachments-service.ts`：

- `createNoteAttachment(input, actorId)`
- `getAttachmentDownload(id, disposition)`
- `assertNoteExists(noteId)`
- `resolveSafeUploadRoot(uploadDir)`
- `writeAttachmentFileSafely(filePath, bytes)`
- `removeBestEffort(filePath)`

Route Handler 只负责鉴权、请求解析、schema 校验和返回响应。

## 文件安全策略

- `UPLOAD_DIR` 必须是绝对路径，且不能是根目录。
- 上传目录不得位于 `apps/web/public`、`public` 或任何静态公开目录。
- 原始文件名只保存为 metadata，不参与磁盘路径。
- `storedName` 必须由服务端随机 ID 生成。
- `createSafeAttachmentFilePath` 校验路径拼接不逃逸。
- 写入前用 `realpath(uploadRoot)` 确认上传根目录不是软链接逃逸；写入后用 `lstat(filePath)` 确认目标不是 symlink，再用 `realpath(filePath)` 确认文件真实路径仍在真实上传根目录内。
- 使用独占写入，随机名冲突时重新生成，不覆盖已有文件。
- 日志不得记录文件内容、上传目录绝对路径、完整原始文件名或后续 AI prompt。

## DB 与文件补偿

推荐顺序：

1. 校验 bytes 和 metadata draft。
2. 创建上传目录。
3. 写入文件。
4. 创建 `Attachment` metadata 和审计事件。
5. 如果第 4 步失败，best-effort 删除第 3 步写入的文件。

不推荐先写数据库再写文件，因为文件失败会产生可见但不可下载的 metadata。

需要注意：

- 删除补偿只能删除本次随机写入的文件。
- 补偿失败时记录服务端错误日志，但不把绝对路径回显给客户端。
- 后续可增加只读对账脚本，但不能自动删除孤儿文件。

## UI 入口

第一版建议放在 `/notes` 的单条笔记区域：

- 文件选择控件。
- 上传按钮。
- 上传中、成功、失败状态。
- 附件列表展示文件名、大小、MIME 和下载按钮。
- 下载按钮指向 `/api/attachments/:id`，不暴露 `uri` 为可访问 URL。

## 验证清单

包内测试：

- `pnpm --filter @areaforge/storage test`

Web 和工程检查：

- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`

API 烟测：

- 未登录上传返回 `401`。
- 未登录下载返回 `401`。
- 多个 `file` 字段返回 `ATTACHMENT_MULTIPLE_FILES`。
- 空 `file` 字段或 0 字节文件返回 `ATTACHMENT_FILE_REQUIRED` / `ATTACHMENT_EMPTY_FILE`。
- 畸形 multipart 返回 `ATTACHMENT_BAD_MULTIPART`。
- 登录后上传 PDF、PNG、JPEG、WebP 成功。
- 超过 `MAX_UPLOAD_MB` 返回失败。
- 声明 MIME 与 magic bytes 不一致返回失败。
- `../evil.pdf` 原始文件名不会影响磁盘路径。
- `noteId` 不存在返回 `NOTE_NOT_FOUND`。
- 非法 `disposition` 返回 `ATTACHMENT_INVALID_DISPOSITION`。
- 上传目录软链接逃逸被拒绝。
- DB 写入模拟失败时，本次写入文件被补偿删除。
- 文件写入模拟失败时，不创建 `Attachment` metadata。
- 下载返回 `nosniff` 和 `private, no-store`。
- 下载响应不泄露内部 `uri`、`storedName`、上传根目录或绝对路径。
- 上传文件不出现在 `apps/web/public`。
- metadata hash 和磁盘文件 hash 一致。
- 只读对账可遍历 `Attachment.uri` 并确认文件存在、hash 一致，但不自动删除文件。

只读对账清单建议字段：

- `attachmentId`
- `noteId`
- `uri`
- `storedName`
- `metadataHash`
- `fileHash`
- `metadataSizeBytes`
- `fileSizeBytes`
- `exists`
- `sizeMatches`
- `hashMatches`
- `action=report_only`

对账只输出清单，不删除、不移动、不修复文件；任何孤儿文件清理或 metadata 修复都必须另行确认。

页面烟测：

- `/notes` 可上传附件。
- 刷新后附件列表仍可见。
- 点击下载能拿到文件且响应头正确。

## 回滚策略

- 若只部署代码但未开放 UI，可关闭上传入口，保留下载只读能力。
- 若上传 API 出现问题，先禁用 `POST /api/notes/[noteId]/attachments`，不要删除已有 metadata 或文件。
- 若下载 API 出现问题，保持 metadata 可见但下载返回明确错误，避免暴露磁盘路径。
- 清理孤儿文件必须先生成只读对账清单，再单独确认。
