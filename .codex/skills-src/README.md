# AreaForge Skills Source

这里是 AreaForge repo-local Codex skills 的源事实目录。

产品和工程语义仍以 `docs/**`、`tasks/**`、`workflow/**`、`ops/**`、`README.md` 和 `AGENTS.md` 为准；本目录只承载 Codex 可复用工作流说明。

## 当前 Skills

- `areaforge-enterprise-governance`：CI、发布治理、依赖准入、仓库策略、PR/安全治理和整体企业级门禁。
- `areaforge-public-maintenance`：公开 issue、支持入口、贡献者 PR、敏感信息边界和维护者 triage。
- 公开支持入口为 `SUPPORT.md` 和 `docs/development/support-intake.md`，对应只读检查为 `pnpm support:intake:preflight`。
- `areaforge-operating-loop`：按 Quick/Change/Mission-Critical/Review/Ops/Release/Incident 路由 owner skill、验证、文档同步和残余风险收口。
- 长期运营控制面入口为 `docs/development/long-term-operability-control-plane.md`，对应只读检查为 `pnpm enterprise:operability:preflight`；离线状态投影为 `pnpm ops:status`；完成声明前的严格 live evidence gate 为 `pnpm ops:long-term:gate`。默认不新增第 18 个 skill，除非出现新的稳定 owner 边界。
- 完成声明记录入口为 `docs/development/completion-evidence-checklist.md`，对应记录形态校验为 `pnpm completion:evidence:validate <record>`，规则回归为 `pnpm completion:evidence:selftest`；它不替代 runtime、release、production、smoke 或 long-term live gate。
- `areaforge-release-operator`：功能完成后的版本、GitHub Release、GHCR digest、updater、回滚和证据闭环。
- Release train 入口为 `docs/development/release-train.md`，对应只读检查为 `pnpm release:train:preflight`。
- `areaforge-qa-smoke`：真实用户旅程、API/browser smoke、截图和体验证据。
- `areaforge-doc-sync`：README、docs、tasks、workflow、ops、skills 状态防漂移。
- `areaforge-git-checkpoint`：本地 staging、commit、push、release tag 前的范围隔离、验证证据和残余风险检查。
- `areaforge-sre-ops`：生产健康、备份、恢复、update-agent、Nginx、容器和受控生产操作。
- 自托管操作者上手入口为 `docs/deployment/operator-onboarding.md`，对应只读检查为 `pnpm operator:onboarding:preflight`。
- 维护节奏入口为 `docs/development/maintenance-cadence.md`，对应只读检查为 `pnpm maintenance:cadence:preflight`。
- 运营证据包使用 `pnpm ops:evidence:bundle` 生成，保存后用 `pnpm ops:evidence:bundle:validate` 校验 hash、信号、禁止动作和只读 safety facts。
- `pnpm ops:long-term:gate` 只读聚合 OPS-001、OPS-004、签名 Release 供应链和新鲜 UX 证据；缺证据时失败，但不收集证据、不执行服务器命令、不修改 residual 台账。
- 维护窗口、事故、恢复演练、update-agent redacted status、OPS-001 收口包和 OPS-004 告警证据分别使用 `pnpm maintenance:window:validate`、`pnpm incident:record:validate`、`pnpm restore:drill:validate`、`pnpm update-agent:status:validate`、`pnpm ops:ops-001:preflight` / `pnpm ops:ops-001:closure:validate` 和 `pnpm ops:ops-004:preflight`。
- `areaforge-observability`：health、日志、release identity、update-agent、备份新鲜度、AI fallback 和生产信号证据。
- `areaforge-incident-response`：故障分级、证据冻结、止血、回滚决策、恢复验证和复盘收口。
- `areaforge-security-governance`：鉴权、上传、AI、密钥、日志、签名 release、服务器命令边界，以及 `areaforge-data-governance` 成熟前的数据生命周期临时主协调。
- `areaforge-file-storage-safety`：附件上传/下载、私有 `UPLOAD_DIR`、metadata/hash、对账、删除、文件导出/留存、备份恢复和上传目录迁移安全门禁。
- `areaforge-supply-chain`：GitHub Actions、Release assets、GHCR digest、签名、hash、依赖和 updater 信任门禁。
- `AF-RISK-SC-002` 供应链证据预检使用 `pnpm sc:sc-002:preflight`，它只读本地 CI-only 或签名 Release redacted 记录，不创建 Release、不推 tag、不联网。
- `areaforge-residual-ledger`：阻塞、延期、接受例外、发布 follow-up、监控缺口、数据生命周期候选残余和关闭条件分类。
- `areaforge-product-experience`：学习闭环的真实体验、可用性、移动视口和产品打磨。
- `areaforge-ai-governance`：AI provider、最小上下文、fallback、限流、日志脱敏、AI history/token/cost/provider trace 留存和费用边界。
- `areaforge-validation-driver`：按改动范围选择最小充分验证并报告证据。

## Owner 边界

