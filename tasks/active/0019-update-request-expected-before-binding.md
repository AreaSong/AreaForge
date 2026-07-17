# Update Request Expected-Before Binding

```yaml
status: in-progress
phase: awaiting-signed-release
blockers:
  - matching signed Release
  - separately confirmed production deployment
  - fresh redacted production evidence
risk: high
ownerSkill: areaforge-security-governance
validation:
  - pnpm update-center:request-guard:selftest
  - pnpm ops:ops-005:local:selftest
  - pnpm ops:ops-005:preflight:selftest
  - pnpm ops:ops-005:evidence:selftest
  - pnpm shellcheck:updater
  - pnpm github-release-updater:preflight
  - pnpm github-release-updater:preflight:selftest
  - pnpm governance:preflight
  - pnpm risk:preflight
  - pnpm check
residualRiskIds:
  - AF-RISK-OPS-005
releaseRequired: true
```

状态：本地 V2 实现和 fixture/selftest 已完成；仍需从当前验证提交创建签名 Release，并另行确认生产 timer/队列/Web/agent 部署和证据采集。未授权生产部署或请求处理。

## 目标

让 Web update request 绑定用户确认时的生产前态，并由 root agent 在执行前 compare-and-reject，
阻止 stale apply、rollback target 漂移、策略覆盖和请求重放。

## 范围

- 包含：schema V2、expected-before（含 rollback availability）、目标 Release/manifest/digest 绑定、expected-before hash 与 semantic/request 双 canonical hash、
  idempotency key、TTL、原子发布、processing reconciliation、共享 production-state lock、严格
  schema、legacy fail-closed、immutable decision history 和本地 selftest。
- 不包含：生产部署、timer/队列操作、updater apply、rollback、自动策略变化、数据库 migration、secret
  读取或 residual 关闭。

## 参考源事实

- `docs/development/update-request-expected-before-design.md`
- `docs/development/runtime-write-boundary.md`
- `docs/development/high-risk-confirmation-packets.md`
- `docs/deployment/github-release-updater.md`
- `docs/development/residual-risk-ledger.md`

## Owner Skill

- `.codex/skills-src/areaforge-security-governance`
- `.codex/skills-src/areaforge-release-operator`
- `.codex/skills-src/areaforge-sre-ops`

## 验收标准

- 所有 mutation request 都绑定 required expected-before fields 和 TTL。
- request hash 覆盖 immutable queued status；durability uncertain、408、429、5xx 重试复用原 idempotency key。
- apply 绑定 Release ID、manifest hash/version 和 image digest；rollback 绑定 source update-record hash
  与精确目标。
- root agent 从 live source 重建 observed-before，不匹配时零执行副作用。
- expected-before 在原子领取后和最终副作用边界前各比较一次，rollback/policy 在最终边界重新校验 TTL。
- update-agent、updater 和 rollback 写阶段共享 production-state lock。
- rollback 执行目标精确等于用户确认目标。
- V1 mutation request fail closed；V1 check 仅按文档兼容。
- Web 原子发布请求；root inode 替换失败保留原请求名；history 保留 hash、decision、reason 和 executionAttempted。

## 只读验收

- 需要的只读证据：本地 fixture/selftest、shellcheck、typecheck、lint、preflight 和 diff。
- 证据新鲜度：必须来自最终代码变更后的同一 checkout。
- 关闭条件：本地实现验证通过后仍只进入 release-ready；生产 residual 需另行 Release/部署证据。

## 本地实施结果

- Web 绑定用户实际确认的 agent-authored `snapshotHash`，状态漂移返回 `STATUS_SNAPSHOT_CHANGED`；
  `needs_reconciliation` 在 UI 和 API admission 两层都拒绝 mutation，不能通过直接调用 API 继续塞入写请求。
- UI 对同一动作、参数和 confirmed snapshot 的网络结果不确定重试通过浏览器 session 级共享状态复用同一
  idempotency key，覆盖组件重挂载和两个版本中心入口，并以有界 intent→key 集合保留多个独立不确定请求；
  只有带完整 queued request 的 durability synced 成功响应或带有效 error contract 的确定性 4xx
  才立即清除；durability uncertain 会把 request ID 绑定到 attempt，状态轮询看到同一终态后收敛，响应完全丢失时
  attempt 最迟在对应请求 TTL + clock skew 后失效，避免 check 永久复用历史终态；408、429、5xx、状态 0、空响应或不完整响应在窗口内继续保留；动作或 snapshot 变化时生成新 key，
  browser storage 读取或写入失败时退回组件内存；组件本地未决 key 优先，acknowledgement 只删除实际提交的
  同一 key，不能清除另一个入口的新 attempt；两个入口使用同一 intent canonicalization。
