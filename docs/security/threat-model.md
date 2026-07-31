# 威胁模型

## 主要资产

- 学习记录。
- 动机档案。
- 情绪记录。
- 错题与复盘。
- 上传资料。
- AI Key。
- 数据库连接串。
- 部署密钥。

## 主要风险

- 未登录访问私密数据。
- API 写操作绕过鉴权。
- 上传恶意文件。
- 上传目录被直接暴露。
- AI prompt 泄露敏感内容。
- 日志记录密钥或隐私正文。
- migration 或部署操作造成数据丢失。
- Release 资产或容器镜像被篡改后进入生产。
- Web 运维入口越权执行服务器命令。

## 第一版防线

- 单管理员登录。
- 所有写操作服务端鉴权。
- 上传文件限制类型、大小和路径。
- AI 输出结构化校验。
- 默认不发送动机档案给 AI。
- `.env` 不入库。
- 数据库和上传目录定期备份。
- GitHub Release 更新必须校验 `SHA256SUMS`、cosign bundle 和镜像 digest；生产默认 `AREAFORGE_REQUIRE_SIGNATURE=true`。
- Web runtime 只能提交受控更新请求和读取状态，不能直接执行 Docker、备份、恢复、migration 或服务器命令。

## 细化规则

文件上传、附件访问、AI 调用、备份恢复和高风险确认规则见 `docs/security/file-ai-safety.md`。

## 学习行动中心新增资产

学习行动中心已把考试工作区归属、学习树规范化 Markdown 长期留存与导出、资料 HTTPS 外链、浏览器通知 payload、四类 AI 草稿 HMAC（基于哈希的消息认证码）token 纳入生产威胁面。导入 confirm 的生命周期边界已确认，但 `AF-RISK-DATA-001` 继续保持 `deferred-work`；AI 草稿仍禁止附件与未选择正文，物理删除与完整账户导出不在当前范围。发布后产品化修复尚未形成新的 Release 或 production apply，不改变这些安全边界。规格见 `workflow/versions/v1.1-learning-action-center.md`。
