# 外部能力准入边界

## 定位

本文约束 AreaForge 开发和运营时可能接入的外部执行能力，包括 Codex subagent、Browser/Computer Use、MCP
server、自动化提醒/监控、部署插件、第三方 CLI、GitHub Apps、远程主机脚本和未来 CI/CD 扩展。

核心原则：外部能力只能提高协作效率和证据采集能力，不能绕过 AreaForge 的产品安全边界、生产高风险确认、
Web runtime 禁区、签名 Release 链路、备份恢复要求或文档源事实。

## 当前允许形态

以下已准入能力可在当前用户请求、既有读写范围内使用，无需逐次重新准入。只读用途不授权扩展写集、访问 secrets 或连接新的生产目标；本文件及具体高风险包已经规定的生产只读导出确认仍须保留。新增集成或实质扩大能力时才进入下方准入检查。

- **Subagent**：只用于并行只读审计、限定写集的代码/文档补丁、验证建议或对照检查。主代理仍需审阅结果、
  运行必要验证，并对最终结论负责。
  明确独立的只读子任务可主动委派，无需用户逐次点名；默认不改文件、不继续派生子代理。worker 的使用须满足当前委派权限和限定写集。
- **Browser / Computer Use**：可用于查看 GitHub、生产页面、截图或交互状态；不得把网页操作当成生产部署授权。
- **MCP / 插件 / CLI**：只允许在明确用途、权限、输入输出和验证方式后使用；不得默认获得生产密钥、服务器命令、
  Docker socket、备份目录、签名私钥或数据库 URL。
- **GitHub Actions**：只能通过仓库 workflow、最小权限和签名/校验门禁发布产物；不能把 CI 绿色等同于生产已更新。
- **Web 版本中心**：只能提交受控更新请求或读取状态；真正执行更新的是服务器侧 root update-agent/updater。

### 本地 UI 测试池准入

```text
purpose: 复用或保留最多三个 AreaForge production-build Web 测试实例，支持本地浏览器比较并阻止容器和镜像无限累积
owner: areaforge-enterprise-governance / areaforge-sre-ops
capability: fixture_only，本地 Docker 容器和测试池专属镜像写入
allowedInputs: 当前仓库构建上下文、Git/worktree fingerprint、apps/web/.env.local 中明确 allowlist 的本地配置、固定 loopback 端口
allowedOutputs: areaforge-dev-test-1/2/3 容器、带 ownership label 的候选镜像、共享测试 uploads volume、脱敏槽位/URL/commit/fingerprint 状态、唯一 latest 槽位/端口/URL 投影
forbiddenInputs: 生产 .env、生产数据库 URL、备份、上传文件内容、签名私钥、生产 token、远程 Docker context
forbiddenOutputs: secret 值、完整环境文件、用户学习内容、生产状态变更、Release 或 residual 关闭记录
writeScope: 仅本机 Docker 中带 com.areaforge.dev-test.pool=areaforge-dev-test label 的测试池容器/镜像和固定共享测试 volume
secretAccess: 只通过 0600 临时 env file 向本地容器传递 allowlist 值；不打印值，使用后删除临时文件
productionAccess: none；数据库必须是 loopback 上的 areaforge dev/test/local 名称，Web 端口只绑定 127.0.0.1
humanApprovalRequired: refresh/snapshot/指定 slot stop 已由维护者确认作为重复本地 fixture 操作；清理历史容器、数据库、volume、全局 image/build cache 仍需单独确认
validation: pnpm dev:test:selftest、pnpm dev:test:typecheck、pnpm dev:test:doctor、pnpm package-e:preflight、pnpm governance:preflight、pnpm docs:readiness、pnpm risk:preflight、git diff --check
rollbackOrDisable: 删除 dev:test:* package scripts 和 scripts/dev/dev-test-*，停止并精确删除带测试池 label 的容器；数据库与 volume 不自动删除
residualRiskId: none；本地 BuildKit cache 不自动回收，由 doctor 暴露状态并保留人工清理边界
```

测试池的 `refresh` 只替换最新或明确指定的槽位；`snapshot` 在第四个候选进入时按 FIFO 淘汰最老 Web 实例。`dev:test:latest`、list、doctor 和部署结果必须从 Docker ownership labels 中派生同一个 latest 实例，不能把 slot 1 固定解释为最新。候选镜像必须先构建成功，槽位交换必须持锁，健康或 runtime identity 校验失败时恢复旧实例且不改变 latest。同名异主、label 缺失、端口不一致或重复槽位一律 fail closed。测试池不得成为 Web API、CI deploy、服务器 updater 或生产 Docker 的入口。

DATA-EXPORT 隔离模式沿用同一三槽池，但不借用共享库、共享 uploads volume 或真实会话密钥。该模式只在已确认的本地导出包内使用：

