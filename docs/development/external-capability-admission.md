# 外部能力准入边界

## 定位

本文约束 AreaForge 开发和运营时可能接入的外部执行能力，包括 Codex subagent、Browser/Computer Use、MCP
server、自动化提醒/监控、部署插件、第三方 CLI、GitHub Apps、远程主机脚本和未来 CI/CD 扩展。

核心原则：外部能力只能提高协作效率和证据采集能力，不能绕过 AreaForge 的产品安全边界、生产高风险确认、
Web runtime 禁区、签名 Release 链路、备份恢复要求或文档源事实。

## 当前允许形态

- **Subagent**：只用于并行只读审计、限定写集的代码/文档补丁、验证建议或对照检查。主代理仍需审阅结果、
  运行必要验证，并对最终结论负责。
- **Browser / Computer Use**：可用于查看 GitHub、生产页面、截图或交互状态；不得把网页操作当成生产部署授权。
- **MCP / 插件 / CLI**：只允许在明确用途、权限、输入输出和验证方式后使用；不得默认获得生产密钥、服务器命令、
  Docker socket、备份目录、签名私钥或数据库 URL。
- **GitHub Actions**：只能通过仓库 workflow、最小权限和签名/校验门禁发布产物；不能把 CI 绿色等同于生产已更新。
- **Web 版本中心**：只能提交受控更新请求或读取状态；真正执行更新的是服务器侧 root update-agent/updater。

## 准入检查

引入或扩大外部能力前，必须回答：

```text
purpose:
owner:
capability:
allowedInputs:
allowedOutputs:
forbiddenInputs:
forbiddenOutputs:
writeScope:
secretAccess:
productionAccess:
humanApprovalRequired:
validation:
rollbackOrDisable:
residualRiskId:
```

最小要求：

- 说明为什么现有脚本、skill 或手动流程不足。
- 明确是否能写文件、写数据库、触发网络请求、读取密钥、连接生产、调用 AI、创建 Release 或执行服务器命令。
- 明确禁止读取或输出生产 `.env`、数据库 URL、API key、cosign 私钥、上传文件内容、完整 prompt/raw response、
  动机档案、完整情绪记录或完整复盘正文。
- 涉及生产、备份、恢复、migration、updater apply、rollback、签名策略、自动应用策略或 Web 运维能力扩大时，
  必须先走高风险确认包。
- 能力停用、撤销 token、回滚配置或删除集成的路径必须清楚。

## 禁止绕过

外部能力不得：

- 让 Web runtime 执行 Docker、备份、恢复、migration、shell、SSH、rsync、scp 或服务器命令。
- 通过浏览器按钮、MCP tool、subagent、自动化或插件静默应用生产更新。
- 跳过 GitHub Release `SHA256SUMS`、签名校验、不可变镜像 digest、备份点、migration runner、smoke 和回滚证据。
- 将生产密钥、签名私钥、GitHub token、数据库 URL、生产 `.env` 或备份文件提交到 Git。
- 将 AI、自动化或外部 provider 变成记录覆盖、任务删除、附件删除、阶段自动应用或批量重排的隐式写入口。
- 把只读审计、preview、readiness、green CI 或 dry-run 说成生产 apply 已完成。

## 状态词

外部能力使用稳定状态词，避免把“能看到按钮/脚本存在”误解成能力已开放：

```text
closed:
  能力关闭，仅作为未来路线或残余风险。

preview_only:
  只读查看、dry-run、readiness、lint 或证据聚合，不写生产状态。

fixture_only:
  只在临时环境或 fixture 中写入，不触碰生产和真实用户数据。

confirmed_apply:
  已有用户明确确认、限定作用域、验证和回滚路径，可执行一次受控写入。

production_scoped:
  已通过文档化策略允许重复使用，仍受签名、备份、权限、审计、smoke 和回滚约束。

suspended:
  因失败、凭据风险、边界漂移、审计缺口或回滚失败暂停使用。
```

## 验证

外部能力或治理边界变化后至少运行：

```bash
pnpm governance:preflight
pnpm docs:readiness
pnpm risk:preflight
git diff --check
```

若改到 `.codex/skills-src/**` 或 `.agents/skills/**`，同时运行：

```bash
pnpm skills:validate
```

若改到 release、updater、CI、签名、GHCR、production smoke 或自动更新策略，同时运行对应的 release / ops /
supply-chain 门禁。
