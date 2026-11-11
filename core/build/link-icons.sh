#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 Bogdan Shapovalov and the Fury authors
#
# Keep Chromium native/Dock icons; put approved PiBrowse artwork inside the browser.
# build.sh calls this before macOS builds. FURY_CHROMIUM_SRC can select an
# existing checkout without moving its incremental build output.
set -euo pipefail

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$CORE_DIR/.." && pwd)"
SRC="${FURY_CHROMIUM_SRC:-$CORE_DIR/src}"
THEME="$SRC/chrome/app/theme"
COMPONENTS="$SRC/components/resources"
ICON="$ROOT/assets/icon-browser.png"
[ -f "$ICON" ] || ICON="$ROOT/assets/icon.png"
WORDMARK="$ROOT/assets/pibrowse-logo.png"
WORDMARK_WHITE="$ROOT/assets/pibrowse-logo-dark.png"
[ -f "$WORDMARK" ] || WORDMARK="$ROOT/assets/logo.png"
[ -f "$WORDMARK_WHITE" ] || WORDMARK_WHITE="$ROOT/assets/logo-dark.png"

[ -d "$THEME/chromium/mac/Assets.xcassets" ] || {
    echo "!! No Chromium macOS theme at $THEME. Run fetch.sh first." >&2
    exit 1
}
for artwork in "$ICON" "$WORDMARK" "$WORDMARK_WHITE"; do
    [ -f "$artwork" ] || { echo "!! Approved brand artwork is missing: $artwork" >&2; exit 1; }
done
# The native/Dock base is Chromium's original artwork; the running profile adds
# its number. Restore those bytes from this checkout's Git HEAD, never from a
# working tree that an earlier PiBrowse/Fury icon script may have overwritten.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$THEME" "$STAGE/theme"
for scale in 100 200; do
    relative="default_${scale}_percent/chromium"
    mkdir -p "$STAGE/components-resources/$relative"
    for name in product_logo.png product_logo_white.png favicon_product.png; do
        [ -f "$COMPONENTS/$relative/$name" ] || {
            echo "!! Missing version-page product image: $COMPONENTS/$relative/$name" >&2
            exit 1
        }
        cp "$COMPONENTS/$relative/$name" "$STAGE/components-resources/$relative/$name"
    done
done

echo "==> upstream Chromium native/Dock icon base"
python3 - "$SRC" "$STAGE/theme" "$ICON" <<'PY_NATIVE'
import hashlib
import json
import pathlib
import subprocess
import sys

src, theme, icon = map(pathlib.Path, sys.argv[1:])
src = src.resolve()

def git(*args):
    return subprocess.check_output(["git", "-C", str(src), *args])

try:
    if pathlib.Path(git("rev-parse", "--show-toplevel").decode().strip()).resolve() != src:
        raise ValueError("Chromium source is not the root of its own Git checkout")
    revision = git("rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    native = "chrome/app/theme/chromium/mac/"
    catalogue = native + "Assets.xcassets/"
    required = {native + "app.icns", native + "Assets.car",
                catalogue + "Contents.json",
                catalogue + "AppIcon.appiconset/Contents.json"}
    tracked = git("ls-tree", "-r", "-z", "--name-only", revision, "--",
                  native + "app.icns", native + "Assets.car", catalogue)
    paths = [path.decode() for path in tracked.split(b"\0") if path]
    # Only the native app icons and their catalogue descriptions are restored;
    # other artwork, legal text and source changes remain outside this list.
    selected = []
    for path in paths:
        relative = path.removeprefix(catalogue)
        png = (relative.startswith("AppIcon.appiconset/appicon_")
               or relative.startswith("Icon.iconset/icon_")) and path.endswith(".png")
        if path in required or png:
            selected.append(path)
    if not required.issubset(selected) or not all(
            any(path.startswith(catalogue + folder) and path.endswith(".png")
                for path in selected)
            for folder in ("AppIcon.appiconset/", "Icon.iconset/")):
        raise ValueError("Git HEAD has no complete upstream macOS native icon baseline")
    for path in selected:
        data = git("cat-file", "blob", revision + ":" + path)
        if not data:
            raise ValueError("Empty upstream native resource: " + path)
        destination = theme / path.removeprefix("chrome/app/theme/")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    mac = theme / "chromium/mac"
    manifest = {
        "product": "PiBrowse",
        "icon_style": "chromium-numbered",
        "source_revision": revision,
        "source_icon_sha256": hashlib.sha256(icon.read_bytes()).hexdigest(),
        "generated": {
            name: hashlib.sha256((mac / name).read_bytes()).hexdigest()
            for name in ("app.icns", "Assets.car")
        },
    }
    (mac / "pibrowse-brand.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"    {len(selected)} native resources restored from {revision[:12]}")
except (subprocess.CalledProcessError, OSError, ValueError) as error:
    raise SystemExit(f"!! Cannot approve upstream Chromium native icons: {error}")
PY_NATIVE

echo "==> PiBrowse browser-internal product logos and wordmarks"
python3 "$CORE_DIR/build/brand-resources.py" \
    --theme "$STAGE/theme" --icon "$ICON" \
    --components-resources "$STAGE/components-resources" \
    --wordmark "$WORDMARK" --wordmark-white "$WORDMARK_WHITE"

# Install only after every format has been generated successfully. Comparing
# bytes also keeps unchanged resources from invalidating an incremental build.
python3 - "$STAGE/theme" "$THEME" "$STAGE/components-resources" "$COMPONENTS" <<'PY'
import pathlib
import shutil
import sys

paths = list(map(pathlib.Path, sys.argv[1:]))
changed = 0
for staged, target in zip(paths[::2], paths[1::2]):
    for source in sorted(staged.rglob("*")):
        if not source.is_file():
            continue
        destination = target / source.relative_to(staged)
        if not destination.exists() or source.read_bytes() != destination.read_bytes():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            changed += 1
print(f"    {changed} changed files installed")
PY

echo "==> PiBrowse brand resources ready ($THEME)"
