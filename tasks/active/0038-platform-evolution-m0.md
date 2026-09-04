# 0038 A -> B 平台演进 M0 基线归一

```yaml
status: in-progress
phase: implementation
blockers:
  - current branch has no protected pull request yet
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

状态：执行中。当前已定位并修复 Prisma 工具链间接依赖审计阻断，正在同步 A -> B 源事实；受保护 PR、CI 和状态漂移收口尚未完成。

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
