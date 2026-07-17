# GitHub Main Protection

```yaml
status: blocked
phase: awaiting-high-risk-confirmation
blockers:
  - explicit confirmation for GitHub repository settings write
  - current required status check name readback
risk: high
ownerSkill: areaforge-enterprise-governance
validation:
  - pnpm governance:preflight
  - pnpm residuals:validate
  - pnpm release:train:preflight
residualRiskIds:
  - AF-RISK-SC-004
releaseRequired: false
```

## 目标

为 GitHub `main` 建立不可绕过的 PR/CI 合并门禁，并用远端读回和受控 PR 证明设置生效。

## 范围

- 包含：required pull request、`ci / verify` required status check、禁止 force push/delete、管理员绕过策略、ruleset/branch protection 读回和受控 PR 验证。
- 不包含：创建 Release、推 tag、修改生产、updater apply、migration、备份恢复、读取或提交 secrets。

## 参考源事实

- `CODE_REVIEW.md`
- `docs/development/release-train.md`
- `docs/development/residual-risk-ledger.md`
- `.github/workflows/ci.yml`

## Owner Skill

- `.codex/skills-src/areaforge-enterprise-governance`
- `.codex/skills-src/areaforge-supply-chain`

## 验收标准

- `main` 只允许通过 PR 合并。
- `ci / verify` 是 required status check，失败或缺失时不能合并。
- force push 和 branch deletion 被禁止。
- 远端 API/UI 读回与仓库文档一致。
- 受控 PR 证明失败检查被阻止、成功检查可进入正常合并流程。

## 只读验收

- 需要的只读证据：GitHub ruleset/branch protection redacted readback、required check 名称、受控 PR URL 和 checks conclusion。
- 证据新鲜度：来自设置变更后的同一维护窗口。
- 关闭条件：远端设置和受控 PR 均验证通过，且 `AF-RISK-SC-004` 仍需单独人工复核后才能关闭。

## 高风险边界

- 影响：改变 `main` 合并权限和发布提交来源。
- 风险：错误 required check 名称可能阻塞所有合并；允许管理员绕过会使门禁形同虚设。
- 验证：先读取当前 check 名称，应用最小 ruleset，再读回并用受控 PR 验证。
- 回滚：若 required check 配置错误，仅回退本次 ruleset/branch protection 变更，不关闭 CI workflow。

## 允许/禁止路径

- 允许：确认后的 GitHub repository settings/ruleset 写入和只读验证。
- 禁止：Release/tag、生产服务器、数据库、上传目录、secrets 和 residual 自动关闭。

## 残余风险

- `AF-RISK-SC-004` 在远端设置读回和受控 PR 验证前保持 current-blocker。
