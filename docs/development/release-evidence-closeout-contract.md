# Release Evidence Closeout Contract

## 目标

本契约解决签名 Release、生产证据、UX 证据和 residual 关闭之间的提交依赖环。签名 Release 必须绑定不可变的源提交，但生产证据和人工关闭只能在 Release 之后产生；若要求所有证据继续与最新 HEAD 完全相等，每次提交证据都会让前一份证据立即失效。

本契约允许一个签名 Release 源提交后跟随受控的 evidence-only closeout（仅证据收口）提交，同时继续禁止任何产品代码、migration、workflow、updater、依赖或运行配置漂移。它不降低 Release、生产确认、人工复核或 residual 关闭条件。

## 身份

- `R`：签名 Release 源提交。tag、manifest、SBOM、provenance、镜像 digest、checksum 和 signature 全部绑定 `R`。
- `U`：实际运行并完成 desktop/mobile 体验复核的提交。`U` 必须等于 `R` 或是 `R` 的合法 evidence-only 后代。
- `C`：当前干净 closeout HEAD。`C` 必须等于 `R`，或是 `R` 的合法 evidence-only 后代；UX record 可绑定 `U`，再作为 evidence-only 文件进入 `C`。

`R`、`U`、`C` 不能互相替代：Release 资产继续证明 `R`，runtime probe 证明 `U`，closeout binding 只证明 `R..C` 没有越过允许路径，不证明生产健康、证据内容真实或 residual 已关闭。

## 机器不变量

`scripts/quality/release-closeout-binding.ts` 必须 fail closed 校验：

1. `R` 和 `C` 都是当前仓库可解析的 40 位 commit。
2. `C == R`，或 `R` 是 `C` 的祖先；`R..C` 必须是无 merge 的线性 evidence-only 提交链，并逐提交检查，不能用“先改源码再 revert”的最终净差异绕过。
3. evidence-only 绑定时工作区必须干净。
4. `R..C` 每个提交的所有变更路径都在本契约精确白名单内；删除和 copy 一律失败，rename 只允许当前治理任务在 `active/backlog/done` 间移动。
5. 每个提交中的 closeout 文件必须是 Git mode `100644` 的普通文件；symlink、symlink parent、executable、超大文件、无效截图 header 或敏感内容失败。
6. CI-only SC-002 记录仍必须 exact-match 当前 HEAD；只有同时提供 Release assets 目录并通过 strict manifest/checksum/cosign 校验的 Release record 可以使用 evidence-only closeout。
7. OPS-005 的 Release、生产记录和脚本 source-at-commit 校验继续绑定 `R`，不得改绑 `C`。
8. UX runtime identity 与 review record 绑定 `U`；若当前 HEAD 是 evidence-only 后代，当前 UX source fingerprint 仍必须与 `U` 一致。

## 允许路径

允许路径只用于保存 redacted 证据和同步关闭状态：

- versioned Release / supply-chain / operational evidence / closeout audit 记录。
- OPS-001 的精确 smoke/status/bundle/closure 文件名，OPS-005/OPS-006 的版本化 production evidence/结构化子证据，以及 residual 人工复核记录。
- product-experience review、runtime identity 和 PNG/JPEG/WebP 截图证据。
- `docs/development/residual-risk-ledger.{md,json}`、`operational-readiness.md`、`long-term-operability-control-plane.md`。
- 仅当前长期治理任务 `0014/0019/0020/0023/0024` 在 `tasks/{active,backlog,done}` 中的状态文件、任务 residual 索引和 README 状态同步；任意新 task 或设计文档不自动进入白名单。
- 根 README、docs README、workflow README 的当前状态同步。
- `output/ops005`、`output/ops006`、`output/supply-chain` 下受限前缀的结构化 redacted 文件，以及 `output/playwright` 下受限命名的 runtime identity/截图。

以下路径始终禁止进入 evidence-only closeout：

- `apps/**` 产品源码、`packages/**`、`prisma/**`、`ops/**`、`scripts/**`、`infra/**`。
- `.github/workflows/**`、依赖/lockfile、package version、Docker/compose/Nginx 运行配置。
- `.env`、secret、token、私钥、backup、dump、upload body、cookie/auth state、trace、video、profile 或原始生产日志。

路径白名单只证明 source tree 没有运行行为漂移。closeout binding 自身还会扫描常见 database URL、token、private key、Authorization/cookie 和 raw body marker；专项 validator、`pnpm secrets:scan`、人工 review 和 Git checkpoint 仍必须全部通过，任何一层不能替代其他层。

## 顺序

1. 完成所有代码、migration、workflow、validator、版本和源事实修改，运行发布前全量门禁，形成干净 `R`。
2. 经明确确认创建签名 tag/Release，验证 assets、signature、digest 和 supply-chain record 均绑定 `R`。
3. 经独立 R4 确认完成 backup、OPS-005/006 rollout、health/smoke/doctor/rollback evidence；生产记录仍绑定 `R`。
4. 在 `R` 或合法 evidence-only 后代运行本地 desktop/mobile 复核，runtime probe 与 UX record 绑定 `U`。
5. 仅提交 redacted evidence、人工 review、residual/task/README 状态，形成干净 `C`。
6. 运行 closeout binding、SC-002、OPS-005、UX、Release evidence、residual 和长期 live gate；任一 source path 漂移都回到新 Release 流程。

## 验证

```bash
pnpm release:closeout:binding:selftest
pnpm sc:sc-002:preflight:selftest
pnpm ops:ops-005:preflight:selftest
pnpm experience:review:selftest
pnpm residuals:validate
pnpm enterprise:operability:preflight
pnpm governance:preflight
pnpm secrets:scan
pnpm ops:long-term:gate
git diff --check
```

## 不授权

本契约和 validator 都是 R0 只读证明，不创建 tag/Release、不访问 GitHub、不执行 SSH/server command、不备份、不恢复、不运行 migration、不部署、不执行 updater apply/rollback、不读取密钥、不写生产，也不自动关闭 residual。所有 Release、生产操作和台账关闭仍使用独立确认包。
