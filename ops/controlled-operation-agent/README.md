# 独立受控运维执行器

本目录与 Web runtime 分离。只有固定白名单可以进入执行，所有入口默认关闭；生产配置、启用、安装与实际执行仍须独立确认。

## 协议与恢复

- `packages/db/src/controlled-operation-protocol.ts`：严格执行绑定、旧 updater wire、独立 hash domain。
- `packages/db/src/controlled-operation-store.ts`：持久 claim、租约/代次、控制屏障、回执来源绑定和脱敏审计。
- `lock-exec.py`：以 queue-control → production-state → agent-local 顺序取得本执行器的文件锁，传递到固定 Node 入口。调用的子进程继续继承锁。
- `engine.ts` / `journal.ts`：不可覆盖文件桥接、阶段日志、双前态检查、全作用域锚校验与重启对账。
- `production-driver.ts` / `dispatch.sh`：固定映射到原 root agent；外层锁之后才进入原 queue-control → production-state 锁，不从旧锁反向获取新锁。

同一次请求的 root journal、数据库 claim 和脱敏投影须共同保留。不要手工删除 journal、修改原始请求、重置租约或把未知结果重新排队。
root 桥接登记以私有运行根指纹绑定请求；即使整个 journal 目录丢失，其他请求的准入也会被数据库锚阻断。只登记但从未领取的准备记录不视为未知副作用。
已执行结果仅补写回执；未知副作用必须人工对账。正常锁竞争的可靠零执行拒绝不会升级为永久对账屏障。

## 本地合成验收

先取得 OPS 本地确认包批准，再创建 canonical 私有 `areaforge-v20-ops-*` 临时根：

```text
pnpm exec tsx scripts/quality/controlled-operation-fixture-create.ts <new-private-root>
pnpm exec tsx scripts/quality/controlled-operation-fixture-migrate.ts <new-private-root>
pnpm ops:controlled:selftest
pnpm ops:controlled:runtime:selftest <new-private-root>
pnpm exec tsx scripts/quality/controlled-operation-pool-refresh.ts <new-private-root> 3
pnpm ops:controlled:browser:selftest <new-private-root>
```

创建脚本只允许全新 loopback `areaforge_v20_ops_*` 数据库及当前 UID/仓库绑定的合成目录。
迁移脚本核对确认包 schema preimage，只部署既有 canonical migration，不新增 DDL。
专用三槽池只占空槽或同一 fixture；释放旧槽必须先核对归属，数据库、卷和历史目录不随之删除。
Web 只读挂载空 uploads/exports 与脱敏 `context` 目录，不能访问 `agent`、合成签名材料或数据库凭据文件。
副作用适配器只写本批合成计数回执；合成签名仅使用现场生成的测试密钥。测试结果不证明生产 apply/backup/rollback。

## 生产配置边界

生产模式要求已有 Node/tsx、Python flock 和原 updater 工具链；本实现不安装宿主服务、不调整用户/组、不设置 timer。
配置文件及其父目录必须分别为 root 私有普通文件和私有目录，不能是软链接。
配置采用严格 JSON 字段：`schemaVersion`、`enabled`、`scopeId`、`operatorEmail`、`databaseUrl`、`stateRoot`、`legacyStateRoot`、`updaterConfigFile`、`contextDirectory`。
真实数据库 URL 只保存在该 root 私有配置，不能放到 Web、请求 JSON、版本库或命令行参数。

- `stateRoot` 必须预先存在、canonical、root-owned、0700；原始 journal 只在此目录。
- `updaterConfigFile` 是现有受信 root 配置，必须私有，继续约束固定 GitHub repository、签名、备份、compose、health 与 rollback。
- `legacyStateRoot` 是原 agent 状态目录；原处理中的 claim、维护 hold 或未结清 journal 会阻止新的 mutation。
- `contextDirectory` 是独立的 root-owned、不可由其他用户写入的脱敏发布目录，可只读挂载给 Web，不与私有配置/journal 混用。
- `scopeId` 必须与 Web 的 `OPS_EXECUTION_SCOPE_ID` 完全一致。

只有生产确认与发布/迁移/备份/回滚门禁满足后，才可在独立 root 进程显式设置 `OPS_AGENT_ENABLED=true` 和 `OPS_AGENT_PRODUCTION_ENABLED=true`，通过固定锁入口运行 `run.ts production <private-config> <request-id>`；`context` 参数只发布脱敏前态。不得直接绕过锁运行 Node 入口。

锁入口参数形式为 `python3 ops/controlled-operation-agent/lock-exec.py <stateRoot> <absolute-node> <absolute-tsx-loader> <absolute-run.ts> production <private-config> <request-id-or-context>`，所有路径均由受信部署配置解析，不能来自 Web 请求。
原 updater 的 `set_auto_apply`、任意 shell、自由路径/env、backup 执行、宿主重启或 systemd 安装不属于本白名单。

产品行为见[受控运维](../../docs/modules/controlled-operations.md)。
