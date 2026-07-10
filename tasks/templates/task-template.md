# 任务标题

状态：

## 目标

说明本任务要完成什么。

## 范围

- 包含：
- 不包含：

## 参考源事实

- `docs/...`

## 验收标准

-

## 验证

- 

## 文档同步

- `docs/...`
- `tasks/...`
- `workflow/...`
- 若进入线上，记录 GitHub Release tag、线上 health、镜像 digest、update-agent 状态和残余风险。

## 高风险边界

命中高风险边界时，先写清以下内容并等待确认：

- 影响：
- 风险：
- 验证：
- 回滚：

Web runtime 不直接执行 Docker、备份、恢复、migration 或服务器命令；自动更新只能通过受控请求或服务器侧 updater 执行。

## 残余风险

-
