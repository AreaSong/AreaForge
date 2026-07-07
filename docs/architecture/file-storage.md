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

## 当前实现状态

`packages/storage` 提供 MIME 策略、magic bytes 校验、metadata 草稿、随机存储名与 `upload://attachment/` URI、上传目录内路径解析、相对上传目录拒绝、公开目录拒绝钩子和下载响应头生成。Package A 后，Web 服务层已接入 noteId 绑定附件上传和鉴权下载：创建上传目录、私有落盘、软链接真实路径校验、DB/文件补偿、hash/size 对账和 `private, no-store` / `nosniff` 响应头均已覆盖。

第一版仍不提供附件删除、错题/模拟/阶段附件、AI 解析或孤儿文件自动清理。