- 显式设置 `AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT`、`AREAFORGE_DATA_EXPORT_ISOLATED_DB=1` 和 `AREAFORGE_DEV_TEST_DATABASE_URL`，只允许 `refresh --slot`，不自动选槽或 FIFO 替换。
- 输入必须是本机 canonical 临时目录下 `areaforge-v20-export-*` 的 0700 私有目录，带当前 UID/GID、仓库 hash、精确 `areaforge_v20_export_*` 库名 marker 和 0600 合成密钥文件；拒绝远端数据库、远端 Docker、目录/密钥软链接、过宽权限、错误库名或仓库绑定。
- 只占空槽或刷新同一 fixture hash 的槽位；普通模式不能覆盖 fixture 槽，fixture 也不能覆盖共享槽。校验在构建前和持锁交换时执行。
- Web 以 fixture UID/GID 只读挂载本批 `uploads` / `exports`；独立宿主机 worker 写入导出副本。运行环境来自合成 marker/密钥，不读取默认 `.env.local` 的 runtime allowlist；构建覆盖合成数据库/会话配置并关闭 AI/SMTP，打包排除 `.env*`，密钥与目录不写 Docker label 或报告。
- 输出仍是 canonical 槽位、端口、URL、source fingerprint 和不含路径的 fixture hash；不创建新 volume、不执行 migration、不授权源附件删除、共享数据/生产操作或历史资源清理。关闭开关/停止本批槽位可撤回本地访问，数据库与私有目录不自动删除。
- 验证除测试池原门禁外，增加 marker/权限/软链接/精确数据库/同槽所有权负测和真实 API/桌面/窄视口导出；迁移与合成资源本身仍使用 `high-risk-confirmation-packets.md` 的独立 DATA-EXPORT 授权。

### DATA-DELETE 隔离模式

DATA-DELETE 本地确认后的测试池模式沿用三槽池和显式 `refresh --slot`：

- 使用独立 `AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT`、`AREAFORGE_DATA_DELETE_ISOLATED_DB=1` 与精确数据库 URL，不能回落到 EXPORT 或共享配置。
- fixture 必须是 canonical、当前 UID 所有的私有 `areaforge-v20-delete-*` 临时根，匹配仓库/UID/GID、精确 `areaforge_v20_delete_*` 数据库和私有合成密钥。
- 只占空槽或替换同一 fixture；Web 挂载本批 uploads/exports 为只读，删除执行器只在独立宿主进程运行。Web 中导出和所有 worker 启动开关保持关闭。
- 只允许确认包列明的新建合成删除、备份与向全新恢复目标重放。不得清理旧库、历史容器/卷、真实 uploads，不能据此执行生产恢复。

### OPS 隔离模式与独立执行器

OPS 本地确认包仅授权 `fixture_only`：新建 loopback `areaforge_v20_ops_*` 库、当前 UID/仓库绑定的私有 `areaforge-v20-ops-*` 根，以及限定合成副作用和强杀恢复验证。

- 测试池使用 `AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT`、`AREAFORGE_OPS_ISOLATED_DB=1` 和精确数据库 URL；与 EXPORT/DELETE 模式互斥，只允许显式刷新专用槽。
- marker、canonical 路径、UID/GID、私有合成凭据和镜像身份必须匹配；会话密钥变化会改变 fixtureId，不能静默复用旧槽。
- Web 只读挂载本批空 uploads/exports 与单独的脱敏 context 目录，不挂载 agent journal、配置、签名材料或凭据文件。
- 独立执行器使用继承到子进程的文件锁、不可覆盖桥接/阶段日志和持久回执恢复。合成适配器只运行仓库固定测试程序并写合成计数，显式清空外部 Provider/SMTP 和其他域开关。
- 生产适配器默认关闭，保留原 updater 的签名/前态/备份/回滚门禁；本地批准不授权生产配置、root 安装、SSH、共享库、真实备份/上传、正式发布、自动策略或 residual 关闭。
- 回退是关闭入口和消费者并保留请求/journal/claim，不静默重放未知副作用，也不清理历史数据库或目录。验证执行 OPS 专项、测试池、updater、治理、安全和文档门禁。

### RANKING 隔离模式

RANKING 持久重建仅在独立确认的本地范围运行；采用 `AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT`、
`AREAFORGE_RANKING_REBUILD_ISOLATED_DB=1` 和精确数据库 URL，与其他 fixture 模式互斥。

