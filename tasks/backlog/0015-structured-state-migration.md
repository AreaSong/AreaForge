# 0015 结构化学习状态 migration 确认包

状态：待确认。该任务命中数据库 migration 高风险边界，开始实现前必须先确认影响、风险、验证和回滚。

## 目标

把当前依赖文本备注、实时派生和轻量字段的学习状态，升级为结构化、可审计、可统计的数据库模型。

## 范围

- `StudySession` 结构化收口字段：理解程度、最小产出、下一步动作、是否产生笔记/错题、反假学习原因。
- `CheckIn` 每日快照：学习日、最低动作、总/有效时长、任务完成率、复盘完成、连续性辅助字段。
- 任务债务事件账本：补做、延期、放弃、拆小、合并、改复习、父子关系、重排采纳记录。
- 恢复模式状态：触发原因、开始时间、目标分钟、退出条件、用户手动触发记录。
- 掌握证明：条件勾选、证据引用、复测记录。
- 模拟考试和阶段计划所需的基础结构可以作为同批或后续批次，但必须单独列出。

## 建议执行批次

1. Batch 0：`StudySession` 结构化收口字段，继续保留 `note` 双写。
2. Batch 1：`CheckIn` 日快照，新写路径 upsert，旧数据 fallback 派生。
3. Batch 2：`StudyTask.parentTaskId` 与 `TaskDebtEvent`，债务动作双写审计。
4. Batch 3：`RecoveryState`，记录规则触发和手动恢复，不批量改任务。
5. Batch 4：`MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`。
6. Batch 5：`SimulationExam` 与 `SimulationSubjectResult`。
7. Batch 6：`StagePlan` 与 `StageAdjustmentDraft`，建议默认不可自动应用。

## 批次状态

| 批次 | 当前状态 | 说明 |
|---|---|---|
| Batch 0 | 待确认 | `StudySession` 结构化收口字段；下一步推荐先确认该批 |
| Batch 1 | 待确认 | `CheckIn` 日快照 |
| Batch 2 | 待确认 | `StudyTask.parentTaskId` 与 `TaskDebtEvent` |
| Batch 3 | 待确认 | `RecoveryState` |
| Batch 4 | 待确认 | 掌握证明条件、证据和复测记录 |
| Batch 5 | 待确认 | `SimulationExam` 与 `SimulationSubjectResult` |
| Batch 6 | 待确认 | `StagePlan` 与 `StageAdjustmentDraft` |

## 当前推荐下一步

先确认并执行 Batch 0。该批只处理 `StudySession` 结束计时收口，不新增其它表：

- 新增理解程度、最小产出、下一步动作、是否产生笔记/错题、低转化原因、补产出要求和收口版本字段。
- `endStudySession` 写入结构化字段，同时继续写 `note = closeout.closeoutText`。
- 历史 session 不解析、不回填，读取时保留旧文本 fallback。
- 完成后为 Batch 1 `CheckIn`、反假学习统计和周期报告提供可靠输入。

确认细节见 `docs/development/high-risk-confirmation-packets.md` 的 “Batch 0 确认包：`StudySession` 结构化收口字段”。

## 不包含

- 删除旧字段。
- 批量清空或重写历史任务、计时、复盘、错题、笔记。
- 自动应用任务重排或阶段调整。
- 生产 migration deploy。

## 参考源事实

- `docs/development/implementation-order.md`
- `docs/architecture/data-model.md`
- `docs/modules/check-in.md`
- `docs/modules/task-debt.md`
- `docs/modules/anti-fake-study.md`
- `docs/modules/recovery-mode.md`
- `docs/modules/mastery-proof.md`
- `docs/modules/simulation-exam.md`
- `docs/development/structured-state-migration-design.md`

## 确认前必须说明

- 每个新增模型、字段、索引和关系。
- 旧数据如何兼容读取，哪些字段只从新数据开始准确。
- 是否需要回填；若需要，只允许非破坏性、可重复、可审计回填。
- 新旧口径并存期如何显示和验证。
- 本地、临时库、生产环境的迁移顺序。
- 失败时如何回滚代码、保留数据和恢复备份。

## Batch 0 验收标准

- migration 采用 additive 策略，只新增 `StudySession` 收口字段，不新增其它表。
- `endStudySession` 写入结构化字段，同时继续写 `note = closeout.closeoutText`。
- 历史 `StudySession.note` 不解析、不回填，旧记录仍能展示。
- 首页结束一次计时后刷新，仍能看到有效/低转化状态和收口文本。
- `pnpm db:validate`、临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`、`pnpm --filter @areaforge/core test`、Web typecheck/lint 和 `pnpm check` 通过。
- 完成后只更新 Package B Batch 0 证据，Package B 主状态仍保持未完成。

## Package B 总体验收标准

- migration 采用 additive 策略，不删除旧字段。
- `pnpm db:validate` 通过。
- 临时库显式 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy` 通过。
- 旧数据仍能打开首页、任务、计时、复盘、考纲、错题和报告。
- 新结构能支撑打卡、债务、恢复、反假学习和掌握证明的主读取路径。
- `pnpm check` 通过。

## 验证

- `pnpm db:validate`
- `pnpm db:migrate:diff:empty`
- 临时库显式设置 `DATABASE_URL=<临时库 URL> pnpm db:migrate:deploy`。
- 相关 API 烟测：dashboard、tasks、study-sessions、reviews、syllabus、mistakes、analytics、reports。
- 页面烟测：首页、`/syllabus`、`/analytics`、`/reports`。

## 风险

- migration 失败导致应用启动失败。
- 旧数据无法映射到新结构，造成统计口径变化。
- 新旧口径并存期间用户看到不一致数据。
- 生产执行前若没有备份，无法安全回滚。

## 回滚

- 开发期优先回滚代码，不删除已新增字段或表。
- 生产环境执行前必须有数据库备份点。
- 若 migration 已部署，回滚到上一镜像后保留新增表字段，后续用兼容代码处理。
- 任何删除或压缩历史数据的清理任务都必须另开任务并再次确认。