- Web、agent 和 updater 的 V2 schema 对齐当前 Release workflow，只接受稳定 `vX.Y.Z` / `X.Y.Z` 和
  UUID v1-v5 variant，避免 API 接受下游必然拒绝的请求。
- updater 在生成 verified target 前强制 GitHub Release tag、manifest version、`webImage` tag 和
  `webImageDigest` tagged reference 一致，防止版本字段与实际镜像身份分裂。
- current image 与 rollback record 进一步强制 image tag 分别匹配 `APP_VERSION` 和 rollback target version；
  Release ID 在 updater、agent identity 和 request schema 三层都只接受正的 JavaScript-safe integer，保持 Node/JQ canonical 边界一致。
- 当状态快照缺失或无法验证时，Web 仅允许发布 V1 只读 `check` 以恢复 agent 状态；所有 mutation
  仍拒绝 legacy/unbound 请求。
- V2 请求包含严格 schema、TTL、target identity、带 rollback availability 的 expected-before、三个
  domain-separated canonical hash 和 idempotency key；request hash 覆盖 queued status。Web 使用 file fsync、
  no-clobber atomic hard-link publish、request/新建父目录链 fsync 发布；同名 final 不覆盖，目录 fsync 或
  临时链接清理未确认时返回 durability uncertain 并提示不要立即重试。
- root agent 使用 root-only `processing/` claim，并把 Web 队列 inode 复制为新的 root-owned inode 后以同目录
  原子 rename 替换；替换失败时保留原请求名供下一轮 reconciliation，之后才读取或收紧权限。claim/decision
  history/status 具备持久化屏障、不可变 decision history、legacy mutation fail-closed 和 stale/missing-claim
  reconciliation；已持久化 decision 的 claim 崩溃恢复会复用既有 decision；reconciliation 不自动重放 mutation。
- terminal decision 已持久化但 claim 清理部分失败时，agent 可按 request ID + requestHash 回收残留请求，不重复写 history、不重放 mutation，也不制造虚假永久 blocker；尚未移动 request 的空 pre-claim 目录会安全清理；共享 production-state lock 首次创建即收紧为 `0600`。
- stale/missing claim 或 claim-only/request-missing 状态形成 `NEEDS_RECONCILIATION` 后保留 processing blocker，后续 agent 轮次不再领取 mutation；duplicate/replay/conflict 派生 history 不会替代 idempotency key 的首个规范终态；apply/rollback 最终记录持久化失败映射为专用 reconciliation reason，不归类为普通失败。
- active processing reconciliation 同时投影为 redacted status 顶层 blocker，包括 request 缺失、action 无法解析的合成 decision；Web/API 不会在 root 已阻塞时继续接收 mutation。
- 当前轮新产生的 reconciliation 会立即写顶层 blocker；active processing 期间 root 仍只允许消费严格校验的
  read-only `check`，mutation 保持排队且未决 claim 不会被重放或清理。
- agent 和 updater guard 对 `expectedBefore.currentImage` 强制有界可打印 ASCII，与 Node canonical JSON 约束保持一致。
- 严格 schema/hash 通过后先查询 immutable terminal decision；同 key、同 semantic hash 的过期传输重试返回
  既有终态且不执行 updater，只有没有历史终态的新请求才进入 TTL admission。
- updater、rollback 和 policy mutation 使用共享 production-state lock；apply 由 agent 先持锁并让 updater
  通过显式握手复用同一 fd inode，配置锁路径漂移时 fail closed；正常锁竞争记录零副作用拒绝；run 模式持锁后
  从进程启动环境 baseline 重新 source 当前配置，删除策略或签名字段时回到安全默认值而不沿用旧值。apply 任一 guard 过期会输出结构化 `REQUEST_EXPIRED` rejection；rollback 在 source/env 候选
  准备完成后、原子替换 production env 前完成第二次 compare-and-reject 和 TTL 校验；policy 也在最终边界重验。
  rollback/policy 在领取后和最终边界都重新解析配置锁路径并验证同一 fd inode；同路径 lock file 被替换时以
  `PRODUCTION_STATE_LOCK_CHANGED` 零副作用拒绝。
