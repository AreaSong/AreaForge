# Update Request Expected-Before 设计

## 目标

为 Web 版本中心提交到 root update-agent 的 `check`、`apply`、`rollback` 和
`set_auto_apply` 请求增加执行时前态绑定，阻止陈旧请求在生产状态变化后继续执行。

本设计只定义本地代码实施契约和验证方式，不授权生产部署、队列处理、updater apply、
rollback、策略变化或服务器命令。

本地实施状态：schema V2、agent-authored snapshot binding、target identity、rollback availability、三个 canonical hash、TTL、
idempotency、原子发布、processing reconciliation、共享 production-state lock、双 compare-and-reject、
legacy mutation fail-closed 和不可变 decision history 已在当前 checkout 实现。apply 在任一 guard 过期时输出
结构化 `REQUEST_EXPIRED` rejection；rollback 在候选 env 准备完成后、原子替换前执行第二次状态与 TTL guard；
agent 到 updater 的继承锁通过显式握手同时绑定配置路径和同一 fd inode。使用
`pnpm ops:ops-005:local:selftest`、`pnpm shellcheck:updater` 和
`pnpm github-release-updater:preflight` 验证；该状态不证明签名 Release 或生产部署完成。

## 修复前风险

修复前，Web 在请求入队前读取 `status.json` 并做一次提示性校验，但请求只保存 action、tag、
auto-apply 目标、actor hash 和时间。root agent 执行时重新读取当前环境和最新 update record，
没有证明执行前状态仍等于用户确认时看到的状态。

可触发场景：

- 用户确认回退到 `0.1.5` 后，队列前方的 apply 先生成了新的回滚记录；旧 rollback 会重新探测
  目标并回到 `0.1.7`，不是用户确认的目标。
- rollback 先把事故版本回退，队列中的陈旧 apply 随后仍可能重新上线新版本。
- 同版本镜像 digest、自动应用策略或回滚目标在入队后变化，旧请求仍可能覆盖较新的运维决策。
- 请求没有 TTL，可以在排队、timer 停止或 agent 重启后长期滞留再执行。
- Web 直接写最终 `.json` 文件，agent 可能读到未完成文件并把请求判为 invalid。

## 设计原则

1. Web 请求是 R3 授权草稿，不是 R4 执行授权的永久票据。
2. 所有写动作必须绑定用户确认时的生产前态，并由 root agent 从 live env、config 和 update
   record 重建前态后 compare-and-reject。
3. 任何不匹配、过期、篡改、重复或旧版未绑定写请求都 fail closed，且不得调用 updater、
   Docker 或 config write。
4. 请求 hash 用于一致性和审计，不宣称能抵御已经取得 request 目录写权限的进程；Web runtime
   不新增 root HMAC/signing secret。
5. `AREAFORGE_AUTO_APPLY=none` 保持默认，本包不启用自动应用。

## Request Schema V2

```json
{
  "schemaVersion": 2,
  "id": "update_<epoch>_<uuid>",
  "action": "apply",
  "status": "queued",
  "requestedAt": "2026-07-13T00:00:00.000Z",
  "expiresAt": "2026-07-13T00:05:00.000Z",
  "actorEmailHash": "<sha256>",
  "idempotencyKey": "<uuid>",
  "params": {
    "tag": "v0.1.8",
    "autoApply": null
  },
  "target": {
    "releaseId": 123456,
    "manifestSha256": "sha256:<digest>",
    "manifestVersion": "0.1.8",
    "webImageDigest": "ghcr.io/areasong/areaforge-web:v0.1.8@sha256:<digest>"
  },
  "expectedBefore": {
    "currentVersion": "0.1.7",
    "currentImage": "ghcr.io/areasong/areaforge-web:v0.1.7@sha256:<digest>",
    "autoApply": "none",
    "signatureRequired": true,
    "rollbackAvailable": true,
    "rollbackTargetVersion": "0.1.5",
    "rollbackTargetImage": "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:<digest>",
    "rollbackSourceRecordSha256": "sha256:<digest>"
  },
  "expectedBeforeHash": "<sha256>",
  "semanticHash": "<sha256>",
  "requestHash": "<sha256>"
}
```

