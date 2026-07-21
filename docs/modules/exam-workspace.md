# 考试工作区

## 目标

为备考提供单一当前考试范围边界：科目、阶段、推荐、通知与新写入只作用于 ACTIVE 工作区；历史工作区可归档只读回放。

## 当前实现（隔离分支）

- Schema：`ExamWorkspace` / `SubjectGroup`；`Subject.legacyCode` 可空；legacy 行 `workspaceId IS NULL`。
- API：`/api/exam-workspaces/**`（创建、激活、接管 preview/apply、科目分组、科目列表 GET、自定义科目）。
- UI：`/settings/workspace` 首次设置两步流（目标与科目 → 旧数据接管）；取消不创建 ACTIVE。
- 生产默认导航切换见版本计划完整 minor Release；状态见 `docs/development/feature-traceability.md`。

## 规划行为

- 每个用户最多一个 ACTIVE `ExamWorkspace`；切换 ACTIVE 时原子归档原工作区。
- 默认科目可接管到新工作区，也可暂不接管并创建新科目；确认前必须预览影响。
- `SubjectGroup`（如 408）只负责组织展示，不承载 session/任务/排期。
- 自定义科目使用 stableKey，不伪造封闭枚举 code。

## 非目标

- 不在本模块实现多用户协作或跨用户工作区共享。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