- mutation 的不可变 decision、claim 清理和 redacted `status.json` 终态发布在释放 shared lock 前完成，避免
  direct updater 在终态投影过程中插入另一轮生产状态变化；fixture 会在 status 发布发生于锁外时直接失败。
- agent live compare 将缺失的 `AREAFORGE_AUTO_APPLY` 与状态页/updater 一致解释为安全默认 `none`，允许受控策略路径补回配置而不会产生虚假的 expected-before drift。
- updater 缺失、重复、与退出码矛盾的双比较 marker 时进入 `NEEDS_RECONCILIATION`，只读 check 记录
  `executionAttempted=false`，root-only status 路径被脱敏；observed-before marker 与 expected-before 使用同一
  domain-separated hash。fixture 已覆盖 TTL 精确正反边界和最终边界过期、前态字段漂移、rollback 二次比较、
  幂等冲突/重复、V1 check、file/directory fsync、临时队列文件、symlink/hardlink new-inode、inode 替换失败、
  恶意 request/claim ID、history hash/同步故障、decision 发布后强杀与重启 reconciliation，以及系统
  `flock` 或内核测试适配器下 apply/rollback/policy 真实竞争、agent→updater fd 继承和锁路径不匹配拒绝，以及
  apply 第一/第二 guard 过期的结构化零副作用终态。reconciliation marker 与 terminal marker 同时出现时，
  reconciliation 必须优先并保留 claim，不能被错误收敛为成功。
- apply 副作用开始后只有完整双 guard、execution marker 和与退出码一致的 `applied` / 非 migration `rolled_back` 终态 marker 才能清理 claim；子进程异常、marker 缺失和 migration 已启动后的失败均保留为 reconciliation。root 在两次策略比较点都强制 `signatureRequired=true` 与 tagged GHCR digest。
- root agent 只接受 `none/patch` 策略；rollback 只暴露带不可变 digest 的目标，并按 record `updatedAt`
  而非路径字典序选择快照候选。rollback 目标切换失败会恢复原 env/web；updater health smoke 失败会回到自动
  回滚，启用 compose 更新时同时恢复备份 compose；恢复不确定时记录 `ROLLBACK_RECOVERY_UNCERTAIN`；env、
  update record 和 decision history 写入带显式 file/directory fsync 失败检查。最终 env rename 非零时不假定
  零副作用，而是记录 `ROLLBACK_ENV_SWITCH_UNCERTAIN`、`executionAttempted=null` 并保留 processing claim。
- 本地证据入口：`pnpm ops:ops-005:local:selftest`、`pnpm ops:ops-005:preflight:selftest`、`pnpm ops:ops-005:evidence:selftest`、`pnpm shellcheck:updater`、`pnpm github-release-updater:preflight`；生产证据 validator 必须记录完整 aggregate local selftest，并同时输入 record 与签名 Release record 做身份交叉绑定。脏工作树只能形成本地 worktree 证据，不能把 `HEAD` 冒充已验证 Release commit。
- signed Release preflight 的 commit override 必须与真实 `HEAD` 一致；preflight 和独立 production evidence validator 都必须提供实际 Release assets 目录并运行 strict supply-chain validator；生产
  rejection、decision history 与 operational evidence 使用记录同目录的 redacted JSON path+hash 绑定，不再接受任意格式正确的
  SHA256 自声明。
- 该结果只证明当前 checkout 的本地实现；`AF-RISK-OPS-005` 在签名 Release、独立生产部署和 fresh redacted evidence 前保持 open。

## 高风险边界

- 影响：改变 root agent 是否执行 updater、rollback 和策略写入的判定。
- 风险：Web/agent schema 不匹配、旧 agent 忽略 V2、队列请求丢失或错误拒绝。
- 验证：本地竞态、TTL、hash、legacy、零副作用 fixture，Release workflow 强制执行 OPS-005 selftest，并运行 updater preflight；生产行为仍需匹配 Release 和 fresh redacted evidence。
- 回滚：生产部署另走确认包；暂停 timer、隔离 V2 请求、同时回滚 Web/agent，不重放请求。

## 允许/禁止路径

- 允许：设计列出的 Web、update-agent、updater shared-lock/target-identity 接口、selftest、preflight 和
  文档路径。
- 禁止：生产 SSH、生产 config/env、数据库/上传目录、Release tag、residual 关闭。

## 残余风险

- `AF-RISK-OPS-005` 在生产部署并取得 fresh redacted execution/rejection evidence 前保持 open。