约束：

- schema 必须严格拒绝未知顶层和嵌套字段。
- 文件名必须精确等于 `${id}.json`。
- `status` 在入队文件中只能是 `queued`，并作为 immutable envelope 的一部分进入 request hash；运行状态只写
  decision history，不回写或改写请求文件。
- canonical JSON 只允许受约束的 ASCII 字符串、布尔、null 和正的 JavaScript-safe integer；Node 与 `jq -cS` 必须由
  cross-runtime selftest 证明输出一致。
- `expectedBefore.currentImage` 即使用于拒绝路径也只允许最多 500 字符的可打印 ASCII；Web 生成的 V2 snapshot
  进一步只接受 tagged GHCR `@sha256` digest 或 `null`，避免 Node/JQ canonical 边界漂移。
- `semanticHash` 只覆盖会改变副作用语义的 action、normalized target、params 和 expectedBefore；
  排除 id、actor、requestedAt、expiresAt 和执行状态，用于幂等冲突判断；投影必须包含固定 domain
  `areaforge.update-request.semantic.v2`，防止跨对象 hash 复用。
- `requestHash` 覆盖完整 immutable envelope：schemaVersion、id、idempotencyKey、action、status、requestedAt、
  expiresAt、actorEmailHash、params、target、expectedBefore、expectedBeforeHash 和 semanticHash。
- apply 的 target 必须来自 root agent 已完成签名/manifest 检查后写入的 status snapshot；只携带 tag
  不足以证明用户确认的是同一 Release 内容。
- updater admission 必须进一步证明 GitHub Release tag、manifest version、`webImage` tag 和
  `webImageDigest` 的 tagged image reference 四者一致，禁止 `APP_VERSION` 与实际镜像 tag 分裂。
- current image 和 rollback record 也必须是 tag 与对应 `APP_VERSION` / target version 一致的 tagged
  GHCR digest；不一致时 status/guard/rollback discovery 全部 fail closed，不能制造版本标签与实际镜像分裂。
- 当前 Release workflow 的版本身份只接受稳定 `vX.Y.Z` / `X.Y.Z`，Web、agent 与 updater 的 V2
  schema 保持同一约束；idempotency key 只接受下游一致支持的 UUID v1-v5 variant。
- UI 对同一动作、参数和 confirmed snapshot 的网络结果不确定重试通过浏览器 session 级共享状态复用同一
  idempotency key，覆盖组件重挂载和两个版本中心入口；session 以有界 intent→key 集合保留多个独立的
  不确定请求，切换动作不能覆盖旧 key。只有 directory durability 已确认的成功响应或
  带有效错误契约的确定性 4xx 才结束该传输尝试；durability uncertain、408、429、5xx、空响应、状态 0
  或缺少完整 queued request/error 结构的响应必须在传输窗口内保留原 key。durability uncertain 返回的 request ID
  必须绑定到 attempt，状态轮询观察到该 request 的终态后清除；响应完全丢失且无法取得 request ID 时，attempt
  最迟在动作 TTL + clock skew 后失效，避免只读 check 永久复用历史 decision。
  confirmed snapshot 或动作语义变化时必须生成新 key；browser storage 读取或写入失败后，该组件对同一
  不确定请求退回内存 key，不能因存储异常重复生成。组件内仍在等待明确结果的 key 优先于共享 storage；
  acknowledgement 只删除自己实际提交的同一 key，不能清除另一个入口已经发布的新 attempt。
- `status.blocker` 非空或最近操作处于 `needs_reconciliation` 时只允许只读 `check`；`apply`、`rollback`
  和 `set_auto_apply` 必须在 Web/API 层 fail closed，不能只依赖 UI 禁用。当前新策略只允许 `none` 或
  `patch`，`minor/all` 不进入当前开闸范围。

## 动作前态

