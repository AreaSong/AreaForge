# v1.1 Batch 5 资料与导入 confirm

```yaml
status: done
phase: complete
blockers: []
risk: high
ownerSkill: areaforge-file-storage-safety
validation:
  - pnpm check
  - pnpm db:validate
  - pnpm ops:v11:m5:runtime:selftest
  - pnpm --filter @areaforge/storage test
  - pnpm --filter @areaforge/core test
residualRiskIds:
  - AF-RISK-DATA-001
releaseRequired: false
```

## 目标

实现 FILE/LINK 资料与 Migration 5 导入历史/原子 confirm/一次性导出。DATA-001 未接受前不得开放 confirm。

## 完成摘要（2026-07-21）

- 生命周期确认包已接受；`AF-RISK-DATA-001` 已登记关闭/重开条件，**保持 deferred-work，未关闭**
- Storage：ZIP/Markdown MIME/magic；StudyResource allowlist 20MB；ZIP 仅 attachment disposition
- Attachment：workspace staging（noteId 可空）；下载支持 FILE StudyResource owner
- StudyResource 隔离 API：list/detail/LINK/staging/resolve/from-attachment/patch/links/archive/restore/download
- Migration 5：`20260721210000_v11_m5_learning_tree_import`（SyllabusNode stableKey/revision/archivedAt + LearningTreeImportBatch/Item）
- Confirm：`POST /api/learning-tree/imports/confirm` + history/export；幂等/409/原子回滚
- 临时库 selftest：`AREAFORGE_V11_M5_ISOLATED_DB=1 pnpm ops:v11:m5:runtime:selftest`
- **无**生产页面/导航；**未**生产 migration；**未**物理删除；**未**关闭 DATA-001

## 验证收口（2026-07-21 本会话复验）

| 命令 | 结果 |
|---|---|
| `pnpm db:validate` | PASS |
| `DATABASE_URL=postgresql://…@127.0.0.1:54333/areaforge_v11m5 pnpm db:migrate:deploy` | PASS（No pending；Migration 5 已在临时库） |
| `AREAFORGE_V11_M5_ISOLATED_DB=1 pnpm ops:v11:m5:runtime:selftest` | PASS（含 confirm 原子成功/失败回滚、幂等冲突、owner 外拒绝、导出无长期临时文件、resource directive gate、重复三选一） |
| `pnpm --filter @areaforge/storage test` | PASS（23） |
| `pnpm --filter @areaforge/core test` | PASS（65） |
| `pnpm check` | PASS |

## 禁止（仍有效）

- 不新增生产可路由页面或导航入口。
- 不物理删除导入历史/附件。
- 不在本批执行生产 migration / updater / residual 关闭。
