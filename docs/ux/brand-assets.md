# 品牌素材

## 定位

AreaForge 的当前品牌素材包位于 `assets/brand/final/`。它保存可编辑 SVG 源文件、常用 PNG 导出、Web/PWA 接入素材、原生平台图标和印刷交付文件。

该目录仍是品牌素材源事实。当前 checkout 通过 `assets/brand/brand-manifest.json` 把受控副本同步到 `apps/web/app/` 和 `apps/web/public/brand/`；素材或代码进入工作区不代表线上已发布更新。

## 当前资产

| 类型 | 源文件 | PNG 导出 |
|---|---|---|
| App icon | `areaforge-app-icon-dark.svg`、`areaforge-app-icon-light.svg` | `app-icon/` 下深浅两套 `16/32/48/64/128/180/192/256/512/1024` |
| 小尺寸 icon | `areaforge-app-icon-small-dark.svg`、`areaforge-app-icon-small-light.svg` | `app-icon/` 下 `16/32/48` 使用小尺寸同源简化版导出 |
| Opaque icon | `areaforge-app-icon-opaque-dark.svg`、`areaforge-app-icon-opaque-light.svg` | `app-icon/` 下不透明 `180/1024` 深浅两套 |
| Maskable icon | `areaforge-app-icon-maskable-dark.svg`、`areaforge-app-icon-maskable-light.svg` | `app-icon/` 下全出血 `192/512` 深浅两套 |
| Logo mark | `areaforge-logo-mark-dark.svg`、`areaforge-logo-mark-light.svg` | `mark/` 下深浅两套 `256/512/1024` |
| 单色 mark | `areaforge-logo-mark-mono-dark.svg`、`areaforge-logo-mark-mono-light.svg` | `mark/` 下单色深浅两套 `256/512/1024` |
| 彩色透明 Symbol | `areaforge-logo-symbol-dark.svg`、`areaforge-logo-symbol-light.svg` | `symbol/` 下 `256/512/1024` 浅色/深色背景适配两套，中心骨架均为深色 |
| 横向 Logo | `areaforge-logo-lockup.svg`、`areaforge-logo-lockup-dark.svg`、`areaforge-logo-lockup-light.svg` | `lockup/` 下默认、深色和浅色背景 `1600x520` |
| 轮廓化横向 Logo | `areaforge-logo-lockup-outlined*.svg` | `lockup/` 下对应 `1600x520` PNG |
| 单色横向 Logo | `areaforge-logo-lockup-mono-dark.svg`、`areaforge-logo-lockup-mono-light.svg` | `lockup/` 下单色深浅两套 `1600x520` |
| 纯字标 | `areaforge-wordmark-dark.svg`、`areaforge-wordmark-light.svg` | `wordmark/` 下深浅背景 `1200x336` |
| 竖向堆叠 Logo | `areaforge-logo-stacked-dark.svg`、`areaforge-logo-stacked-light.svg` | `stacked/` 下深浅背景 `1024x1024` |
| Favicon | 小尺寸 App icon 同源 | `favicon/` 下 `16/32/48` PNG 与多尺寸 ICO |
| 社交预览图 | `social/areaforge-social-preview-light.svg`、`social/areaforge-social-preview-dark.svg` | `social/` 下浅色和深色 `1200x630` PNG；无后缀文件为浅色兼容入口 |
| 品牌总览 | 由当前最终素材合成 | `areaforge-brand-overview.png`，尺寸为 `1600x1200` |
| macOS | opaque dark 1024px | `native/macos/AreaForge.icns` 与完整 `.iconset` |
| iOS / iPadOS | opaque dark 1024px | `native/ios/AreaForgeAppIcon.appiconset/`，含 iPhone、iPad 与 marketing 尺寸 |
| Android | 透明 Symbol 与品牌深色背景 | `native/android/res/` adaptive icon 工程目录 |
| Windows | opaque dark 1024px | `native/windows/AreaForge.ico`，含 `16/24/32/48/64/128/256` |
| 印刷 | 轮廓化横向 Logo | `print/` 下 SVG、矢量 PDF 与 300 DPI CMYK TIFF |

印刷交付以 outlined SVG 和矢量 PDF 为现代矢量源，不提供无法可靠保持透明度、渐变且不能在当前 macOS 稳定回读验证的 EPS；具体边界见 `assets/brand/final/print/README.md`。

## 标准色

下表是数字环境的标准值。CMYK 为从 sRGB 换算的通用印刷起点，不替代印厂打样或专色确认。

| 名称 | HEX | RGB | CMYK 近似 | 用途 |
|---|---|---|---|---|
| Forge Ink 950 | `#06191F` | `6, 25, 31` | `81, 19, 0, 88` | 深色背景、核心骨架 |
| Forge Ink 900 | `#09272D` | `9, 39, 45` | `80, 13, 0, 82` | 浅色背景字标、描边 |
| Quench Teal 600 | `#18AAA6` | `24, 170, 166` | `86, 0, 2, 33` | 主强调、轨迹 |
| Quench Teal 400 | `#35D7C5` | `53, 215, 197` | `75, 0, 8, 16` | 高亮节点、浅色强调 |
| Evidence Amber 300 | `#FFD75F` | `255, 215, 95` | `0, 16, 63, 0` | 倒计时节点、证据强调 |
| Forge Heat 500 | `#F05F3D` | `240, 95, 61` | `0, 60, 75, 6` | 淬火行动节点、风险强调 |
| Mist 50 | `#F4FBF8` | `244, 251, 248` | `3, 0, 1, 2` | 深色背景文字 |
| Mist 100 | `#DFF2EC` | `223, 242, 236` | `8, 0, 2, 5` | 浅色背景、辅助面 |