| 动作 | 必须比较的前态 | TTL |
|---|---|---:|
| `check` | 不绑定生产写前态，只校验 schema/hash/TTL/重复 ID | 15 分钟 |
| `apply` | currentVersion、currentImage digest、autoApply、signatureRequired；target release ID、manifest hash、manifest version 和 web image digest | 5 分钟，硬上限 10 分钟 |
| `rollback` | currentVersion、currentImage、rollback available、target version/image、source update-record hash | 5 分钟，硬上限 10 分钟 |
| `set_auto_apply` | current autoApply；目标不是 `none` 时再比较 currentImage 和 signatureRequired | 5 分钟，硬上限 10 分钟 |

允许最多 30 秒时钟偏差。未来 requestedAt、expiresAt 早于 requestedAt、超过动作硬上限或执行时已
过期都必须拒绝；排队和 agent 重启不得延长 TTL。

## Root Agent 决策顺序

agent 在把请求标记为 running 前必须：

1. 原子 rename 到 root-only `processing/` 领取请求，并在该目录内复制到新的 root-owned inode 后再读取或
   收紧权限，避免 Web 可写队列中的 symlink/hardlink 影响其他路径；对 rename 两侧目录、claim 文件和最终
   decision history 执行持久化屏障，并校验普通文件、文件名、schema、canonical hash、TTL、重复 ID
   和 idempotency key。
2. 获取与 updater/manual mutation 共用的 production-state lock；apply 由 agent 先领取锁并通过显式
   inherited-lock 握手让 updater 复用同一 fd inode；updater 重读配置后若 lock path 不再指向该 inode 必须
   fail closed，rollback/policy 也必须在领取后和最终副作用边界重新解析配置中的 lock path 并核对同一 fd
   inode；同路径 lock file 被替换同样拒绝。compare 与副作用之间不得释放锁。正常锁竞争必须记录
   `PRODUCTION_STATE_LOCK_BUSY` 且 `executionAttempted=false`，不能升级成永久 reconciliation。
3. 从生产 env、updater config 和 update record 重建 `observedBefore`，不能信任 Web 的
   `status.json` 作为执行前态。
4. apply 重新验证 tag、GitHub Release ID、manifest SHA256、manifest version 和目标 image digest；
   rollback 候选只接受不可变 tagged GHCR digest，按 record 的 `updatedAt` 选择状态快照候选，并通过
   source update-record hash 定位用户确认的精确目标，禁止按目录名字典序或执行时“最新记录”漂移。
5. 按 action 第一次比较 `expectedBefore` 与 `observedBefore`。
6. 完成目标下载/签名预检和只读准备后，在 backup/updater/config/Docker 副作用的最后边界重新校验 TTL、
   重新采集并第二次比较；apply 的任一过期 guard 必须输出唯一结构化 rejection marker，rollback 必须在
   source/env 候选准备完成后、原子替换 production env 的紧邻边界完成第二次 guard，不能使用第一次通过的
   快照继续执行。
7. 任一次不匹配都写入不可变 history 结果并停止；若 updater 缺失、矛盾地输出双比较 marker，或同时输出
   reconciliation 与 terminal marker，必须
   进入 `NEEDS_RECONCILIATION`，不得把退出码当成成功，也不得调用后续 updater、Docker 或 `config_set`。
8. mutation 的不可变 decision、claim 清理和 redacted `status.json` 终态发布必须在释放 shared lock 前完成，
   避免 direct updater 在终态投影期间插入另一轮生产状态变化。
9. 两次通过后才进入现有 migration、切换、smoke 或 config 更新路径。

`apply` 只有在 updater 同时给出完整双 guard、`executionAttempted=true` 和与退出码一致的
`applied` / 非 migration `rolled_back` 终态 marker 时才能清理 claim。副作用开始后被杀、普通异常、终态
marker 缺失或 migration 已启动后的失败统一进入 `NEEDS_RECONCILIATION`。`patch` 策略在两次比较点都由
root 再验证 `signatureRequired=true` 和 tagged GHCR `@sha256` digest，不能仅依赖 Web blocker。

建议 decision/reason code：

