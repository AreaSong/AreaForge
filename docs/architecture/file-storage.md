# 文件存储

## 范围

AreaForge 需要支持：

- 图片。
- PDF。
- 拍照笔记。
- 课程截图。
- 公式整理。
- 题解。

## 存储原则

- 文件本体存储在持久化上传目录。
- 数据库只保存 metadata、hash、URI、关联对象。
- 上传目录不放在 `public/` 下。
- 下载和预览必须走鉴权 API。
- 上传文件名随机化，不使用原始文件名作为磁盘路径。

## 第一版限制

- 支持 PDF 和常见图片作为附件保存。
- 不做复杂 PDF 自动解析。
- 不把上传内容直接拼进 AI prompt。
- 文件大小默认限制为 20 MB。

## 安全要求

- 校验扩展名、MIME 和 magic bytes。
- 防路径穿越。
- 禁止软链接逃逸。
- 返回文件时设置 `X-Content-Type-Options: nosniff`。
- PDF 默认下载或受控预览。

## 当前行为

`packages/storage` 提供 MIME 策略、magic bytes 校验、metadata 草稿、随机存储名与 `upload://attachment/` URI、上传目录内路径解析、相对上传目录拒绝、公开目录拒绝钩子和下载响应头生成。Web 服务层接入 noteId 绑定附件上传和鉴权下载：创建上传目录、私有落盘、软链接真实路径校验、DB/文件补偿、hash/size 对账和 `private, no-store` / `nosniff` 响应头均已覆盖。

附件删除、错题/模拟/阶段附件、AI 解析和孤儿文件自动清理不在当前范围。

## 双向只读对账

附件恢复和发布证据不能只检查“数据库记录指向的文件是否存在”，还必须扫描私有上传目录中的反向状态。`pnpm attachment:reconciliation` 始终生成数据库到文件系统的 `report_only` CSV，并执行目录到数据库的双向扫描；`--summary-output` 只控制是否保存 JSON，不控制是否扫描。summary 统计 `dbOnlyCount`、`fileOnlyCount`、hash/size mismatch、非法 URI、重复文件引用、symlink/非文件等 unsafe entry，任一异常都返回 `mismatch`。

CSV 和 summary 必须写在 `UPLOAD_DIR` 外，输出路径不能相同、不能是 symlink，写入使用权限 `0600` 的临时文件原子替换。附件读取使用 `O_NOFOLLOW` 文件描述符，上传根本身不能是 symlink 或文件系统根目录。summary 不包含绝对路径、文件内容或明文存储名；孤儿和不安全目录项只保存文件名 SHA256。

该对账只报告，不删除、不移动、不修复 metadata，也不证明扫描期间不存在并发写入。发布或恢复证明应针对停止写入的临时恢复副本、快照或维护窗口中的静止数据集运行。
