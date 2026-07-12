# 品牌素材

## 定位

AreaForge 的当前品牌素材包位于 `assets/brand/final/`。它保存可编辑 SVG 源文件和常用 PNG 导出，用于后续 README、文档封面、登录页、顶部导航、PWA/App icon 或宣传图接入。

该目录只是素材源事实，不是运行时资源入口。素材入库不代表当前线上 `0.1.7`、Web favicon、PWA manifest、登录页或首页已经采用这些文件。

## 当前资产

| 类型 | 源文件 | PNG 导出 |
|---|---|---|
| App icon | `areaforge-app-icon-dark.svg`、`areaforge-app-icon-light.svg` | `app-icon/` 下深浅两套 `16/32/64/128/256/512/1024` |
| 小尺寸 icon | `areaforge-app-icon-small-dark.svg`、`areaforge-app-icon-small-light.svg` | `app-icon/` 下 `16/32` 使用小尺寸同源简化版导出 |
| Logo mark | `areaforge-logo-mark-dark.svg`、`areaforge-logo-mark-light.svg` | `mark/` 下深浅两套 `256/512/1024` |
| 单色 mark | `areaforge-logo-mark-mono-dark.svg`、`areaforge-logo-mark-mono-light.svg` | `mark/` 下单色深浅两套 `256/512/1024` |
| 横向 Logo | `areaforge-logo-lockup.svg`、`areaforge-logo-lockup-dark.svg`、`areaforge-logo-lockup-light.svg` | `lockup/` 下默认、深色和浅色背景 `1600x520` |

## 设计约束

- 当前核心符号为证据弧线、试卷、倒计时轴和淬火行动节点的组合；后续变体应围绕同一符号，不重新发散为另一套图标。
- 深浅色版本保持同一图案和结构，只调整配色与对比。
- 横向 Logo 使用完整 `AreaForge` 字标；`Area` 用深色或深色背景反白，`Forge` 用青绿到琥珀/橙强调。
- 小尺寸 icon 可以简化细节，但必须保持同源大轮廓。
- 单色 mark 用于无法使用品牌色的场景，不替代主品牌图标。

## 接入规则

后续把素材接入 Web/PWA/README 时，按接入面验证：

- 只更新文档或素材引用：检查路径、渲染结果和 `git diff --check`。
- 接入 Web favicon、manifest、登录页或导航栏：按 UI 变更运行 Web 检查，并在可行时做浏览器截图验证。
- 接入线上版本：按 release train 判断是否需要 GitHub Release；素材存在本身不等于生产已更新。
