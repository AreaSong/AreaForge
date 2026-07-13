# 运行时写动作边界矩阵

## 目标

本矩阵描述 AreaForge 中不同能力层级允许做什么、需要什么证据、不能被什么说法冒充。它吸收相邻项目的 Query/Command 边界思想，但不引入平台级 Command API、worker lease 或数据库化执行队列。

## 能力等级

| 等级 | 名称 | 允许动作 | 典型入口 | 需要证据 |
|---|---|---|---|---|
| R0 | 只读查询 | 读页面、读 API、读 health、读 update status、生成 preview/summary | `GET /api/health`、`GET /api/system/update-status`、`pnpm ops:readiness:summary` | 时间戳、来源、结果、残余 ID |
| R1 | 本地/fixture 写 | 本地合成 smoke、临时库、测试上传、fixture 数据 | `pnpm smoke:local-ux`、测试库 migration、Playwright 本地页面 | base URL、环境、本地写入范围、验证输出 |
| R2 | 用户显式 Web 写 | 用户在 Web 中创建任务、复盘、笔记、附件、报告决策、阶段草稿确认 | authenticated Web/API POST/PATCH | 用户鉴权、审计、业务对象 ID、回滚或撤销语义 |
| R3 | Release/update 请求 | Web 版本中心提交受控检查、应用、回退或策略请求 | `/api/system/update-requests` | request ID、队列状态、server agent 后续处理证据 |
| R4 | 高风险生产操作 | migration deploy、backup、restore、updater apply、rollback、上传目录迁移、批量清理 | 服务器侧 updater、管理员 runbook | 明确确认、备份/hash、签名/digest、smoke、回滚目标、release/ops 记录 |

## 不能混淆

- R0 preview 不等于 R2/R4 写入。
- R1 本地写入不等于生产写入。
- R3 update request 不等于 R4 updater apply；被 Web 本地只读状态校验拒绝的无效请求不会写入 request 文件，也不构成 server agent 证据。
- R4 必须在服务器侧或管理员确认路径执行，Web runtime 不直接持有 Docker、shell、备份、restore、migration 或 rollback 能力。
- AI 建议、报告草稿、阶段调整草稿默认只是 confirm-only draft，不自动覆盖用户记录。

## 默认映射

- Dashboard、analytics、reports 的普通读取：R0。
- 本地 UX smoke：R1。
- 任务创建、计时结束、复盘保存、笔记附件上传、报告确认、阶段草稿确认：R2。
- Web 版本中心 update request：R3。
- GitHub Release updater apply、生产 migration、备份、恢复、回滚、上传目录迁移、附件批量删除：R4。

## 验证与汇报

涉及写动作边界时，完成汇报必须说明：

- 当前最高等级。
- 是否生产环境。
- 是否需要用户确认。
- 是否产生审计或 evidence record。
- 是否需要新 GitHub Release。
- 相关 residual risk IDs。
