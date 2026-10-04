# 0042 v1.7 受控运维中心

```yaml
status: backlog
phase: awaiting-signed-release
blockers:
  - 0044 platform operator authorization boundary must complete
  - 0041 durable job and data lifecycle semantics must complete
  - Signed release and independently confirmed production execution remain required
risk: high
ownerSkill: areaforge-sre-ops
validation:
  - pnpm ops:controlled:typecheck
  - pnpm ops:controlled:selftest
  - pnpm ops:controlled:runtime:selftest
  - pnpm ops:controlled:browser:selftest
  - pnpm github-release-updater:preflight
  - pnpm shellcheck:updater
  - pnpm governance:preflight
  - pnpm check
residualRiskIds:
  - AF-RISK-OPS-009
releaseRequired: true
```

## 目标

在现有 update request/updater 基础上增加只读运维视图、白名单 operation intent 和完整请求生命周期，由 root-only agent 执行并生成阶段证据。

## 当前进度

- 已落地只读 operation catalog：`CHECK_RELEASE`、`BACKUP_PREVIEW`、`APPLY_RELEASE`、`ROLLBACK_RELEASE`、`MAINTENANCE_HOLD`、`DIAGNOSTIC_HEALTH`。
- 已落地 strict typed intent 校验；参数不接受命令文本、脚本、自由路径或环境变量。
- 已增加仅供平台 Operator 读取的 `/api/system/operations`，它不会创建请求、调用 updater 或执行服务器动作。
- 已新增平台无关的纯请求状态机，并形成持久请求候选：高风险操作必须经过确认与审批；worker lease、hold/resume、取消、重试、过期、CAS 和错误 worker 均按允许的状态转换 fail closed。
- 本地候选已接通 `/api/system/operations/requests/**` 生命周期路由（confirm/approve/cancel/hold/resume/retry/lease/expiry）和 Operator UI；候选 migration 只在一次性隔离 PostgreSQL fixture 中验证，未 apply 到共享测试库或生产。
- 原 report-only 的 strict hash-chain journal/reconciliation 契约保留，不能冒充真实执行。独立 OPS 批次已接入版本化冻结绑定、root-owned 桥接登记/文件、跨进程锁、不可覆盖日志、停止屏障和回执恢复；38 组本地合成运行态、真实 API/桌面/390px/320px 浏览器与完整仓库门禁通过。Git/CI 以本批检查点和对应 run 为准；Release/生产仍缺。Web runtime 仍只提交受控请求，不执行服务器命令。

## OPS 独立本地批次（2026-09-14）

- 维护者明确批准上一会话的 OPS 确认包；基线为干净 `6d20120`，schema SHA-256 `ab77429b40205a644f13cdf03864f9b73aa45b03003cd4161763bccf33a5a7e0`、53 条 canonical migration 与四份源码/旧 updater 树对象匹配。未新增 schema 或 migration。
- 完整 expected-before、Release/manifest/不可变镜像、固定 rollback 来源、原请求 hash/nonce/初始修订和旧 V2 wire 均在确认前冻结。wire ID 显式映射为 `update_<requestedAtMs>_<nonce>`，三类旧 hash 与 strict shell schema 均验证一致；旧 tag-only 请求不能执行。
- `ops/controlled-operation-agent` 在当前 UID 的本批私有合成根实际运行进程、flock、fsync、不可覆盖桥接/journal 和子进程锁继承；副作用仅写合成计数，签名仅使用现场生成的测试密钥。没有提升宿主权限、安装 systemd、读取真实签名密钥或运行生产适配器。
- 38 组运行态覆盖六个动作、真实 Operator 变化、前态漂移、TTL、领取前拒绝、旧代次、各执行阶段 SIGKILL、子进程存活、重复回执恢复、真实 DB 写回超时、hash 篡改、前缀截断和整份 journal 缺失。数据库 root 桥接登记用于跨请求失踪检测；未领取的准备记录不会错误阻塞后续动作。
- 独立核验发现的挂起终态覆盖新取消、上一代终态误用、跨请求截断漏检、连续回执恢复失效，以及可靠零副作用拒绝误判为永久 reconciliation，均已修正并补回归。原始事实与 Web 投影分别绑定 hash；未知副作用仍必须人工对账，不能自动重放。
- 系统设置已接入冻结前态、重新验证、停止等待、执行环境/目标和阶段证据历史；网络响应丢失复用相同冻结意图/幂等键。浏览器发现并修正了 40px 主按钮与选择器/文本框可访问名称漂移，桌面/390px/320px 真实验收已通过。记录见 `output/playwright/controlled-operations/evidence.json`，所有截图均为合成数据。
- 仅使用新建 `areaforge_v20_ops_*` loopback 库；完整 53 条 migration 的名称、顺序、SQL checksum、完成状态及步骤数逐项匹配。旧 DELETE 槽 3 已按确认范围精确释放，再绑定 OPS fixture；槽 1/2、原库、卷、上传与历史证据目录保留。
- `OPS_EXECUTION_ENABLED`、`OPS_AGENT_ENABLED` 和 `OPS_AGENT_PRODUCTION_ENABLED` 默认关闭。旧 updater 的签名/checksum/digest、双前态/TTL、备份与固定回滚链路保留；生产源码接入只经过本地静态/协议验证，不代表生产运行通过。
- Release、共享/生产 migration/apply/backup/restore/rollback、自动策略、宿主全局配置和 residual 关闭均未执行。`AF-RISK-OPS-009` 只同步本地证据摘要，分类/日期/可执行状态/关闭条件不变；本任务和整体 v2.0 不因本地批次进展变为生产完成。
- 最终本地门禁：`pnpm check`（含 OPS typecheck/selftest）、`ops:controlled:runtime:selftest`、`ops:controlled:browser:selftest`、冻结安装、全量/生产依赖审计（均 0 漏洞）、OPS-005/OPS-008 回归、updater preflight/shellcheck、测试池 selftest/typecheck/doctor/dry-run、release admission/identity/workflow selftest、docs/tasks/residual/risk/governance/secrets 与只读副作用门禁通过。`execution` 元数据的静态 `exec` 误报已用调用/import 判定和危险反例修正，没有移除命令禁区。
- 检查点 `5cd1074` 已推送；首个 CI run `34849843885` 在新增 wire 自测的 `/dev/stdin` 读取退出 2，此前 1011 个 Web 测试及治理/审计均通过。一次性无网络 Linux Node 24 复现重开 stdin 为 `ENXIO`、直接 fd 0 正常；自测改用 jq 的 `-` 输入，保持原 strict schema 与验证内容不变。后续修正只涉及自测传输与说明，不改变已验收产品源码；CI 最终状态以修正检查点对应 run 为准。

## 永久禁止

- 任意 shell、命令文本、脚本正文、自由路径或任意环境变量。
- Web runtime 挂载 Docker socket、root 权限、生产 `.env`、备份目录或签名私钥。

## 验收

- expected-before、TTL、nonce、hash、幂等、审批、锁、journal、超时、崩溃恢复和回滚测试通过。
- 预览、确认、审批、排队、取消、安全重试、hold、恢复、结果和证据历史形成受控状态机。
- 每个生产动作逐项确认并保留备份、hash、smoke、rollback 和 redacted evidence。
