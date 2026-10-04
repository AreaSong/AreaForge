# v1.1 Compatibility Floor 本地证据

recordId: v11-compatibility-floor-local-20260722
recordedAt: 2026-07-22T03:18:06Z
evidenceClass: local-runtime
status: pass
candidateImplementationCommit: 9ac4c41394c2cfbf0e65d5c4b3a3463a4ba29088
compatibilityFloorCommit: c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4
compatibilityFloorPackageVersion: 0.1.9
databaseClass: disposable-local-postgresql-16
databaseMarker: v11compat
productMigrationCount: 8
repositoryMigrationCount: 20
migrationReplayStatus: no-pending-migrations
candidateSeedStatus: pass
floorProductionBuildStatus: pass
floorReadProbeStatus: pass
cleanupStatus: pass
residualRiskIds: AF-RISK-SC-002,AF-RISK-SC-004,AF-RISK-DATA-001
doesNotProve: signed Release, release asset trust, production health, production migration/apply/smoke/rollback, residual closure
safetyFacts:
  productionTouched: no
  productionWriteAttempted: no
  serverCommandAttempted: no
  backupRestoreAttempted: no
  updaterApplyAttempted: no
  releaseCreated: no
  residualLedgerUpdated: no
  secretValuePrinted: no

## 验证结论

- 当前候选先在一次性 PostgreSQL 16 数据库按仓库顺序应用全部 20 个 migration，其中包含产品 Migration 1→8；第二次 `prisma migrate deploy` 返回 `No pending migrations to apply`。
- 当前候选写入两个考试工作区、两个 `legacyCode=null` 自定义科目，以及同日期/周期但不同 `workspaceId` 的 DailyReview、CheckIn、PeriodicReportDecision 共六行，证明 workspace 复合唯一可实际承载新数据。
- 冻结 floor commit `c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4` 在独立 detached worktree 完成 frozen install、Prisma client 生成与 Web production build。
- 不还原数据库、不删除 additive schema，切换到 floor commit 的真实 `exam-workspace-service` 与该 commit 生成的 Prisma client 后，成功读取两个工作区、当前 ACTIVE 工作区、两个自定义科目和六行 workspace 复合唯一记录。
- 测试结束后已删除临时 worktree，并停止带 `--rm` 的一次性 PostgreSQL 容器；没有访问或修改生产。

## 可复现入口

源 fixture：`scripts/quality/v11-compatibility-floor-runtime.selftest.ts`。

1. 创建数据库名含 `v11compat` 的一次性 PostgreSQL 16 数据库。
2. 对该库运行 `pnpm db:migrate:deploy`。
3. 运行 `AREAFORGE_V11_COMPATIBILITY_FLOOR_ISOLATED_DB=1 DATABASE_URL=<isolated-v11compat-db> pnpm ops:v11:compatibility-floor:runtime:selftest seed`。
4. detached checkout `c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4`，依次运行 frozen install、`pnpm db:generate` 和 Web build。
5. 设置 `AREAFORGE_V11_COMPATIBILITY_FLOOR_ROOT=<detached-floor-root>` 与对应 `TSX_TSCONFIG_PATH`，再运行同一入口的 `probe` 模式。
6. 对同一数据库再次运行 `pnpm db:migrate:deploy`，必须返回无 pending migration。

## Migration 绑定

| Migration | SQL SHA-256 |
|---|---|
| M1 `20260721120000_v11_m1_exam_workspace_subject` | `db7957b5d9634822bd28eb179eac02994edcf28f5676565e93233eb22bc8fb86` |
| M2 `20260721130000_v11_m2_note_task_session_relations` | `b16d3b80e0195f21075051e89adb52c1b953e369c244988ef03e414a7c73c1b3` |
| M3 `20260721140000_v11_m3_milestone_dependency_inbox` | `13ef0f06c073c6b03aa437387db61af5cdcf8211e0c0255e5e2845ed8318787b` |
| M4 `20260721200000_v11_m4_study_resource` | `41394f3ee11302edbaf9543c4f0838d75e28829261ff60be52498d4f70744ee1` |
| M5 `20260721210000_v11_m5_learning_tree_import` | `de7b2a53f103fd264c1e62c0d90969692fe79e45b7a3fe2fa1e6bc54d8670bfb` |
| M6 `20260721220000_v11_m6_review_checkin_v2` | `abe1d45c357e5e29e47e9f10bb696a4d357e5017f90b3969572b1cb0f295a103` |
| M7 `20260721230000_v11_m7_canvas_motivation_notification` | `aa79c57ebcc1d75c9c1e3552c36a84698b374f3cb9fb582b7bbda3cd1d7aedbc` |
| M8 `20260722010000_v11_m8_simulation_loss` | `c6a09e28a38b26566ba37ad1c8c84b3a678901b2ac1a3b63e7a95fa52c49922c` |

本记录只证明本地 application rollback compatibility。签名 Release 必须另行冻结 compatibility floor image digest；生产 apply、数据库或 uploads restore、DROP、数据修复和 residual 关闭仍需各自确认。
