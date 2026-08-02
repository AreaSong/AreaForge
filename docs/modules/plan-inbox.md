# 计划收件箱

## 目标

把复盘、报告、阶段、模拟、低转化、恢复与显式 AI 产生的计划建议统一为可补全、可转换的草稿，系统不静默创建正式任务。

## 当前实现（隔离分支）

- Schema：`PlanInboxItem` / `PlanInboxDependencyRef` / `PlanMilestone` / `TaskDependency`。
- API：`/api/plan-inbox/**`（列表、创建、编辑、dismiss、reopen、convert）；`/api/plan-milestones/**`；`/api/tasks/:id/dependencies/**`；`GET /api/plan/rolling`（仅计数，不泄正文）。
- 已开放隔离原子 convert：同事务创建 `StudyTask`、置 `CONVERTED`、写审计；可选绑定 `reviewScheduleId` 桥接。
- UI：`/today/inbox`、`/today/inbox/[itemId]`、`/today/plan` Inbox 数量入口。

## 规划行为

- 持久状态为 `OPEN` / `DISMISSED` / `CONVERTED`；`supersededByItemId` 是版本替代引用，不是第四状态。
- 自动入箱：明日最低行动、已确认报告/阶段中的计划草稿。
- 显式入箱：低转化补救、恢复建议、模拟补救、用户加入的 AI 计划草稿。
- 转换时校验工作区、科目、主考纲节点与依赖环；同批依赖按拓扑顺序展示。
- 报告确认与阶段确认独立；均可原子入箱，但不互相隐式触发。
- 计划页入口统计全部未被替代的待处理草稿，包括尚未填写日期的草稿；不能用“已有日期”的子集冒充完整待处理数。
- 列表按状态提供唯一接力：待处理草稿进入补全或确认，已转换草稿打开正式任务，历史详情退为次级入口。
- 日期仍允许精确选择，同时提供“今天 / 明天”快捷安排；快捷按钮只修改本地草稿，保存或转换仍需用户显式确认。
- 结果页接力必须保留来源上下文：每日复盘、周期报告、阶段处理结果、模拟补救和低转化补救进入收件箱时，通过安全 `returnTo` 返回原结果页或专注详情，并保留该路由允许的视图筛选；收件箱自身的状态与稳定引用筛选仍由收件箱契约单独维护。
- 模拟失分的收件箱详情提供“查看来源考试”回溯；进入模拟详情后继续处理补救或阶段判断，仍保留收件箱详情及其上游来源，避免来源摘要变成单向跳转。

## 非目标

- 不提供忽略依赖的批量强制转换。
- 不自动应用阶段计划到现有任务。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
