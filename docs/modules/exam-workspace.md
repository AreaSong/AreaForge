# 考试工作区

## 目标

为备考提供单一当前考试范围边界：科目、阶段、推荐、通知与新写入只作用于 ACTIVE 工作区；历史工作区可归档只读回放。

## 当前实现（隔离分支）

- Schema：`ExamWorkspace` / `SubjectGroup`；`Subject.legacyCode` 可空；legacy 行 `workspaceId IS NULL`。
- API：`/api/exam-workspaces/**`（创建、激活、接管 preview/apply、科目与分组读取/创建/编辑/相邻排序/归档/恢复）；所有修改使用 workspace revision，归档分组不能接收新科目。这里的删除语义是可恢复归档，不提供会破坏学习历史的物理删除。
- UI：`/settings/exams` 首次设置两步流（目标与科目 → 旧数据接管）；取消不创建 ACTIVE。已有工作区可直接管理科目和分组的名称、颜色、归属和顺序，并可归档或恢复。
- 科目归档前阻止最后一个活动科目和仍有活动计时的科目被归档；归档保留任务、计时、知识和排期历史，把相关活动复习排期标为 `PAUSED / SUBJECT_ARCHIVED` 并清空可执行到期日。恢复科目时只重启这些由科目归档暂停的排期，将其安排到当前学习日并报告恢复数量；用户可随后逐项改期。
- 分组归档先显示影响确认，并在同一事务中把组内科目移到“不分组”；恢复分组不会猜测旧成员关系，用户可按需重新关联。
- 首次设置中的 408 四科是默认未勾选的显式模板，不是后台默认科目；自定义首科为空时不会自动创建高等数学。
- 当前产品默认导航已经按考试工作区组织；状态见 `docs/development/feature-traceability.md`。

## 规划行为

- 每个用户最多一个 ACTIVE `ExamWorkspace`；切换 ACTIVE 时原子归档原工作区。
- 默认科目可接管到新工作区，也可暂不接管并创建新科目；确认前必须预览影响。
- `SubjectGroup`（如 408）只负责组织展示，不承载 session/任务/排期。
- 自定义科目使用 stableKey，不伪造封闭枚举 code。
- 科目与分组的上移/下移只交换相邻活动项，并在同一事务内把活动排序归一化为 `10,20,30...`；边界操作是无副作用 no-op。

## 非目标

- 不在本模块实现多用户协作或跨用户工作区共享。

权威规格见 `workflow/versions/v1.1-learning-action-center.md`；实现状态见 `docs/development/feature-traceability.md`。
