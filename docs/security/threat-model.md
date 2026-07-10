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
