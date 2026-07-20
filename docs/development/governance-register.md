# 治理登记册

`governance-register.json` 是 AreaForge 核心治理控制项的中央只读索引。它只登记权威路径、唯一
accountable owner skill、已有执行门禁和复审触发器。

登记册不保存 status、lifecycle、severity、due、residual、关闭条件或生产激活状态。这些事实继续分别由
`operations-lifecycle.json`、`residual-risk-ledger.json`、发布记录和生产证据负责，避免形成第二源事实。

```bash
pnpm governance:register:selftest
pnpm governance:register:validate
```

validator 只读取仓库文件和 `package.json`，检查 control ID/domain、Git tracked 权威路径、owner skill、
已有 package script 门禁和 kebab-case 复审触发器。它不执行登记的命令、不联网、不读取生产、不修改
GitHub 设置，也不执行 Release、migration、updater 或 residual 关闭。

新增或调整治理域时，应同步：

- `docs/development/governance-register.json`
- 对应源事实和 owner skill
- `docs/development/validation-matrix.md`
- `docs/development/doc-sync-checklist.md`
- `pnpm governance:preflight`
