# braces 回归输入与运行方式

这里只维护稳定测试数据。脚本组织调整不安装依赖、不应用补丁，也不代表 braces 安全验证或依赖审计通过。

## 来源与提取

原始路径、原始字节 SHA-256、提取后字节 SHA-256 和数量见 [sources.json](sources.json)。历史文件保留在原处；日常运行只读本目录的 fixtures，不读取这些历史路径。

- [patterns.json](patterns.json)：从 `output/dependency-audit/dep-2a/expansion-observations.json` 按数组顺序只提取 `pattern`，共 17 项。正式脚本原先只消费该字段，未消费旧观察中的展开结果。
- [normal-before.json](normal-before.json)：从 `output/dependency-audit/dep-2b/execution/normal-before.json` 按原顺序提取 58 项的 `case`、`category`、`result`、`error`、`warnings`、`exitCode`、`signal`（字段原先不存在则继续省略），保留空 `failures`。这些正是原脚本逐项使用 `JSON.stringify` 比较的字段；没有排序、去重或重写错误/警告。移除顶层时间、运行环境/安装路径和每项耗时、未参与比较的 stderr 等采集元数据。
- 所有路径文本原样提取；`$FIX` 是原记录已有的绝对临时测试根占位符。运行时只把本次真实临时测试根替换回 `$FIX`，不会把相对路径变成绝对路径，也不折叠 `./` 或尾斜杠。

在仓库根运行定向测试（自建一个临时文件目录并在结束时清理，不创建安装环境）：

```sh
node --test scripts/quality/braces-depth-regression.test.cjs
```

需要重新核验历史提取完整性、且上述原记录仍存在时运行：

```sh
BRACES_VERIFY_SOURCES=1 node --test scripts/quality/braces-depth-regression.test.cjs
```

后者要求原始字节 hash 和全部比较字段均一致；原文件缺失或变更就失败。普通测试仅跳过这一项历史来源核验，仍核对 fixtures 摘要、语义和运行门禁。测试中的 DEP-2A 原像/后像仅用于真实原包门禁测试，不生成可发布候选，不消费 DEP-2C-2 候选或四个历史安装环境。

## 显式候选契约

`--manifest` 与 `--manifest-sha256` 必填。清单沿用已有 schema 1 结构，严格要求：

- `schema: 1`、`package: "braces"`、`version: "3.0.3"`、`patchSha256`。
- `files` 按顺序完整列出 `lib/compile.js`、`lib/constants.js`、`lib/expand.js`、`lib/parse.js`、`lib/stringify.js`，每项含 `file`、`beforeSha256`、`afterSha256`。原像和后像不得相同。
- `unchangedFiles` 按顺序列出 `index.js`、`lib/utils.js`、`package.json`，每项含 `file`、`sha256`。
- `consumerChain` 按顺序列出 `eslint-config-next`、`@next/eslint-plugin-next`、`fast-glob`、`micromatch`、`braces`，每项含 `name`、入口 `sha256`。从 Web 的真实依赖解析链验证摘要及模块实际加载。
- 兼容既有可选来源字段 `integrity`、`sourceTarball`、`sourceTarballSha256`、`observationsSha256`；它们是来源描述，不触发读取 tarball 或旧观察文件，也不证明批准有效。摘要均为小写 64 位十六进制 SHA-256；未知字段、缺失断言和不合法路径集合失败关闭。

DEP-2A 的旧 `draft-validation.json` 缺少完整包/消费链断言，不能直接传入新入口。没有默认候选，也不自动采用 DEP-2C-2。候选准备、批准及安装仍是独立工作。`--patch` 默认指向正式 `patches/braces@3.0.3.patch`；显式另给路径只读取并比对 hash，不执行补丁。

## 两种模式

以下环境变量由调用者提供：`BRACES_MANIFEST` 为已核验清单路径，`BRACES_MANIFEST_SHA256` 为独立核验的清单摘要，`BRACES_OUTPUT` 为不存在的绝对输出路径。命令不包含安装动作；修补后模式要求安装树已真实匹配候选后像。

```sh
node scripts/quality/braces-depth-regression.cjs \
  --mode verify-patched \
  --manifest "${BRACES_MANIFEST:?请提供清单路径}" \
  --manifest-sha256 "${BRACES_MANIFEST_SHA256:?请提供清单摘要}" \
  --output "${BRACES_OUTPUT:?请提供全新输出路径}"
```

默认比较正式 `normal-before.json`。若需另用已验证旧包基线，追加 `--baseline "$BRACES_BASELINE" --baseline-sha256 "$BRACES_BASELINE_SHA256"`，路径和摘要必须同时传入；58 项数量、顺序、用例、错误分类和已通过状态均须匹配。原 DEP-2B 报告和本脚本的通过采集报告都可显式传入。

仅采集旧包普通行为时，将上面命令的模式改为 `--mode record-before`，使用另一个全新输出路径；不传 `--baseline`。该模式验证原像，运行 58 项普通行为，深度用例数量固定为 0，输出 `normal-before.json`。它不能证明补丁生效。修补后模式输出 `regression.json`；当前仍加载原包时会在后像门禁退出 1，深度测试不执行。

输出父目录须已存在且为真实路径（macOS 使用 `/private/tmp/...` 而非 `/tmp/...` 链接）。脚本排他创建全新目录，拒绝复用已有目录/文件、链接祖先、仓库源码目录和历史 `output` 子树；仓库内仅允许 `output` 的全新直接子目录。目录和结果文件均采用排他创建，所有子进程绑定同一模式、输入摘要、安装身份和输出目录。失败退出 1；已开始运行的失败只保存 `status: failed` 的结果或 `failure.json`，不会保存通过结论。身份或参数预检失败不创建结果目录。中断留下的目录也不得复用，应另给新路径并保留旧证据。
