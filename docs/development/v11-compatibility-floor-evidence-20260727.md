# v1.1 Compatibility Floor 24-Migration 本地证据

recordId: v11-compatibility-floor-local-20260727
recordedAt: pending
evidenceClass: local-runtime
status: pending-local-rerun
candidateImplementationCommit: 552b23547ac4b216d5d5d77a822cc3f1c623136b
candidateWorktreeFingerprint: pending
compatibilityFloorCommit: c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4
compatibilityFloorPackageVersion: pending
databaseClass: disposable-local-postgresql-16
databaseName: pending
legacyMigrationCount: 12
floorMigrationCount: 15
repositoryMigrationCount: 24
migrationReplayStatus: pending
candidateSeedStatus: pending
floorProductionBuildStatus: pending
floorReadProbeStatus: pending
cleanupStatus: pending
residualRiskIds: AF-RISK-SC-002,AF-RISK-SC-004,AF-RISK-DATA-001
doesNotProve: signed Release, release asset trust, production health, production migration/apply/smoke/rollback, residual closure

## 当前边界

本文件替代旧 20-migration 记录作为当前 24-migration 候选的待采入口。验证尚未重跑前保持
`pending-local-rerun`，不得作为 v1.1 完成或 Release admission 证据。

`docs/development/v11-compatibility-floor-evidence-20260722.md` 保留为历史记录，不覆盖、不删除，也不复用其
20-migration PASS 结论。

## 预期验证

- `pnpm ops:v11:compatibility-floor:manifest:selftest` 精确核对 12 / 15 / 24 三段 migration manifest。
- Node.js 24 下对一次性 PostgreSQL 16 运行 `pnpm ops:v11:compatibility-floor:orchestrate`。
- 精确校验数据库名、24 行 Prisma ledger、SQL/database checksum、完成/回滚/失败状态及 repeat deploy。
- 写入 legacy Subject、自定义 `legacyCode=null` 科目、第二工作区和 workspace 复合唯一 fixture，并验证同 workspace 重复写拒绝。
- detached floor 完成 frozen install、Prisma generate、production build，并从同一升级库读取全部兼容 fixture。
- candidate dirty-worktree fingerprint 在 seed、probe、final validate 间一致；floor checkout 始终 clean。

## 安全事实

- 不访问或修改生产。
- 不创建 tag、GitHub Release、GHCR image 或签名资产。
- 不执行 backup/restore、DROP、数据修复或 updater apply。
- 只允许删除本轮创建并精确命名的一次性本地数据库、角色、临时 worktree 和临时上传目录。
- `AF-RISK-DATA-001` 保持 `deferred-work`，本地验证不关闭任何 residual。
