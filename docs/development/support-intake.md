# Support Intake

## 目标

本文件定义 AreaForge 公开仓库的支持入口、issue triage 和敏感信息边界。它面向公开分发和自托管用户，不替代 `SECURITY.md`、`CODE_REVIEW.md`、`docs/deployment/operator-onboarding.md` 或 `docs/development/release-train.md`。

## 入口

- `SUPPORT.md`：用户先读入口，说明在哪里提问、哪些内容不能公开。
- `.github/ISSUE_TEMPLATE/bug_report.md`：可复现 bug。
- `.github/ISSUE_TEMPLATE/feature_request.md`：产品或工程改进。
- `.github/ISSUE_TEMPLATE/ops_support.md`：自托管、Release updater、备份恢复、smoke、告警、回滚或供应链证据问题。
- `SECURITY.md`：安全漏洞私密报告。
- `.codex/skills-src/areaforge-public-maintenance`：维护者处理公开 issue、贡献者 PR、敏感信息边界和 owner skill 路由时的 Codex 工作流入口。

## Triage 分类

| 类别 | 例子 | 初始 owner |
|---|---|---|
| Product bug | dashboard、timer、notes、syllabus、reports、simulation 展示或行为异常 | `areaforge-product-experience` / `areaforge-qa-smoke` |
| Data or auth bug | session、actor、数据库读写、附件 metadata、上传目录 | `areaforge-security-governance` |
| Ops support | 自托管、Nginx、Docker Compose、updater、备份、smoke、rollback | `areaforge-sre-ops` |
| Release or supply chain | GitHub Release、GHCR digest、SBOM/provenance、签名、Actions、audit | `areaforge-release-operator` / `areaforge-supply-chain` |
| AI behavior | provider、fallback、上下文、日志、限流、费用 | `areaforge-ai-governance` |
| Security | auth bypass、secret exposure、path traversal、supply-chain trust break | `SECURITY.md` private path |

## 严重度

- `P0`：确认的数据泄露、远程命令执行、认证绕过、生产更新器信任链破坏、备份/恢复导致数据损坏。
- `P1`：核心学习闭环不可用、登录不可用、附件访问异常、Release/update 无法安全回滚。
- `P2`：单页面或单功能退化，有 workaround。
- `P3`：文档、体验、提示、非阻塞增强。

公开 issue 中出现 P0 或安全细节时，维护者应要求移除敏感内容，并转到 `SECURITY.md` 的私密路径。

## 敏感信息边界

公开 issue、PR、日志和截图不得包含：

- 生产 `.env`、数据库 URL、API key、session secret、GitHub token、cosign 私钥、smoke 密码。
- 附件内容、完整复盘正文、动机档案、完整情绪记录、真实学习笔记、私密任务标题。
- 上传绝对路径、备份归档、数据库 dump、未脱敏服务器日志。
- auth/session、upload/download、AI provider、updater/release、backup/restore 或 dependency 漏洞利用细节。

可要求用户提供：

- AreaForge version、release tag、install mode。
- redacted health/update-agent/readiness summary。
- 命令名和 PASS/FAIL，不要贴 secret 值。
- 截图或录屏，但遮挡真实学习内容。
- 最小复现步骤，优先使用本地或测试环境。

## 处理规则

1. 先判断是否安全漏洞；是则转私密路径。
2. 检查是否包含敏感内容；如包含，要求删除或重新提交 redacted 版本。
3. 分类为 bug、feature、ops support、release/supply-chain、AI 或 docs。
4. 关联源事实：`docs/README.md`、相关模块文档、`operator-onboarding.md`、`release-train.md`、`residual-risk-ledger.md`。
5. 使用 `areaforge-public-maintenance` 作为公开维护协调入口，再把高风险面交给对应 owner skill。
6. 要求最小可复现证据，避免让用户执行生产写入或高风险命令。
7. 若涉及生产 deploy、backup、restore、migration、updater apply、rollback 或 auto-apply policy，回复中必须说明公开 issue 不构成执行确认。
8. 若 issue 对应已知残余项，引用稳定 ID 和关闭条件。

## 只读检查

维护者可以让用户先运行这些只读检查，并贴 redacted 输出：

```bash
pnpm operator:onboarding:preflight
pnpm release:train:preflight
pnpm ops:readiness
pnpm ops:readiness:summary
pnpm ops:evidence:bundle
pnpm ops:alert:preview
```

这些命令不应执行 Docker、备份、恢复、migration、updater apply、rollback 或生产写入。生产只读 smoke 需用户自行配置 smoke 账号和密码文件：

```bash
pnpm smoke:prod-readonly
```

## 不承诺事项

- 公开 issue 不授权维护者登录用户服务器或执行生产操作。
- 公开 issue 不替代高风险确认包。
- 公开 issue 不关闭 residual risk；关闭必须满足 `docs/development/residual-risk-ledger.md` 的证据条件。
- 公开 issue 不保证响应 SLA；项目当前为 best-effort support。