- 只连接新建 `areaforge_v20_ranking_*` loopback 库；marker 绑定 canonical 私有根、UID/GID、仓库、端口、不可变 PostgreSQL 镜像及专属有标签数据卷，secret 文件必须为本人所有、0600、普通文件且禁止 symlink。
- 只显式刷新专用槽 3；若仍由上批 OPS fixture 占用，先核对身份并按已确认范围释放这个 Web 实例。不得放松跨 fixture 覆盖检查；槽 1/2、原库/卷和证据保留。
- Web 仅挂载本批空 uploads/exports 为只读，不叠加共享上传卷、不挂载 Docker socket 或执行器目录；关闭 EXPORT/DELETE/OPS、通知外呼与 AI/SMTP。
- 排名生产者也检查 `DATA_JOB_WORKER_ENABLED`，因此该专用 Web 配置可显式设置此许可；这不启动进程，消费者仍只由独立 CLI 运行。任意 Web/server 命令入口仍禁止。
- 库内冻结/取消/数据库删除验证只针对本批新建合成对象并走既有协议，不清除附件、不执行备份恢复、不改保留期。新建库与数据卷保留，不自动清理历史资源。
- 验证使用排名专用 marker/ledger/source fingerprint、独立 runtime/browser runner 和原测试池门禁；不授权共享/生产 migration、真实用户数据、Release 或 residual 关闭。

### SEARCH 隔离模式

- 使用独立 `AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT`、`AREAFORGE_SEARCH_INDEX_ISOLATED_DB=1` 和精确的 `areaforge_v20_search_*` loopback 库；与其他四种 fixture 双向互斥，不回落到共享库或 `.env.local`。
- 当前 UID/仓库绑定、canonical 私有目录、0600 no-follow 合成凭据、不可变 PostgreSQL 镜像和标签卷必须通过验证；新库仅在 SEARCH 独立本地批准内 deploy/repeat deploy canonical migration。
- 按已准入的三槽池显式使用槽 3；先核对并释放该槽原 Web，再以 SEARCH fixture 刷新，不放宽跨 fixture 覆盖检查。槽 1/2、旧库/卷和证据保留。Web 只读挂载空 uploads/exports，不挂载共享上传卷或执行器目录。
- Web 仅具有索引请求许可，不启动 worker；显式关闭 EXPORT/DELETE/OPS/RANKING、通知及 AI/SMTP。索引验证仅针对本批六类合成源和精确派生副本，冻结/删除沿既有协议，不执行附件清除或备份恢复。
- 专项包括隔离 guard、54 条完整 migration ledger/checksum、用户×Workspace/source 指纹、进程强杀和桌面/窄屏/API；新结构不授权重写旧域的固定 migration/hash、共享/生产、Release、历史清理或 residual 关闭。

### 提交级 Secret Scan 准入

```text
purpose: 检测当前工作树和相对基线新增 commit 中的硬编码 secret
owner: areaforge-enterprise-governance / areaforge-security-governance
capability: R0/R1 只读扫描
allowedInputs: Git metadata、当前变更和受控 commit range
allowedOutputs: rule ID、仓库相对路径、行号、PASS/FAIL
forbiddenInputs: Actions secrets、生产 env、备份、上传文件、数据库内容
forbiddenOutputs: 匹配值、原始报告、SARIF 上传、PR 评论、secret 内容
writeScope: 仅系统临时目录中的短生命周期 redacted report
secretAccess: 仅读取仓库内容中的候选值并在本地进程内匹配；不访问 Actions secret store、生产 env 或外部 secret provider
productionAccess: none
humanApprovalRequired: 真实 secret 轮换或 Git 历史重写时需要
validation: pnpm secrets:scan、pnpm governance:preflight
rollbackOrDisable: 删除 CI/Release 的 Install gitleaks 与 Commit secret scan 步骤及 package scripts
residualRiskId: AF-RISK-SC-002
```

AreaForge 使用官方 Gitleaks CLI 固定版本和 checksum 校验，不使用会读取 `GITHUB_TOKEN`、评论 PR、上传
SARIF 或要求额外 license secret 的 action wrapper。默认只扫描当前变更和相对基线新增 commit；全历史模式
`pnpm secrets:scan:history` 只用于维护者专项审计，不能因历史误报静默 allowlist 真实凭据。

## Subagent 边界模板

派发 subagent 前必须把任务压缩成可审计边界，避免它继承模糊授权：

```text
role: explorer | worker
scope:
readOnly: yes | no
allowedPaths:
writeSet:
forbiddenActions:
forbiddenData:
expectedOutput:
validationHints:
handoffRisk:
```

默认边界：

- `explorer` 只能读取文件和运行明确的本地只读检查；不得修改文件、连接生产、读取 secrets、执行 updater apply、备份、恢复、migration、rollback、Docker/Nginx/compose 切换或关闭 residual。
- `worker` 必须有互不重叠的 `writeSet`；不得回滚其他 agent 或用户的改动；发现写集冲突时停止并汇报。
- 涉及生产、secrets、发布、备份、恢复、自动更新策略或 residual closure 的结论只能作为建议，主代理必须重新用本地源事实和 validator 复核。
- 子代理输出必须区分“当前通过项”“当前阻塞项”“建议改动文件”“是否需要 Release”“验证命令”；不得把自己的只读审计写成完成声明。

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
- 按 `docs/development/runtime-write-boundary.md` 标明 R0-R4 能力等级；R3 update request 不等于 R4 updater apply。
- 按 `docs/development/completion-evidence-checklist.md` 说明证据等级、新鲜验证、未验证项和 residual risk IDs。
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
