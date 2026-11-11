# PiBrowse brand assets

PiBrowse uses a blue pi symbol and wordmark. The current README assets are
`pibrowse-logo.png` and `pibrowse-logo-dark.png` where present; `logo.png` and
`logo-dark.png` remain supported asset filenames. The square `icon.png` is the
controller icon source; `icon-browser.png` supplies the browser-internal marks.

Run `assets/generate.sh` to regenerate `desktop/src-tauri/icons/*` and
`core/branding/` from the current sources. These filenames are build interfaces,
not product names.

The controller and core product names show PiBrowse. Page-visible browser
properties — User-Agent, `navigator.appName`, `navigator.vendor` and Sec-CH-UA —
continue to describe Chrome, as required by the fingerprint configuration.

## macOS 内核 Dock 图标

内核 Dock 使用上游原 Chromium 图标，由运行时代码叠加 01、02、03 序号。构建脚本从 Chromium 的 Git HEAD 保留原生 ICNS、Assets.car 和图标目录；PiBrowse 图标和词标用于控制端及浏览器内页。版权和兼容标识保持不变。

## 浏览器内部矢量标记

`pibrowse-product-glyph.svg` 从批准的 `icon-browser.png` 白色字形机械提取，保留 p 孔和 i 点；来源及校验值记录在 `pibrowse-product-glyph.source.json`。运行 `python3 assets/generate-product-glyph.py --check` 可验证与源图白色 mask 逐像素一致。

Chromium 的 `0908` 补丁将这套字形应用到内页导航、暗色标题和原生产品标记。原有资源 ID 保留；安全锁、警告图形、Google 等第三方标志和原生 Dock 图标不变。生成器的 `--chromium-source`、`--patch` 和 `--staging-dir` 参数可从未应用 `0908` 的源码重生补丁，先在暂存目录验证。