- `REQUEST_EXPIRED`
- `REQUEST_HASH_MISMATCH`
- `EXPECTED_BEFORE_MISMATCH`
- `ROLLBACK_TARGET_CHANGED`
- `ROLLBACK_PREPARATION_FAILED`
- `ROLLBACK_GUARD_EVIDENCE_INVALID`
- `ROLLBACK_ENV_SWITCH_UNCERTAIN`
- `TARGET_IDENTITY_CHANGED`
- `CURRENT_IMAGE_IDENTITY_INVALID`
- `PRODUCTION_STATE_LOCK_CHANGED`
- `DUPLICATE_REQUEST`
- `IDEMPOTENCY_CONFLICT`
- `LEGACY_MUTATION_UNBOUND`
- `INVALID_REQUEST_SCHEMA`
- `AUTO_APPLY_PREREQUISITES_UNMET`
- `MIGRATION_STATE_UNCERTAIN`
- `UPDATER_FINAL_STATE_UNCERTAIN`
- `MISSING_PROCESSING_REQUEST`

历史记录至少保留 idempotencyKey、requestHash、semanticHash、expectedBeforeHash、第一次和第二次
observedBeforeHash、observedAfterHash、claimId、evaluatedAt、ageSeconds、decision、reasonCode 和
`executionAttempted`。同一
idempotencyKey + semanticHash 返回既有终态且不重复执行；同 key 不同 semanticHash 返回
`IDEMPOTENCY_CONFLICT`。redacted status 只暴露 hash 和原因码，不暴露 env、secret、smoke
credential 或 root-only 路径。

严格 schema 和三类 hash 校验通过后，agent 先查询既有 immutable terminal decision；同 key、同
semantic hash 的传输重试即使自身 envelope 已过 TTL，也只能返回既有终态且不得重放副作用。只有没有
历史终态的新请求才进入 TTL admission，TTL 不因重试、排队或 agent 重启延长。

`executionAttempted` 表示是否已经进入生产状态副作用：目标/前态漂移、缺失命令、env 快照或临时文件
准备失败必须为 `false`；已经替换 env、调用 Docker 或进入恢复路径后才可为 `true`；无法确定时为
`null` 并进入 reconciliation。

## 原子发布与兼容

- Web 在 request 目录内写入随机临时文件并 `fsync` 文件，再以同目录硬链接原子发布最终 `.json`；
  已存在的同名请求必须 `EEXIST` fail-closed，不能覆盖不可变队列项。发布后删除临时链接并 `fsync`
  request 目录及新建父目录链；agent 只消费最终 `.json`。临时链接两次清理仍失败时不得报告
  durability synced。
- 最终链接成功但 directory `fsync` 失败时，API 按 at-most-once 边界返回“已发布、目录耐久性未确认”，
  提示先刷新状态而不是重复提交；这不等于请求已执行，也不替代 agent decision history。
- agent 领取后写 `claimedAt` / `claimExpiresAt`。崩溃遗留的 processing request 进入
  `needs_reconciliation`，不得自动重放 apply/rollback；恢复前先核对 updater record、当前镜像和
  副作用证据。
- agent 把 Web-owned inode 复制为 root-owned 临时 inode 后，必须以同目录原子 rename 直接替换原请求名；
  不得先删除原请求名再移动临时文件。替换失败时旧请求名仍须保留，供下一轮生成 reconciliation 证据。
- 只创建空 claim 目录、尚未移动 request 的 pre-claim 崩溃窗口可安全删除空目录并继续队列；只有存在
  claim metadata、request 或其他未解释文件时才升级为 reconciliation。
- processing 目录只剩 claim metadata、请求文件缺失时，必须生成持久的
  `MISSING_PROCESSING_REQUEST` reconciliation blocker，不能放行后续 mutation。
- 任何 active processing reconciliation，包括当前轮刚产生的 reconciliation，都必须同时投影到 redacted
  status 的顶层 `blocker`；即使合成
  decision 无法提供合法 action，Web/API admission 也必须 fail closed，不得继续堆积写请求。
