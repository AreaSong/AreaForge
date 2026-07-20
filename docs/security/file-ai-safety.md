# 文件与 AI 安全边界

## 定位

AreaForge 会处理学习记录、动机档案、情绪记录、错题、复盘、PDF、图片和 AI 请求。这些内容都按私密数据处理。

## 文件上传边界

第一版上传能力只允许：

- PDF。
- PNG、JPEG、WebP 图片。
- 通过鉴权 API 访问的附件。

禁止：

- 将上传文件放入 `public/`。
- 使用用户原始文件名作为存储路径。
- 信任浏览器传来的 `Content-Type`。
- 允许 `../`、绝对路径或软链接逃逸。
- 在没有用户确认的情况下删除附件或移动上传目录。

## 上传验收要求

- 限制大小。
- 限制 MIME。
- 校验 magic bytes。
- 随机化存储名。
- 数据库只保存 metadata、hash 和 URI。
- 下载或预览必须鉴权。
- 返回文件时使用 `X-Content-Type-Options: nosniff`。

当前 `packages/storage` 已覆盖上述规则中的纯函数部分，包括 MIME、magic bytes、随机存储名、URI、上传路径拼接、相对上传目录拒绝、公开目录拒绝钩子和有界流式 multipart parser（增量 size/MIME/magic bytes/hash 校验，超限即中止）。OPS-007 本地实施后，Web 服务层按 staging/write-intent 协议实现 noteId 绑定附件上传：数据库 `PENDING` intent 先于任何文件写入，`.staging/` exclusive write/fsync、atomic rename/目录 fsync、重开校验后 `READY` CAS；下载仅允许 `READY` 并使用 `O_NOFOLLOW` 同句柄 fstat/hash/size 校验，浏览器 DTO 不返回 hash、uri、storedName 或内部协议字段。新协议 `PENDING` 恢复只能由显式维护命令（有界 claim/lease reconciliation）触发；该实现为 `local-verified`，生产 migration/deploy 另行确认。附件删除、跨对象附件和孤儿文件清理仍需单独确认。

附件运维对账采用双向只读证据：数据库侧检查 exists/size/hash，文件系统侧报告 file-only、symlink、非文件和非法存储名。报告不能写入 `UPLOAD_DIR`，不能跟随输出 symlink，不能输出绝对路径、附件内容或明文目录项名称；file-only/unsafe entry 只记录文件名 SHA256。`action` 永远是 `report_only`，发现异常只返回失败状态，不自动删除孤儿文件、移动附件或覆盖数据库 metadata。summary 自身的 canonical hash 必须由发布记录中的 `attachmentReconciliationSummaryHash` 外部绑定，不能把 JSON 内可重算的自哈希当作签名。

## AI 调用边界

AI 第一版只允许生成：

- 鞭策文案。
- 复盘建议。
- 明日任务建议。

阶段调整草稿属于第二阶段长期闭环。Package D Batch D3 已完成长期阶段 AI 草稿显式触发路径：只允许用户主动调用鉴权 `POST /api/simulation/stage-adjustment-drafts/ai`，只发送最小聚合字段和阶段目标摘要，成功只写 `StageAdjustmentDraft.source="ai"` 草稿和审计摘要，失败回退本地规则。D3 仍不得发送动机档案、完整情绪记录、完整复盘正文、附件内容、文件路径或完整任务标题，不得保存完整 prompt/raw response，也不得自动应用阶段计划或批量修改任务。

AI 不允许：

- 直接覆盖用户记录。
- 删除任务、附件、错题或复盘。
- 自动发送动机档案、完整情绪记录、完整复盘正文。
- 自动发送附件文件内容、PDF 原文、图片内容、OCR 文本、上传路径或 `Attachment.uri`。
- 执行服务器命令、部署命令或直接一键更新；Web 版本中心只能提交受控更新请求，不能在 Web runtime 内执行 Docker、备份、恢复或 migration。

附件文件内容默认不进入 AI 上下文；AI 解析、OCR、摘要或把 PDF/图片内容发给 provider，都必须另走后续高风险确认包。

## AI 验收要求

- 请求前做数据最小化。
- 输出必须做结构化校验。
- 校验失败回退本地规则文案。
- 失败不影响任务、计时、复盘等核心流程。
- 日志不记录 API Key、完整 prompt、动机档案、情绪正文和复盘正文。

## 高风险确认

以下变化必须先说明影响、风险、验证和回滚，再等待确认：

- 默认把动机档案发给 AI。
- 默认把完整情绪记录发给 AI。
- 默认把复盘正文发给 AI。
- 删除附件或迁移上传目录。
- 修改备份、恢复或保留策略。
- 网页内直接触发部署或服务器命令。

## GitHub Release 自动更新边界

允许的自动更新形态是服务器侧受控 updater：`ops/github-release-updater/areaforge-updater.sh` 由管理员手动执行、systemd timer 触发或由 `areaforge-update-agent.timer` 消费 Web 版本中心写入的受控请求后触发。它读取 GitHub Release manifest、校验 `SHA256SUMS` / `SHA256SUMS.sig`，备份数据库和上传目录，使用一次性 migration image，再切换 Docker Compose Web 镜像。

当前远端生产已启用该形态：`https://forge.areasong.top/` 运行 `0.1.7`，服务器 `AREAFORGE_REQUIRE_SIGNATURE=true`，`/etc/areaforge/cosign.pub` 校验 cosign bundle，自动应用策略保持 `AREAFORGE_AUTO_APPLY=none`。当前记录见 `docs/development/release-v0.1.7-record.md`；`docs/development/package-e-remote-github-release-record.md` 保留 `v0.1.5` 历史证据。

禁止：

- 在 Web 页面、Web API、管理后台按钮或 AI 工具调用中直接执行 updater 或服务器命令。
- 将 Docker socket、生产 `.env`、GitHub token、签名私钥或备份目录挂入 Web runtime。
- 跳过签名/hash 校验后自动应用 Release。
- 静默应用 major 更新。
- 在失败回滚时默认覆盖生产数据库或移动上传目录。

数据库恢复、上传目录恢复、签名策略降级、major 自动应用和网页内运维入口都属于高风险变化，必须另行说明影响、验证和回滚后确认。

## 备份与恢复

- 数据库和上传目录必须同周期备份。
- 备份恢复必须能在临时库和临时上传目录验证。
- metadata 指向的文件必须存在；文件缺失时要能报告并进入修复流程。
