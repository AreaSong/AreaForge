# 0038 A -> B 平台演进 M0 基线归一

```yaml
status: done
phase: complete
blockers: []
risk: medium
ownerSkill: areaforge-operating-loop
validation:
  - pnpm install --frozen-lockfile
  - pnpm audit:all
  - pnpm audit:prod
  - pnpm governance:preflight
  - pnpm check
  - pnpm docs:readiness
  - pnpm tasks:doctor
  - git diff --check
residualRiskIds: []
releaseRequired: false
```

状态：已完成。依赖审计、治理门禁、状态同步、受保护 PR、PR CI 和合并后 main CI 均已通过；M0 不代表 v1.3-v2.0 runtime、Release 或 production apply 已完成。

## 目标

在进入多用户、权限、数据生命周期、运维和排名实现前，收敛当前依赖、分支、PR、版本、生产和任务源事实。

## 范围

- 包含：依赖审计修复、路线/任务落盘、状态漂移清单、当前分支 PR/CI、M0 完成证据。
- 不包含：认证/权限 migration、数据删除/导出 runtime、生产 apply、服务器命令、排名 runtime。

## 参考源事实

- `docs/product/roadmap.md`
- `workflow/versions/v1.3-v2.0-platform-evolution.md`
- `docs/development/dependency-policy.md`

## Owner Skill

- `.codex/skills-src/areaforge-operating-loop`
- `.codex/skills-src/areaforge-supply-chain`
- `.codex/skills-src/areaforge-doc-sync`

## 验收标准

- 全/生产依赖审计通过，锁文件可冻结安装。
- 当前开发分支通过受保护 PR required checks。
- checkout、Release、生产和未来计划状态在入口文档中无冲突。
- 后续高风险工作均有独立任务和确认边界。

## 高风险边界

- 本任务不授权 production apply、migration、删除、导出、认证/权限变化或服务器执行。
- 若选择应用 `v1.2.0` 或跳过并发布下一版本，使用独立 Release/SRE 确认包。

## 残余风险

- M0 完成不表示 v1.3-v2.0 功能完成。

## 完成证据

- 冻结安装、`pnpm audit:all`、`pnpm audit:prod`、`pnpm governance:preflight`、`pnpm check`、`pnpm docs:readiness`、`pnpm tasks:doctor` 和 `git diff --check` 已通过。
- PR #54（`https://github.com/AreaSong/AreaForge/pull/54`）的两个 required `verify` 运行已通过，均绑定提交 `9001f37`。
- PR 已 squash 合并到 `main`，合并提交为 `7720177d9ab691d509004ce8c8201e631f84be0f`；main push CI run `33879794378` 已通过全部治理、审计、文档和 `Check` 步骤。
- 当前生产仍为 `v1.1.1`，最新稳定 Release 仍为 `v1.2.0`；本任务未执行 production apply、migration、备份恢复、回滚或服务器命令。
