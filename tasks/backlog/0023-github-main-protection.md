# GitHub Main Protection

```yaml
status: blocked
phase: remote-verified-awaiting-residual-review
blockers:
  - maintainer close-or-keep-open decision for AF-RISK-SC-004
risk: high
ownerSkill: areaforge-enterprise-governance
validation:
  - pnpm governance:preflight
  - pnpm residuals:validate
  - pnpm release:train:preflight
  - pnpm sc:sc-004:validate output/supply-chain/github-main-protection-readback-20260718.json output/supply-chain/github-main-protection-controlled-pr-20260718.json
  - pnpm sc:sc-004:preflight
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

## 远端实施结果

- GitHub ruleset `19138434`（`Protect main`）已 Active，作用于默认分支 `main`，bypass list 为空。
- required PR 已启用，required approvals 为 1；branch deletion 与 non-fast-forward/force push 已禁止。
- GitHub UI 规范化检查名为 `ci / verify`；底层 API context 为 `verify`，绑定 GitHub Actions integration `15368`。未保留字面但未绑定的 `ci / verify` context，避免永久 expected。
- 受控 PR `#13` 先以失败 run `29637518206` 证明检查失败，再以成功 run `29637622080` 证明 `All checks have passed`；PR 已关闭且 `merged=false`，未改变 `main`。
- readback 证据：`output/supply-chain/github-main-protection-readback-20260718.json`，`sha256:2338e2393f53411129edb30d0e66d80dcad2e563fd4c7776f677b19fcf1cd711`。
- controlled PR 证据：`output/supply-chain/github-main-protection-controlled-pr-20260718.json`，`sha256:dcdaa2b644a9506a4566920b71eea02ae57683a34a0f1da5c142613855248ed7`。
- 本任务的远端实施和证据验证已完成；按确认边界，`AF-RISK-SC-004` 不自动关闭，继续等待维护者人工 close/keep-open 决策。

## 高风险边界

- 影响：改变 `main` 合并权限和发布提交来源。
- 风险：错误 required check 名称可能阻塞所有合并；允许管理员绕过会使门禁形同虚设。
- 验证：先读取当前 check 名称，应用最小 ruleset，再读回并用受控 PR 验证。
- 回滚：若 required check 配置错误，仅回退本次 ruleset/branch protection 变更，不关闭 CI workflow。

## 允许/禁止路径

- 允许：确认后的 GitHub repository settings/ruleset 写入和只读验证。
- 禁止：Release/tag、生产服务器、数据库、上传目录、secrets 和 residual 自动关闭。

## 残余风险

- `AF-RISK-SC-004` 在维护者人工复核并明确 close/keep-open 前保持 current-blocker；远端实施通过不自动修改 residual 类型。