- active processing 只阻塞 mutation；root agent 仍可领取并执行严格校验后的只读 `check`，刷新签名 Release
  identity 和 redacted status，但不得借此清理或重放未决 mutation claim。
- V1 `check` 可以在一个 release 过渡期兼容；当 Web 没有可验证的 V2 snapshot 时，版本中心只允许
  发布不带 snapshot 的 V1 只读 check，用于唤醒/刷新 root agent 状态。V1 `apply`、`rollback` 和
  `set_auto_apply` 必须归档为 `LEGACY_MUTATION_UNBOUND`，不得静默补写当前前态。
- root agent 对 V2 `set_auto_apply` 只接受 `none` 或 `patch`；Web 层之外的规范请求也不能绕过该策略边界。
- 旧 agent 会忽略 V2 附加字段。生产升级必须暂停 timer、隔离旧写请求、同时部署 Web 和 agent、
  用 V2 check 验证后再恢复 timer。
- 回滚到旧 agent 前必须暂停 timer 并隔离所有 V2 请求，避免 expected-before 被旧 agent 静默忽略。

## 实施范围

确认后允许修改：

- `apps/web/lib/system/update-center.ts`
- `apps/web/app/api/system/update-requests/route.ts`
- `apps/web/components/update-version-popover.tsx`
- `ops/update-agent/areaforge-update-agent.sh`
- `ops/github-release-updater/areaforge-updater.sh` 中的共享 production-state lock 与目标身份校验接口
- update request guard、agent fixture/selftest、preflight 和对应文档

不包含：

- 不执行生产 timer stop/start、队列隔离、agent 部署或 updater apply。
- 不执行 Web apply/rollback 请求，不修改生产 auto-apply 策略。
- 不新增数据库 migration，不读取或输出 secrets。
- 不关闭任何 residual；实现完成后 `AF-RISK-OPS-005` 仍需 Release 和生产部署证据。
- signed Release 阶段必须同时提供完整 supply-chain record 与 Release assets 目录，并通过
  `release:supply-chain:validate <record> <assets-dir> --strict`；record-only 结构通过不能升级该阶段。
- 生产 rejection/history/operational hash 必须来自记录旁的实际 redacted JSON 文件，validator 会重新读取、重算并
  校验同一 Release identity、V2 check、deployment、shared lock、processing reconciliation、requestHash、reasonCode、decision 和 `executionAttempted=false`。

## 验证矩阵

- 正常 V2 check/apply/rollback/policy request 通过。
- currentVersion、currentImage、autoApply、signatureRequired 各自变化时拒绝。
- rollback target version 或 digest 漂移时拒绝。
- rollback 后陈旧 apply、apply 后陈旧 rollback 均拒绝。
- TTL 精确允许边界、过期、未来时间、倒置时间和超长 TTL 均有正反 fixture。
- request/expected-before hash 篡改、未知字段、文件名/ID 不一致和重复 ID 拒绝。
- 非 ASCII `expectedBefore.currentImage` 在 agent 和 updater request-guard 两层均拒绝。
- 同 idempotency key 同 semantic hash 返回既有结果；同 key 不同 semantic hash 冲突。
- duplicate/replay/conflict 派生 history 不得替代该 idempotency key 的首个规范终态。
- request `status`、rollback availability、target evidence 或任一 hash 字段篡改必须失败。
- tag、Release ID、manifest hash/version、image digest 或 rollback source record hash 漂移时拒绝。
- Release tag、manifest version、`webImage` tag 或 digest 中的 tagged reference 不一致时，在生成 verified target 前拒绝。
- V1 check 兼容，V1 写动作拒绝。
- 拒绝路径断言 updater、Docker 和 config write 均未调用。
- 原子发布 selftest 证明 file `fsync` 失败时零发布、临时或未完成文件不会被消费、已存在请求不会被
  覆盖，并覆盖 directory `fsync` 失败后的显式 uncertain 状态。
- apply、rollback、policy 与 manual updater 的共享锁 fixture 使用系统 `flock`，或在本机缺少命令时
  使用基于内核 `flock(2)` 的测试适配器，证明已覆盖的写阶段不能交错；生产并发行为仍需匹配 Release
  和独立证据验证。
