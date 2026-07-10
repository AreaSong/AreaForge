# 文档同步检查清单

## 目标

防止 `docs/`、`README.md`、`AGENTS.md`、`tasks/`、`workflow/` 之间出现源事实漂移。

## 源事实顺序

1. `docs/product/**`：产品定位、范围、路线图。
2. `docs/architecture/**`：工程结构、数据、API、部署、文件存储、AI 边界。
3. `docs/modules/**`：业务模块行为。
4. `docs/ux/**`：页面状态和交互。
5. `docs/security/**`：高风险边界。
6. `docs/development/**`：开发顺序、验证和工作流。
7. `workflow/versions/**`：版本计划。
8. `tasks/**`：执行任务。

## 必查项

- 新功能是否有 `docs/modules/**` 或 `docs/product/**` 落点。
- 新 API 是否同步 `docs/architecture/api-surface.md`。
- 新表或字段是否同步 `docs/architecture/data-model.md`。
- 上传、附件、AI、认证、部署变化是否同步安全文档。
- 上传、附件、`UPLOAD_DIR`、文件对账、备份/恢复或上传目录迁移变化是否同步 `docs/architecture/file-storage.md`、`docs/security/file-ai-safety.md`、`docs/deployment/backup-restore.md` 和 `areaforge-file-storage-safety`。
- 功能更新若进入线上，是否按 `docs/development/release-record-template.md` 同步 release tag、GitHub Release、GHCR digest、线上 health、update-agent 状态、回滚目标、`pnpm ops:evidence:bundle` 的 `bundleHash`、`pnpm ops:alert:preview` 的告警预览结论和残余风险。
- 完成声明是否能按 `docs/development/completion-evidence-checklist.md` 说清证据等级、新鲜验证、未验证项、阻断项、Release 需求和 residual risk IDs。
- 写动作或运行时能力变化是否按 `docs/development/runtime-write-boundary.md` 标明 R0-R4 等级，避免把 preview、local smoke、update request 或草稿说成生产 apply。
- 功能更新若准备进入线上，是否先按 `docs/development/release-train.md` 固定版本、验证、Release 资产、供应链记录、updater 证据、smoke、回滚目标和停止条件。
- 新签名 Release 若用于关闭或复核供应链残余项，是否按 `docs/development/release-supply-chain-record-template.md` 记录 SBOM/provenance、checksum/signature、Actions pinning 和 `pnpm audit:prod`，并通过 `pnpm release:supply-chain:validate`。
- 生产运维、发布、自动更新或长期运营状态变化，是否同步 `docs/development/operational-readiness.md`、`docs/development/residual-risk-ledger.md` 和对应 ops/release 文档。
- 日常维护节奏、证据新鲜度或 residual 复核规则变化，是否同步 `docs/development/maintenance-cadence.md`、`docs/development/operational-readiness.md`、验证矩阵和相关 observability/residual skill。
- 自托管上手、公开分发或首次操作者路径变化，是否同步 `docs/deployment/operator-onboarding.md`、`README.md`、`docs/README.md`、`apps/web/README.md`、验证矩阵和相关 SRE/release skill。
- 生产只读 smoke 记录若进入仓库或运维交接摘要，是否使用 `docs/development/production-readonly-smoke-record-template.md` 并通过 `pnpm smoke:prod-readonly:validate`。
- 告警/恢复演练记录若进入仓库或运维交接摘要，是否使用 `docs/development/alert-drill-record-template.md` 并通过 `pnpm alert:drill:validate`。
- 真实产品体验复核记录若进入仓库或 release/update 交接摘要，是否使用 `docs/development/product-experience-review-record-template.md` 并通过 `pnpm experience:review:validate`。
- 若变更长期运营 workflow 或 skill，是否同步 `.codex/skills-src/**`、`.agents/skills/**`、`README.md`、`AGENTS.md` 和相关验证/残余风险入口，并运行 `pnpm skills:validate`。
- 若变更公开项目治理、依赖、CI、PR 模板或安全披露入口，是否同步 `SECURITY.md`、`.github/**`、`docs/development/dependency-policy.md`、`README.md` 和验证矩阵，并运行 `pnpm governance:preflight`。
- 若变更公开支持、issue 模板、ops support 或 triage 规则，是否同步 `SUPPORT.md`、`.github/ISSUE_TEMPLATE/**`、`docs/development/support-intake.md`、`README.md`、`docs/README.md` 和验证矩阵，并运行 `pnpm support:intake:preflight`。
- 若引入或扩大 subagent、MCP、Browser/Computer Use、自动化、部署插件或远程运维工具，是否同步 `docs/development/external-capability-admission.md`，并确认没有绕过 Web runtime 服务器命令禁区。
- README 是否只导航，不承载更深规则。
- AGENTS 是否只放协作规则和高风险边界，不替代详细设计。
- `tasks/**` 是否引用对应源事实。
- `workflow/versions/**` 是否有入口条件、范围、不包含和验收标准。

## 旧内容检查

完成拆分或迁移后，应检查：

- 旧顶层方案文件名无残留引用。
- 同一功能没有在多个文档中定义不同规则。
- 暂缓项没有被写进当前版本验收标准。
- 历史讨论没有变成当前产品事实。

## 推荐命令

```bash
rg -n "AreaForge产品""方案|AreaForge工程结构""方案|产品""方案\\.md|工程结构""方案\\.md" README.md AGENTS.md docs tasks workflow
find docs tasks workflow -maxdepth 3 -type f | sort
git diff --check
pnpm docs:readiness
pnpm docs:completion
```

## 完成标准

- 入口路径一致。
- 源事实和执行任务能互相追踪。
- 暂缓项、当前范围和第二阶段增强没有冲突。
- 未发现旧文件名或旧路径残留。
