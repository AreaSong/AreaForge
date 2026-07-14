# AreaForge Native Icons

本目录保存从品牌 opaque icon 和透明 Symbol 生成的原生平台交付文件。

- `macos/AreaForge.icns`：直接设置为 macOS 应用图标；`.iconset` 保留 Xcode 和重新打包所需的源尺寸。
- `ios/AreaForgeAppIcon.appiconset/`：复制到 Xcode asset catalog，包含 iPhone、iPad 与 App Store marketing 槽位。
- `android/res/`：把目录内容合并到 Android 工程 `app/src/main/res/`；`ic_launcher.xml` 和 `ic_launcher_round.xml` 使用同一安全区前景。
- `windows/AreaForge.ico`：包含 `16/24/32/48/64/128/256`，用于 Windows 可执行文件和快捷方式。

这些文件由 `pnpm brand:export` 补齐或同步。修改品牌源文件后使用 `pnpm brand:export -- --refresh` 重建，并运行 `pnpm brand:validate`。
