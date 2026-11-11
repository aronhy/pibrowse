#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 Bogdan Shapovalov and the Fury authors
"""Resize approved PiBrowse artwork into Chromium's internal logo canvases."""

import argparse
import base64
import re
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image, ImageOps


def artwork(path, crop=False):
    image = Image.open(path).convert("RGBA")
    if crop:
        bounds = image.getbbox()
        if bounds is None:
            raise ValueError(f"No visible artwork in {path}")
        image = image.crop(bounds)
    return image


def render(image, size):
    resized = ImageOps.contain(image, size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size)
    canvas.alpha_composite(resized, ((size[0] - resized.width) // 2,
                                   (size[1] - resized.height) // 2))
    return canvas


def replace_svg(path, png):
    original = ET.parse(path).getroot()
    view_box = original.get("viewBox")
    if view_box:
        x, y, width, height = map(float, re.split(r"[\s,]+", view_box.strip()))
    else:
        x = y = 0
        width = float(original.get("width", "").removesuffix("px"))
        height = float(original.get("height", "").removesuffix("px"))
        view_box = f"0 0 {width:g} {height:g}"
    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid SVG canvas in {path}")
    namespace = "http://www.w3.org/2000/svg"
    ET.register_namespace("", namespace)
    attributes = {"viewBox": view_box}
    for key in ("width", "height"):
        if original.get(key):
            attributes[key] = original.get(key)
    root = ET.Element(f"{{{namespace}}}svg", attributes)
    ET.SubElement(root, f"{{{namespace}}}image", {
        "x": f"{x:g}", "y": f"{y:g}",
        "width": f"{width:g}", "height": f"{height:g}",
        "preserveAspectRatio": "xMidYMid meet",
        "href": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
    })
    path.write_bytes(ET.tostring(root, encoding="utf-8") + b"\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--theme", required=True, type=Path)
    parser.add_argument("--components-resources", type=Path)
    parser.add_argument("--icon", required=True, type=Path)
    parser.add_argument("--wordmark", required=True, type=Path)
    parser.add_argument("--wordmark-white", required=True, type=Path)
    args = parser.parse_args()
    if not args.theme.is_dir():
        parser.error(f"Missing Chromium theme: {args.theme}")
    icon = artwork(args.icon)
    wordmark = artwork(args.wordmark, crop=True)
    wordmark_white = artwork(args.wordmark_white, crop=True)
    resources = []
    component_wordmarks = set()
    for path in sorted(args.theme.rglob("*")):
        relative = path.relative_to(args.theme)
        name = path.stem.lower()
        if (path.is_file() and "chromium" in relative.parts
                and relative.parts[:2] != ("chromium", "mac")
                and (name.startswith("product_logo") or "wordmark" in name)
                and path.suffix.lower() in {".png", ".svg"}):
            resources.append(path)
    if args.components_resources:
        # chrome://version uses IDR_PRODUCT_LOGO{,_WHITE} from components,
        # separately from chrome/app/theme's square current-channel logos.
        for scale in (100, 200):
            for filename in ("product_logo.png", "product_logo_white.png",
                             "favicon_product.png"):
                path = (args.components_resources / f"default_{scale}_percent"
                        / "chromium" / filename)
                if not path.is_file():
                    parser.error(f"Missing components product image: {path}")
                if filename.startswith("product_logo"):
                    component_wordmarks.add(path)
                resources.append(path)
    if not resources:
        parser.error("No Chromium brand resources found")
    for path in resources:
        name = path.stem.lower()
        is_wordmark = (path in component_wordmarks
                       or "wordmark" in name or "logo_name" in name)
        source = (wordmark_white if "white" in name else wordmark) if is_wordmark else icon
        if path.suffix.lower() == ".svg":
            # SVGs keep their canvas and embed the approved PNG without redrawing it.
            source_path = ((args.wordmark_white if "white" in name else args.wordmark)
                           if is_wordmark else args.icon)
            replace_svg(path, source_path.read_bytes())
        else:
            with Image.open(path) as original:
                size = original.size
            render(source, size).save(path)
    print(f"    {len(resources)} brand resources replaced; original canvases retained")


if __name__ == "__main__":
    main()
