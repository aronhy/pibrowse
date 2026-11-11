# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 Bogdan Shapovalov and the Fury authors
"""Validate the approved PiBrowse browser artwork without redrawing it.

The blue tile with a white pi is a source asset, separate from the light
desktop-controller tile. Keep this historical entry point for build scripts;
platform sizes are derived by generate.sh from the existing approved PNGs.
"""
import pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parent
source = root / "icon-browser.png"
with Image.open(source) as image:
    if image.size != (1024, 1024) or image.mode != "RGBA":
        raise SystemExit("assets/icon-browser.png must be the approved 1024×1024 RGBA PiBrowse source")
print("using approved browser artwork:", source)