| Skill | Owner | 常见交接 |
|---|---|---|
| `areaforge-enterprise-governance` | CI、发布治理、依赖准入、仓库规则、review/ownership/安全政策 | 供应链细节交给 `areaforge-supply-chain`；安全细节交给 `areaforge-security-governance`；验证交给 `areaforge-validation-driver` |
| `areaforge-public-maintenance` | 公开 issue、support intake、贡献者 PR、敏感信息边界、维护者 triage | 仓库政策交给 `areaforge-enterprise-governance`；安全披露交给 `areaforge-security-governance`；ops 支持交给 `areaforge-sre-ops`；release/update 交给 `areaforge-release-operator` |
| `areaforge-operating-loop` | 任务分级、owner skill 路由、验证选择、文档同步和残余风险收口编排 | 具体语义交给对应 owner skill；数据生命周期临时交给 `areaforge-security-governance` 协调；生产动作交给 `areaforge-sre-ops`；发布交给 `areaforge-release-operator` |
| `areaforge-release-operator` | Release、tag、GitHub Release、镜像 digest、server updater、回滚证据 | 验证交给 `areaforge-validation-driver`；生产状态交给 `areaforge-sre-ops`；文档同步交给 `areaforge-doc-sync` |
| `areaforge-qa-smoke` | 用户旅程、浏览器/API smoke、截图和体验证据 | 产品判断交给 `areaforge-product-experience`；release smoke 交给 `areaforge-release-operator` |
| `areaforge-doc-sync` | README/docs/tasks/workflow/ops/skills 状态一致性 | 运行门禁交给 `areaforge-validation-driver`；release 字段交给 `areaforge-release-operator` |
| `areaforge-git-checkpoint` | staging、commit、push、release tag 前的范围隔离、验证证据和残余风险检查 | 验证选择交给 `areaforge-validation-driver`；release/tag 交给 `areaforge-release-operator`；文档同步交给 `areaforge-doc-sync` |
| `areaforge-sre-ops` | 线上健康、备份、恢复、update-agent、Nginx、容器、受控生产操作 | 观测证据交给 `areaforge-observability`；事故流程交给 `areaforge-incident-response`；安全边界交给 `areaforge-security-governance` |
| `areaforge-observability` | health、日志、updater、备份、release identity、AI fallback 和运行信号 | 生产动作交给 `areaforge-sre-ops`；用户旅程交给 `areaforge-qa-smoke`；事故交给 `areaforge-incident-response` |
| `areaforge-incident-response` | 故障分级、证据冻结、止血、回滚决策、恢复验证和复盘 | 生产执行交给 `areaforge-sre-ops`；安全事件交给 `areaforge-security-governance`；残余项交给 `areaforge-residual-ledger` |
| `areaforge-security-governance` | 鉴权、上传、AI、密钥、日志、签名、命令边界和数据生命周期临时主协调 | 供应链细节交给 `areaforge-supply-chain`；AI 细节交给 `areaforge-ai-governance`；文件生命周期交给 `areaforge-file-storage-safety`；生产操作交给 `areaforge-sre-ops`；残余项交给 `areaforge-residual-ledger` |
| `areaforge-file-storage-safety` | 附件上传/下载、私有上传目录、文件 metadata/hash、对账、删除、导出/留存、备份恢复和迁移安全 | 鉴权和高风险边界交给 `areaforge-security-governance`；生产备份/恢复交给 `areaforge-sre-ops`；验证选择交给 `areaforge-validation-driver` |
| `areaforge-supply-chain` | GitHub Actions、Release assets、GHCR digest、签名、hash、依赖和 updater 信任 | 发布执行交给 `areaforge-release-operator`；仓库规则交给 `areaforge-enterprise-governance` |
| `areaforge-residual-ledger` | blockers、deferred work、accepted exceptions、monitoring gaps、release follow-ups、数据生命周期候选残余和关闭条件 | 源事实同步交给 `areaforge-doc-sync`；事故 follow-up 交给 `areaforge-incident-response`；稳定数据残余族出现前先使用现有 security/file/AI/SRE owner |
| `areaforge-product-experience` | 真实体验、信息架构、文案、可用性、移动视口 | 验证交给 `areaforge-qa-smoke`；源事实同步交给 `areaforge-doc-sync` |
| `areaforge-ai-governance` | AI 上下文、provider、fallback、限流、日志、history/token/cost/provider trace 留存和费用边界 | 高风险安全审查和数据生命周期归口交给 `areaforge-security-governance` |
| `areaforge-validation-driver` | 验证选择、命令执行、证据报告 | 不拥有产品语义；失败归因后交回对应 owner |

## 维护规则

- `health`、`readiness`、`doctor`、`gate` 和 `smoke` 是不同证据词，不能互相替代；缺哪个证据就保留对应 residual 或降级结论。
- 项目级 skill 以 `.codex/skills-src/<skill>/SKILL.md` 为源。
- `.agents/skills/<skill>` 仅作为自动发现入口，默认指向 `.codex/skills-src/<skill>`。
- 不在 skill 目录内添加 README、changelog 或低价值说明。
- 变更 skill 时同时核对 `agents/openai.yaml` 的 `display_name`、`short_description` 和 `default_prompt` 是否仍覆盖 `SKILL.md` 的触发语义；`pnpm skills:validate` 会检查每个 skill 的关键触发词。
- 变更 skill 后运行 quick validate、`git diff --check`，并按改动范围运行 docs/risk/check 门禁。
- 每次 Release 前、季度维护或 owner 边界变化时，复核相关 skill 是否仍指向当前源事实：release/update 看 release、supply-chain、SRE、observability；生产 smoke 和体验看 QA/product；残余关闭看 residual/doc-sync；安全、AI、上传或数据生命周期变化看 security、AI 和 file-storage。复核后至少运行 `pnpm skills:validate`、`pnpm docs:readiness` 和对应 owner preflight。
