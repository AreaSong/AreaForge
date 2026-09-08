# 持久后台任务

## 职责与边界

`DataJob` 保存任务状态，`packages/core/src/data-job-queue.ts` 定义纯退避规则，
`packages/db/src/data-job-queue*.ts` 负责事务和持久状态，`scripts/workers/data-job-runner.ts`
提供独立进程的消费循环。Web 不启动后台进程，也不获得服务器命令能力。

执行器默认关闭，必须显式传入 `enabled=true` 和非空、种类不重复的处理器集合。
处理器只按代码注册，不从请求参数、数据库或环境变量加载任意脚本。
当前已提供受控的排名通知处理器本地候选；排名重建、导出和删除仍不注册业务处理器。各域的实现和授权见
[`feature-traceability.md`](../development/feature-traceability.md) 与对应确认包。

## 持久协议

- `queueVersion=0` 是旧手工预览协议，`queueVersion=1` 是独立 worker 协议；新增字段默认零，不自动提升旧任务。
- 请求者与幂等键唯一；相同键但任务种类、范围或请求指纹不同则拒绝。
- ACCOUNT 必须没有 `workspaceId`，WORKSPACE 必须绑定一个工作区。
- `nextAttemptAt` 保存下一次可运行时间，进程重启不清空退避。
- `maxAttempts` 限定自动尝试预算；默认五次，首个失败等待三十秒，指数增长且最多一小时。
- `leaseVersion` 是单调递增的租约代次；重新领取和人工重放均不能恢复旧代次。
- `FAILED + retryable=true + nextAttemptAt` 表示等待重试；`FAILED + deadLetteredAt` 表示死信，不能自动领取。
- `pauseRequested` 请求合作式暂停；确认暂停后释放租约，未提交的主动暂停不消耗失败重试预算。
- 人工重放重置尝试预算但不重置租约代次，失败与重放历史保留在脱敏审计中。

领取使用 PostgreSQL `FOR UPDATE SKIP LOCKED`，按下一次执行时间、创建时间和 ID 排序。
被锁定的任务不会挡住其他工作区；worker 可以按请求者、工作区或账户范围分区。
时间来自数据库时钟，客户端提供的 lease expiry 不构成提交依据。

## 权限与提交

领取和提交重新检查 ACTIVE 账户、ACTIVE 工作区和 ACTIVE Membership；校验与使用期间持有相关行锁。
这只是队列最低范围检查，业务处理器仍须在事务内校验对象 owner、grant、角色和具体操作条件。
任务控制仅允许请求者本人，并校验预期 revision；队列工具函数不是公开 HTTP 授权入口。

处理器分成两段：

1. `prepare` 做可取消的准备工作，接收取消信号及心跳接口。
2. 返回的提交函数只用传入的数据库事务写副作用；副作用与任务 `SUCCEEDED` 同时提交。

提交时绑定任务、kind、scope、请求者、工作区、worker 和租约代次。过期、旧代次、取消或暂停不能提交成功。
事务内副作用之后再次检查租约与任务时限，失败整笔回滚。

数据库事务不保证外部 IO 恰好一次。文件、下载凭证、外部投递等处理器必须另有幂等、补偿、撤销和恢复协议；
不得在 `prepare` 中先写外部状态，再把框架的取消或数据库回滚当作补偿。

## 中断与恢复

- 心跳周期为租约时长的三分之一；进度单调增长。
- 取消先进入 `CANCEL_REQUESTED`，由心跳、提交检查或失效租约回收结算为 `CANCELLED`。
- 暂停同样由 worker 检查后结算；不承诺请求瞬间打断准备工作。
- 准备函数必须响应取消；即使它晚返回，执行器也不会调用其提交函数。
- 进程正常停止时不再领取任务，未提交的执行进入可重试失败；进程被杀时由租约回收恢复。
- 回收只扫描注册种类及指定分区；过期任务不重新执行，取消请求不变回普通排队任务。
- 只读队列快照提供状态计数、退避数量、死信数量、失效租约数和最老活动时间，不输出租约或正文。
- 排名通知处理器只接受 `RANKING_*` 受控种类、三类源实体和不透明 ID；它在事务内重新检查收件人 Membership，使用事件键幂等 upsert `UserNotification`。`PLATFORM_NOTIFICATION_QUEUE_ENABLED` 只有在 `PLATFORM_NOTIFICATIONS_ENABLED` 同时开启时才有效。

## 验证与回退

默认 `pnpm check` 通过 Core/DB 单测覆盖规则和 worker 单元测试，并通过 `worker:data-jobs:typecheck` 检查执行器。
真实数据库与子进程证据另运行 `pnpm worker:data-jobs:runtime:selftest`：必须显式设置
`AREAFORGE_DATA_JOB_WORKER_ISOLATED_DB=1`，数据库只允许 loopback 且名称匹配 `areaforge_v20_worker_*`。
脚本再核对 `current_database()` 与全部 canonical migration 的名称、完成状态和 SQL checksum。
该入口不创建、迁移或删除数据库；外层必须获得隔离 fixture 授权。

回退先停止消费与新协议生产者，保留任务、审计和兼容字段，不 DROP 表或猜测恢复旧代次。
存在新协议任务时，继续使用理解协议隔离的 Web 构建；不能让旧手工接口接管新队列。
本地 fixture 已证明通知处理器的合成事件写入和重复事件幂等，不证明排名重建、导出、删除、共享库、生产、Release 或浏览器验收。
