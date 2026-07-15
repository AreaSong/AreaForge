# Update Request Expected-Before 设计

## 目标

为 Web 版本中心提交到 root update-agent 的 `check`、`apply`、`rollback` 和
`set_auto_apply` 请求增加执行时前态绑定，阻止陈旧请求在生产状态变化后继续执行。

本设计只定义本地代码实施契约和验证方式，不授权生产部署、队列处理、updater apply、
rollback、策略变化或服务器命令。

本地实施状态：schema V2、agent-authored snapshot binding、target identity、三个 canonical hash、TTL、
idempotency、原子发布、processing reconciliation、共享 production-state lock、双 compare-and-reject、
legacy mutation fail-closed 和不可变 decision history 已在当前 checkout 实现。使用
`pnpm ops:ops-005:local:selftest`、`pnpm shellcheck:updater` 和
`pnpm github-release-updater:preflight` 验证；该状态不证明签名 Release 或生产部署完成。

## 当前风险

当前 Web 在请求入队前读取 `status.json` 并做一次提示性校验，但请求只保存 action、tag、
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
    "webImageDigest": "ghcr.io/areasong/areaforge-web:v0.1.8@sha256:<digest>"
  },
  "expectedBefore": {
    "currentVersion": "0.1.7",
    "currentImage": "ghcr.io/areasong/areaforge-web:v0.1.7@sha256:<digest>",
    "autoApply": "none",
    "signatureRequired": true,
    "rollbackTargetVersion": "0.1.5",
    "rollbackTargetImage": "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:<digest>"
  },
  "expectedBeforeHash": "<sha256>",
  "semanticHash": "<sha256>",
  "requestHash": "<sha256>"
}
```

约束：

- schema 必须严格拒绝未知顶层和嵌套字段。
- 文件名必须精确等于 `${id}.json`。
- `status` 在入队文件中只能是 `queued`；mutable execution fields 不进入 request hash。
- canonical JSON 只允许受约束的 ASCII 字符串、布尔、null 和整数；Node 与 `jq -cS` 必须由
  cross-runtime selftest 证明输出一致。
- `semanticHash` 只覆盖会改变副作用语义的 action、normalized target、params 和 expectedBefore；
  排除 id、actor、requestedAt、expiresAt 和执行状态，用于幂等冲突判断；投影必须包含固定 domain
  `areaforge.update-request.v2`，防止跨对象 hash 复用。
- `requestHash` 覆盖完整 immutable envelope：schemaVersion、id、idempotencyKey、action、requestedAt、
  expiresAt、actorEmailHash、params、target、expectedBefore、expectedBeforeHash 和 semanticHash。
- apply 的 target 必须来自 root agent 已完成签名/manifest 检查后写入的 status snapshot；只携带 tag
  不足以证明用户确认的是同一 Release 内容。

## 动作前态

| 动作 | 必须比较的前态 | TTL |
|---|---|---:|
| `check` | 不绑定生产写前态，只校验 schema/hash/TTL/重复 ID | 15 分钟 |
| `apply` | currentVersion、currentImage digest、autoApply、signatureRequired；target release ID、manifest hash、manifest version 和 web image digest | 5 分钟，硬上限 10 分钟 |
| `rollback` | currentVersion、currentImage、rollback target version/image、source update-record hash | 5 分钟，硬上限 10 分钟 |
| `set_auto_apply` | current autoApply；目标不是 `none` 时再比较 currentImage 和 signatureRequired | 5 分钟，硬上限 10 分钟 |

允许最多 30 秒时钟偏差。未来 requestedAt、expiresAt 早于 requestedAt、超过动作硬上限或执行时已
过期都必须拒绝；排队和 agent 重启不得延长 TTL。

## Root Agent 决策顺序

agent 在把请求标记为 running 前必须：

1. 原子 rename 到 root-only `processing/` 领取请求，并校验普通文件、文件名、schema、canonical
   hash、TTL、重复 ID 和 idempotency key。
2. 获取与 updater/manual mutation 共用的 production-state lock；compare 与副作用之间不得释放锁。
3. 从生产 env、updater config 和 update record 重建 `observedBefore`，不能信任 Web 的
   `status.json` 作为执行前态。
4. apply 重新验证 tag、GitHub Release ID、manifest SHA256、manifest version 和目标 image digest；
   rollback 通过 source update-record hash 定位精确目标，禁止执行时重新选择“最新记录”。
5. 按 action 第一次比较 `expectedBefore` 与 `observedBefore`。
6. 完成目标下载/签名预检和备份准备后，在 updater/config/Docker 副作用的最后边界重新采集并第二次
   比较；不能使用第一次通过的快照继续执行。
7. 任一次不匹配都写入不可变 history 结果并停止；不得调用 updater、Docker 或 `config_set`。
8. 两次通过后才进入现有 migration、切换、smoke 或 config 更新路径。

建议 decision/reason code：

- `REQUEST_EXPIRED`
- `REQUEST_HASH_MISMATCH`
- `EXPECTED_BEFORE_MISMATCH`
- `ROLLBACK_TARGET_CHANGED`
- `TARGET_IDENTITY_CHANGED`
- `DUPLICATE_REQUEST`
- `IDEMPOTENCY_CONFLICT`
- `LEGACY_MUTATION_UNBOUND`
- `INVALID_REQUEST_SCHEMA`

历史记录至少保留 idempotencyKey、requestHash、semanticHash、expectedBeforeHash、第一次和第二次
observedBeforeHash、observedAfterHash、claimId、evaluatedAt、ageSeconds、decision、reasonCode 和
`executionAttempted`。同一
idempotencyKey + semanticHash 返回既有终态且不重复执行；同 key 不同 semanticHash 返回
`IDEMPOTENCY_CONFLICT`。redacted status 只暴露 hash 和原因码，不暴露 env、secret、smoke
credential 或 root-only 路径。

## 原子发布与兼容

- Web 在 request 目录内写入随机临时文件，`fsync` 文件后用原子 `rename` 发布最终 `.json`，
  再 `fsync` 目录；agent 只消费最终 `.json`。
- agent 领取后写 `claimedAt` / `claimExpiresAt`。崩溃遗留的 processing request 进入
  `needs_reconciliation`，不得自动重放 apply/rollback；恢复前先核对 updater record、当前镜像和
  副作用证据。
- V1 `check` 可以在一个 release 过渡期兼容；V1 `apply`、`rollback` 和 `set_auto_apply` 必须
  归档为 `LEGACY_MUTATION_UNBOUND`，不得静默补写当前前态。
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

## 验证矩阵

- 正常 V2 check/apply/rollback/policy request 通过。
- currentVersion、currentImage、autoApply、signatureRequired 各自变化时拒绝。
- rollback target version 或 digest 漂移时拒绝。
- rollback 后陈旧 apply、apply 后陈旧 rollback 均拒绝。
- TTL 边界、过期、未来时间、倒置时间和超长 TTL 拒绝。
- request/expected-before hash 篡改、未知字段、文件名/ID 不一致和重复 ID 拒绝。
- 同 idempotency key 同 semantic hash 返回既有结果；同 key 不同 semantic hash 冲突。
- tag、Release ID、manifest hash/version、image digest 或 rollback source record hash 漂移时拒绝。
- V1 check 兼容，V1 写动作拒绝。
- 拒绝路径断言 updater、Docker 和 config write 均未调用。
- 原子发布 selftest 证明 agent 不消费临时或未完成文件。
- apply/rollback/manual updater 并发 selftest 证明 production-state lock 不允许写阶段交错。
- processing claim 超期进入 needs_reconciliation，mutation 不自动重放。
- 第一次比较通过、目标预检或备份准备期间状态变化时，第二次比较拒绝且不进入副作用。
- shellcheck、typecheck、lint、`pnpm check`、governance、risk 和 docs gates 通过。

## 生产部署与回滚边界

本地实现通过后仍不能直接进入生产。生产部署必须另行确认，并至少执行：暂停 timer、记录队列文件名
和 hash、隔离旧写请求、部署匹配版本 Web/agent、提交只读 V2 check、恢复 timer、采集 redacted
status/history evidence。若部署失败，先暂停 timer并隔离 V2 请求，再同时回滚 Web 和 agent；不得把旧
请求自动重排或重新授权。
