# 持久后台任务

## 职责与边界

`DataJob` 保存任务状态，`packages/core/src/data-job-queue.ts` 定义纯退避规则，
`packages/db/src/data-job-queue*.ts` 负责事务和持久状态，`scripts/workers/data-job-runner.ts`
提供独立进程的消费循环。Web 不启动后台进程，也不获得服务器命令能力。

执行器默认关闭，必须显式传入 `enabled=true` 和非空、种类不重复的处理器集合。
处理器只按代码注册，不从请求参数、数据库或环境变量加载任意脚本。
排名通知通过固定处理器注册；排名重建、导出和删除不因通知处理器可用而获得执行能力。各域的实现和授权见
[`feature-traceability.md`](../development/feature-traceability.md) 与对应确认包。

独立进程入口为 `pnpm worker:data-jobs:run`，要求 `DATA_JOB_WORKER_ENABLED=true`、有效数据库配置及至少一个已开启的处理器。
`--once` 只处理一次领取周期，`--workspace=<id>` 限定工作区；拒绝未知参数、重复选项和路径形式的 ID。
Web 不调用此命令；关闭通知开关后，运行中的通知处理器也会在准备和事务提交阶段拒绝投递。

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

- 准备期心跳周期为租约时长的三分之一；进度单调增长。提交前停止定时器、排空心跳并续租，持有任务行锁的提交事务不并发发送自己的心跳。
- 取消先进入 `CANCEL_REQUESTED`，由心跳、提交检查或失效租约回收结算为 `CANCELLED`。
- 暂停同样由 worker 检查后结算；不承诺请求瞬间打断准备工作。
- 失败结算返回事务真正提交的 `FAILED/PAUSED/CANCELLED`；处理器抛出的同名错误码不构成暂停或取消证据。
- 准备函数必须响应取消；即使它晚返回，执行器也不会调用其提交函数。
- 进程正常停止时不再领取任务，未提交的执行进入可重试失败；进程被杀时由租约回收恢复。
- 回收只扫描注册种类及指定分区；过期任务不重新执行，取消请求不变回普通排队任务。
- 只读队列快照提供状态计数、退避数量、死信数量、失效租约数和最老活动时间，不输出租约或正文。
- 排名通知只接受 `RANKING_*` 受控种类、三类源实体、不透明 ID 和正整数事件版本；源实体、事件键、请求者、收件人和 Workspace 必须匹配。任务指纹覆盖完整协议与账户、Membership、Workspace 版本，不使用会省略敏感字段的导出脱敏 hash。
- 入队在业务事务内完成；投递重新锁定账户、Workspace、Membership 和源实体，比较权限快照。移除后重新加入、账户暂停后恢复均不能复活旧任务；`NOWAIT` 锁冲突成为有界错误码和持久退避，不记录驱动异常正文。
- 直接写入与队列生产共用源实体和授权检查。入队时已经失效的收件人不产生通知，不阻断挑战结束、解散、移除或申诉处理；请求者失效、工作区失效或事件来源不匹配仍拒绝。已排队任务的收件人权限失效则进入不可重试失败。
- 通知接收资格不替代业务授权。挑战所有权转移必须在源事务内独立验证目标账户和 Membership 有效性，即使通知关闭也不能转给失效目标。
- `DataJob` 与 `UserNotification` 使用数据库 `ON CONFLICT DO NOTHING` 原子去重；同键异 scope/source 拒绝，重复投递不重置已读、隐藏或 revision。通知副作用与任务成功状态同事务提交。
- `PLATFORM_NOTIFICATION_QUEUE_ENABLED` 只有在 `PLATFORM_NOTIFICATIONS_ENABLED` 同时开启时才有效。队列关闭时，新事件可走既有直接事务路径；已排队事件不会因此自动切换消费协议。

## 验证与回退

默认 `pnpm check` 通过 Core/DB 单测覆盖规则和 worker 单元测试，并通过 `worker:data-jobs:typecheck` 检查执行器。
真实数据库与子进程证据另运行 `pnpm worker:data-jobs:runtime:selftest`：必须显式设置
`AREAFORGE_DATA_JOB_WORKER_ISOLATED_DB=1`，数据库只允许 loopback 且名称匹配 `areaforge_v20_worker_*`。
脚本再核对 `current_database()` 与全部 canonical migration 的名称、完成状态和 SQL checksum。
该入口不创建、迁移或删除数据库；外层必须获得隔离 fixture 授权。
内核入口仅执行合成副作用回归。通知域使用独立入口 `pnpm worker:notifications:runtime:selftest`，另要求
`AREAFORGE_RANKING_NOTIFICATION_ISOLATED_DB=1` 及相应独立确认；环境变量本身不是授权，不能因运行内核测试而隐式启用通知域写入。
通知专项覆盖受控事件种类、事务回滚、并发去重、scope/source 伪造、撤销后重入、运行中开关、锁竞争、冲突死信重放、
失效收件人的真实业务调用链，以及准备和通知事务写入后两个独立子进程强杀恢复点。

回退先停止消费与新协议生产者，保留任务、审计和兼容字段，不 DROP 表或猜测恢复旧代次。
存在新协议任务时，继续使用理解协议隔离的 Web 构建；不能让旧手工接口接管新队列。
已排队事件只能经事件键对账后受控恢复，不批量删除或盲目重放；隔离专项不证明真实账户投递、外部通知渠道或生产就绪。
内核回归不证明通知、排名重建、导出、删除、共享库、生产、Release 或浏览器验收。
