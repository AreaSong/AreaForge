# 测试策略

## 第一版最低门禁

- TypeScript 类型检查。
- ESLint。
- Prisma schema validate。
- Next.js build。
- Docker Compose config。
- 初始 migration 与 schema 的 diff 检查。

更细的路径到验证映射见 `docs/development/validation-matrix.md`。

## 重点单测

- 任务债务计算。
- 恢复模式触发。
- 风险等级判断。
- 专注计时状态机。
- 反假学习检查。
- AI 输出校验和回退。
- 文件上传限制。

## 页面烟测

优先覆盖：

- 打开首页。
- 开始计时。
- 暂停计时。
- 结束计时。
- 填写收口信息。
- 返回今日作战台。

## 安全测试

- 未登录访问写 API 应失败。
- 上传超大文件应失败。
- 上传不允许 MIME 应失败。
- 附件不能绕过鉴权访问。
- AI key 不出现在客户端 bundle。
