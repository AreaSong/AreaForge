# AreaForge Brand Assets

本目录保存 AreaForge 当前品牌素材包。它是仓库内设计素材，不是 Web runtime 资源入口；文件存在不代表线上版本、favicon、PWA manifest、登录页或首页已经使用这些素材。

## 目录

- `areaforge-app-icon-dark.svg` / `areaforge-app-icon-light.svg`：完整 App/PWA 图标源。
- `areaforge-app-icon-small-dark.svg` / `areaforge-app-icon-small-light.svg`：16px 和 32px 小尺寸同源简化图标源。
- `areaforge-logo-mark-dark.svg` / `areaforge-logo-mark-light.svg`：独立标志源。
- `areaforge-logo-mark-mono-dark.svg` / `areaforge-logo-mark-mono-light.svg`：透明底单色标志源。
- `areaforge-logo-lockup.svg`：默认横向 Logo 源。
- `areaforge-logo-lockup-dark.svg` / `areaforge-logo-lockup-light.svg`：深色和浅色背景横向 Logo 源。
- `app-icon/`：App icon PNG 导出，尺寸为 `16/32/64/128/256/512/1024`，深浅两套。
- `mark/`：标志 PNG 导出，尺寸为 `256/512/1024`，深浅和单色版本。
- `lockup/`：横向 Logo PNG 导出，尺寸为 `1600x520`。

## 使用边界

- 深浅色版本应保持同一图案和结构，只做配色与对比适配。
- `AreaForge` 横向字标中，`Area` 使用深色或深色背景反白，`Forge` 使用青绿到琥珀/橙的强调色。
- 16px 和 32px 使用 small 源文件，避免完整图标细节在 favicon 尺寸糊成一团。
- 若后续接入 Web favicon、PWA manifest、登录页、README 封面或产品 UI，需要作为运行时/UI 变更单独验证，并按 `docs/development/validation-matrix.md` 选择检查。
