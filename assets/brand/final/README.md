# AreaForge Brand Assets

本目录保存 AreaForge 当前品牌素材包。它是仓库内设计素材，不是 Web runtime 资源入口；文件存在不代表线上版本、favicon、PWA manifest、登录页或首页已经使用这些素材。

## 目录

- `areaforge-app-icon-dark.svg` / `areaforge-app-icon-light.svg`：完整 App/PWA 图标源。
- `areaforge-app-icon-small-dark.svg` / `areaforge-app-icon-small-light.svg`：16px 和 32px 小尺寸同源简化图标源。
- `areaforge-app-icon-opaque-dark.svg` / `areaforge-app-icon-opaque-light.svg`：Apple Touch Icon 和 App Store 使用的不透明全出血图标源。
- `areaforge-app-icon-maskable-dark.svg` / `areaforge-app-icon-maskable-light.svg`：PWA maskable 全出血图标源，核心图形位于安全区内。
- `areaforge-logo-mark-dark.svg` / `areaforge-logo-mark-light.svg`：独立标志源。
- `areaforge-logo-mark-mono-dark.svg` / `areaforge-logo-mark-mono-light.svg`：透明底单色标志源。
- `areaforge-logo-symbol-dark.svg` / `areaforge-logo-symbol-light.svg`：无底板彩色核心 Symbol，分别使用深色墨线和浅色墨线。
- `areaforge-logo-lockup.svg`：默认横向 Logo 源。
- `areaforge-logo-lockup-dark.svg` / `areaforge-logo-lockup-light.svg`：深色和浅色背景横向 Logo 源。
- `areaforge-logo-lockup-outlined*.svg`：横向 Logo 文字转路径版本，不依赖客户端字体。
- `areaforge-logo-lockup-mono-dark.svg` / `areaforge-logo-lockup-mono-light.svg`：单色横向 Logo 源。
- `areaforge-wordmark-dark.svg` / `areaforge-wordmark-light.svg`：不带图标的纯字标源。
- `areaforge-logo-stacked-dark.svg` / `areaforge-logo-stacked-light.svg`：竖向堆叠 Logo 源。
- `app-icon/`：常规 App icon PNG 为 `16/32/48/64/128/180/192/256/512/1024` 深浅两套，并包含 opaque `180/1024` 与 maskable `192/512` 导出。
- `mark/`：标志 PNG 导出，尺寸为 `256/512/1024`，深浅和单色版本。
- `symbol/`：透明底彩色核心 Symbol PNG，尺寸为 `256/512/1024`。
- `lockup/`：横向 Logo PNG 导出，包含彩色、轮廓化和单色版本，尺寸为 `1600x520`。
- `wordmark/`：纯字标深浅背景 PNG，尺寸为 `1200x336`。
- `stacked/`：竖向堆叠 Logo 深浅背景 PNG，尺寸为 `1024x1024`。
- `favicon/`：`16/32/48` PNG 与多尺寸 `areaforge-favicon.ico`。
- `social/`：社交分享预览图，包含显式 `light/dark` SVG 和 `1200x630` PNG；无后缀文件保留为浅色兼容入口。
- `areaforge-brand-overview.png`：完整数字品牌素材总览图。

## 使用边界

- 深浅色版本应保持同一图案和结构，只做配色与对比适配。
- `AreaForge` 横向字标中，`Area` 使用深色或深色背景反白，`Forge` 使用青绿到琥珀/橙的强调色。
- 16px、32px 和 48px 使用 small 源文件，避免完整图标细节在 favicon 尺寸糊成一团。
- 常规 App icon 保留透明圆角；opaque 和 maskable 图标必须保持全画布不透明，不能替换成常规透明版。
- `lockup/wordmark/stacked` 的 `dark/light` 表示目标背景；`mono/symbol` 的 `dark/light` 表示墨线明暗。
- 对外分发或跨环境直接使用 SVG 时优先选 `outlined` 横向 Logo，避免字体替换导致字标变化。
- 社交预览图的深浅版本保持相同尺寸、排版、文案和轨迹，仅适配背景与前景对比。
- 若后续接入 Web favicon、PWA manifest、登录页、README 封面或产品 UI，需要作为运行时/UI 变更单独验证，并按 `docs/development/validation-matrix.md` 选择检查。