## 字体

- 产品与品牌辅助文字使用 `Inter, SF Pro Display, Segoe UI, Helvetica Neue, Arial, sans-serif`。
- Logo 中 `AreaForge` 的正式字形以 outlined SVG 为准；不得通过本机字体重新排版来替代正式字标。
- 标题推荐 `600-760` 字重，正文推荐 `400-500`，数字与运行状态使用等宽数字特性时不得改变 Logo 字形。
- 对外分发横向 Logo 时优先使用 outlined SVG、PDF 或 PNG；可编辑 `<text>` 版本只用于内部调整。

## 留白与最小尺寸

- 以 Symbol 顶部黄色节点的直径记为 `X`。Logo 四周最少保留 `0.5X` 空白，不得让文字、边框或裁切线进入该范围。
- 横向 Logo 的最小屏幕宽度为 `120px`，印刷最小宽度为 `25mm`。
- 独立 mark/Symbol 的常规界面最小尺寸为 `24px`；低于 `48px` 必须使用 small icon 源，最低不得小于 `16px`。
- 社交预览图必须保持 `1200x630` 比例；不得从中裁出 Logo 作为独立品牌素材。
- Maskable 图标不得移动核心图形或扩大到安全区外；Apple/App Store 图标不得引入透明通道。

## 背景与版本选择

| 场景 | 推荐素材 |
|---|---|
| 深色产品 UI | `areaforge-logo-lockup-outlined-dark.svg`、dark app icon、light Symbol |
| 浅色文档或页面 | `areaforge-logo-lockup-outlined-light.svg`、light app icon、dark Symbol |
| 单色打印、压印或无品牌色环境 | `mono-dark` 或 `mono-light` |
| 浏览器标签与 16/32/48px | small icon / `favicon/` |
| Apple touch、iOS、macOS | opaque icon / `native/macos` / `native/ios` |
| Android adaptive icon | `native/android/res/` |
| Windows 桌面应用 | `native/windows/AreaForge.ico` |
| 社交分享 | `social/areaforge-social-preview-dark.png` 或 light 版本 |

## 禁止用法

- 不拉伸、压扁、旋转、镜像或改变图标内部几何关系。
- 不替换 `AreaForge` 字形，不改变 `Area` 与 `Forge` 的相对字重和间距。
- 不把青绿、琥珀、橙色节点任意换成产品状态色。
- 不给 Logo 添加额外描边、发光、投影、渐变底板或装饰图形。
- 不把透明常规 icon 当作 opaque 或 maskable 图标使用。
- 不在对比不足、纹理复杂或会遮挡核心节点的背景上直接使用彩色 Logo。
- 不裁掉轨迹端点、节点或字标下方证据曲线。

## 权利与授权

- AreaForge Logo、字标和品牌组合由 AreaForge 项目维护者管理，仓库内用于 AreaForge 产品、文档、发布与维护材料。
- 仓库许可不自动授予第三方将 Logo 用于联名、背书、仿冒产品、域名或商业宣传的权利。
- 外部再分发、媒体包、合作方使用或商业授权需得到维护者明确许可。
- 在完成法律注册前，不使用 `®`，也不把当前品牌材料描述为已注册商标。

## 设计约束

- 当前核心符号为证据弧线、试卷、倒计时轴和淬火行动节点的组合；后续变体应围绕同一符号，不重新发散为另一套图标。
- 深浅色版本保持同一图案和结构，只调整配色与对比。
- 横向 Logo 使用完整 `AreaForge` 字标；`Area` 用深色或深色背景反白，`Forge` 用青绿到琥珀/橙强调。
- 小尺寸 icon 可以简化细节，但必须保持同源大轮廓。
- 单色 mark 用于无法使用品牌色的场景，不替代主品牌图标。
- 常规图标用于透明圆角场景；Apple/App Store 使用 opaque 版本；PWA `purpose=maskable` 使用 maskable 版本。
- 轮廓化横向 Logo 不包含 `<text>` 或外部字体依赖，是跨环境分发的优先版本。
- `lockup/wordmark/stacked/symbol` 文件名中的 `dark/light` 表示目标背景或对比调色；彩色 Symbol 的中心骨架始终保持深色，只有 `mono` 中的 `dark/light` 表示墨线明暗。
- 社交预览图的深浅版本保持同一构图和文案，仅调整背景、前景和 Logo 对比。

## 接入规则

维护现有 Web/PWA/README 接入或增加新接入面时，按影响范围验证：

- 机器资产矩阵位于 `assets/brand/brand-manifest.json`；`pnpm brand:export` 补缺失文件并同步 runtime，`pnpm brand:export -- --refresh` 全量重建派生素材。
- 只更新文档或素材引用：运行 `pnpm brand:validate`、检查路径、渲染结果和 `git diff --check`。
- 接入 Web favicon、manifest、登录页或导航栏：按 UI 变更运行 Web 检查，并做桌面与移动端浏览器截图验证。
- 接入线上版本：按 release train 判断是否需要 GitHub Release；素材存在本身不等于生产已更新。