- updater 在获取 shared lock 后重新加载配置时，先恢复进程启动时的环境 baseline，再 source 当前配置；
  已删除的 auto-apply 或 signature 字段必须回到安全默认值，不能沿用第一次加载的旧值。
- processing claim 超期进入 needs_reconciliation，mutation 不自动重放。
- decision 已持久化但 claim 清理前崩溃时，重启必须验证同一 request/claim 的既有 decision 后清理 claim，不能重复写 history 或重放 mutation。
- decision 已持久化但 claim 清理只完成一部分、导致 `claim.json` 缺失而 request 文件残留时，重启必须按
  request ID + requestHash 找回既有终态并清理，不得生成虚假的永久 reconciliation blocker。
- 第一次比较通过后，若目标预检/准备期间状态变化或 TTL 在最终边界过期，第二阶段拒绝且不进入副作用。
- updater 缺失、重复、与退出码矛盾的 marker、只读 check 的 `executionAttempted=false`、root-only 路径脱敏和 claim/history
  fsync 故障路径均 fail closed。
- rollback 目标切换失败时必须尝试恢复原 env 和 web；恢复无法确认时记录 `ROLLBACK_RECOVERY_UNCERTAIN` 并进入
  `NEEDS_RECONCILIATION`，不得把 env 与实际运行态分裂当作普通完成或可继续状态。
- apply 失败后的自动应用回滚同样遵守该规则：updater 以专用非零状态报告恢复不确定，agent 只有在双 guard
  与 `executionAttempted=true` 证据完整时才记录 `ROLLBACK_RECOVERY_UNCERTAIN`，否则保持更保守的 guard evidence reconciliation。
- health smoke 失败必须返回 apply 主流程并触发现有自动回滚，不能在 smoke helper 内直接退出；允许 compose
  更新时，应用回滚必须同时恢复已备份 compose，避免记录 `rolled_back` 后仍运行失败版本配置。
- 对外 operation/status message 必须脱敏任意绝对路径，包括自定义 `/srv`、`/mnt` 等部署位置，而不是只覆盖固定目录前缀。
- production env、rollback source record 和 decision history 的 file/directory fsync 失败均停在可协调边界。
- stale/missing processing claim 进入 `NEEDS_RECONCILIATION` 后必须跨 agent 轮次持续阻塞后续 mutation，
  直到人工协调；apply/rollback 的最终 update record 持久化失败必须返回专用 reconciliation 状态，
  不能记为普通失败后继续队列。
- missing-request 等合成 reconciliation 必须在 status 顶层保留 blocker，使 Web/API 与 root 队列保持一致的拒绝边界。
- claim fixture 必须覆盖 Web 可控 symlink/hardlink 不被 root `chmod` 跟随、root inode 原子替换失败不丢请求，
  以及 claim-only 崩溃窗口不放行后续 mutation。
- OPS-005 生产证据必须把 `webImageDigest` 交叉绑定到签名 Release 记录，并通过 Git object 读取把
  update-agent/updater 脚本 SHA-256 绑定到该 Release commit；脏工作树或仅格式合法不构成部署身份确认。
- preflight 的 commit override 必须精确等于真实 checkout `HEAD`，不能用干净 checkout B 冒充旧 Release commit A；
  独立 production evidence validator 同样必须输入实际 Release assets 并通过 checksum/cosign strict 校验。
- shellcheck、typecheck、lint、`pnpm check`、governance、risk 和 docs gates 通过。

## 生产部署与回滚边界

本地实现通过后仍不能直接进入生产。生产部署必须另行确认，并至少执行：暂停 timer、记录队列文件名
和 hash、隔离旧写请求、部署匹配版本 Web/agent、提交只读 V2 check、恢复 timer、采集 redacted
status/history evidence。若部署失败，先暂停 timer并隔离 V2 请求，再同时回滚 Web 和 agent；不得把旧
请求自动重排或重新授权。
