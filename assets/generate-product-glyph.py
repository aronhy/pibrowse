#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Trace the approved PiBrowse raster mark; never draw or substitute a font.

Requires the Pillow already used by assets/generate.sh. No tracing executable,
font, network access, curve fitting, or optional scientific package is used.

  python3 assets/generate-product-glyph.py --check
  python3 assets/generate-product-glyph.py --output-dir /tmp/pi-glyph
  python3 assets/generate-product-glyph.py --chromium-source /path/to/src \
      --patch /tmp/0908.patch --staging-dir /tmp/pi-chromium

The source's white pixels become directed pixel-boundary loops. Only exactly
collinear edges are removed. The counterclockwise p hole and the separate i dot
are retained in a single nonzero path. A scanline round trip must reproduce the
threshold mask exactly before any output is written.
"""
from __future__ import annotations

import argparse
from collections import deque
import difflib
import hashlib
import json
import math
from pathlib import Path
import re

from PIL import Image

APPROVED_SHA256 = "dec6a88aa1eef31f45bd74eb011216d4da1b901c969029e33bfaeaa6aba1fc43"
ICON_FILES = (
    "components/omnibox/browser/vector_icons/chrome_product.icon",
    "components/omnibox/browser/vector_icons/product_chrome_refresh_old.icon",
    "components/omnibox/browser/vector_icons/product_old.icon",
    "components/vector_icons/chromium/product.icon",
    "components/vector_icons/chromium/product_refresh.icon",
    "chrome/app/vector_icons/chrome_product.icon",
    "chrome/app/vector_icons/browser_logo_old.icon",
)
WEB_ICON_FILES = (
    ("ui/webui/resources/cr_elements/icons.html.ts", 24),
    ("chrome/browser/resources/settings/icons.html.ts", 20),
)
DARK_FILE = "ui/webui/resources/images/chrome_logo_dark.svg"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def components(mask: bytearray, width: int, height: int) -> list[list[int]]:
    seen = bytearray(len(mask))
    groups = []
    for start, white in enumerate(mask):
        if not white or seen[start]:
            continue
        queue = deque([start])
        seen[start] = 1
        group = []
        while queue:
            index = queue.popleft()
            group.append(index)
            x, y = index % width, index // width
            for xx, yy in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= xx < width and 0 <= yy < height:
                    neighbor = yy * width + xx
                    if mask[neighbor] and not seen[neighbor]:
                        seen[neighbor] = 1
                        queue.append(neighbor)
        groups.append(group)
    return sorted(groups, key=len, reverse=True)


def bounds(points: list[tuple[int, int]]) -> list[int]:
    xs, ys = zip(*points)
    return [min(xs), min(ys), max(xs) + 1, max(ys) + 1]


def contour(mask: bytearray, width: int, height: int) -> list[list[tuple[int, int]]]:
    # Orient each boundary with white on its right in screen coordinates.
    # Thus the p hole winds opposite the outer p, and NONZERO retains the hole.
    edges = {}
    for index, white in enumerate(mask):
        if not white:
            continue
        x, y = index % width, index // width
        sides = (
            (y == 0 or not mask[index - width], (x, y), (x + 1, y)),
            (x == width - 1 or not mask[index + 1], (x + 1, y), (x + 1, y + 1)),
            (y == height - 1 or not mask[index + width], (x + 1, y + 1), (x, y + 1)),
            (x == 0 or not mask[index - 1], (x, y + 1), (x, y)),
        )
        for exposed, start, end in sides:
            if exposed:
                if start in edges:
                    raise ValueError("Ambiguous diagonal boundary; review the approved source")
                edges[start] = end
    loops = []
    while edges:
        start = min(edges)
        point = start
        loop = []
        while True:
            loop.append(point)
            point = edges.pop(point)
            if point == start:
                break
        # Remove only collinear intermediate pixel vertices, with zero error.
        simplified = []
        for i, point in enumerate(loop):
            before, after = loop[i - 1], loop[(i + 1) % len(loop)]
            if (point[0] - before[0]) * (after[1] - point[1]) != (
                    point[1] - before[1]) * (after[0] - point[0]):
                simplified.append(point)
        loops.append(simplified)
    return sorted(loops, key=lambda loop: (-abs(signed_area(loop)), min(loop)))


def signed_area(loop):
    return sum(x * yy - xx * y for (x, y), (xx, yy) in
               zip(loop, loop[1:] + loop[:1])) / 2


def rasterize_nonzero(loops, width, height):
    # Independent scanline fill checks the directed outline, including its hole.
    output = bytearray(width * height)
    for y in range(height):
        center = y + 0.5
        events = []
        for loop in loops:
            for (x1, y1), (x2, y2) in zip(loop, loop[1:] + loop[:1]):
                if min(y1, y2) <= center < max(y1, y2):
                    x = x1 + (center - y1) * (x2 - x1) / (y2 - y1)
                    events.append((x, 1 if y2 > y1 else -1))
        winding, previous = 0, 0
        for x, delta in sorted(events):
            if winding:
                left = max(0, math.ceil(previous - 0.5))
                right = min(width, math.ceil(x - 0.5))
                output[y * width + left:y * width + right] = b"\x01" * (right - left)
            winding += delta
            previous = x
        if winding:
            raise ValueError("Unclosed path in scanline round trip")
    return output


def normalized(loops, box, canvas):
    # Crop only empty tile surroundings, retain glyph aspect ratio and spacing.
    # Use the same proportional 1/12 inset for every native/WebUI canvas.
    x1, y1, x2, y2 = box
    scale = canvas * (5 / 6) / max(x2 - x1, y2 - y1)
    dx = (canvas - (x2 - x1) * scale) / 2 - x1 * scale
    dy = (canvas - (y2 - y1) * scale) / 2 - y1 * scale
    return [[(round(x * scale + dx, 6), round(y * scale + dy, 6))
             for x, y in loop] for loop in loops]


def number(value):
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def svg_path(loops):
    return " ".join("M " + " L ".join(f"{number(x)} {number(y)}" for x, y in loop) +
                    " Z" for loop in loops)


def svg(loops, canvas=24, color="currentColor"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{canvas}" height="{canvas}" '
            f'viewBox="0 0 {canvas} {canvas}"><path fill="{color}" '
            f'fill-rule="nonzero" d="{svg_path(loops)}"/></svg>\n')


def native_icon(original, loops, box):
    canvases = [int(x) for x in re.findall(r"CANVAS_DIMENSIONS,\s*(\d+)", original)]
    if not canvases:
        raise ValueError("Missing native vector canvas")
    header = original[:original.index("CANVAS_DIMENSIONS")]
    body = []
    for canvas in canvases:
        body += [f"CANVAS_DIMENSIONS, {canvas},", "FILL_RULE_NONZERO,"]
        # All four loops stay in one path. NEW_PATH before the hole would fill it.
        for loop in normalized(loops, box, canvas):
            for i, (x, y) in enumerate(loop):
                command = "MOVE_TO" if i == 0 else "LINE_TO"
                body.append(f"{command}, {x:.6f}f, {y:.6f}f,")
            body.append("CLOSE,")
        body.append("")
    return header + "\n".join(body), canvases


def make_patch(source, staging, loops, box, patch_path):
    replacements, canvases = {}, {}
    for relative in ICON_FILES:
        original = (source / relative).read_text()
        newer, sizes = native_icon(original, loops, box)
        replacements[relative] = newer
        canvases[relative] = sizes
    group_pattern = re.compile(r'<g id="chrome-product"[^>]*>.*?</g>', re.S)
    for relative, canvas in WEB_ICON_FILES:
        original = (source / relative).read_text()
        group = (f'<g id="chrome-product" viewBox="0 0 {canvas} {canvas}">'
                 f'<path fill-rule="nonzero" d="{svg_path(normalized(loops, box, canvas))}">'
                 '</path></g>')
        newer, count = group_pattern.subn(group, original)
        if count != 2:
            raise ValueError(f"Expected both rounded/legacy icon groups: {relative}: {count}")
        replacements[relative] = newer
    # External SVG <img> cannot inherit the parent document's currentColor.
    # Keep the original dark asset's white paint, with the same traced geometry.
    replacements[DARK_FILE] = svg(normalized(loops, box, 24), color="#fff")
    patch, records = [], []
    for relative, newer in replacements.items():
        original_bytes = (source / relative).read_bytes()
        original = original_bytes.decode()
        destination = staging / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(newer)
        records.append({"file": relative, "base_sha256": sha(original_bytes),
                        "post_sha256": sha(newer.encode())})
        if original == newer:
            continue
        patch.append(f"diff --git a/{relative} b/{relative}\n")
        for line in difflib.unified_diff(original.splitlines(keepends=True),
                                        newer.splitlines(keepends=True),
                                        fromfile="a/" + relative, tofile="b/" + relative):
            patch.append(line if line.endswith("\n") else line +
                         "\n\\ No newline at end of file\n")
    patch_path.parent.mkdir(parents=True, exist_ok=True)
    patch_path.write_text("".join(patch))
    for record in records:
        if sha((source / record["file"]).read_bytes()) != record["base_sha256"]:
            raise ValueError("Source changed while generating the patch")
    return {"files": records, "native_canvases": canvases,
            "native_representations": sum(len(c) for c in canvases.values()),
            "webui_groups": 4, "patch_sha256": sha(patch_path.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path,
                        default=Path(__file__).resolve().parent / "icon-browser.png")
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parent)
    parser.add_argument("--check", action="store_true", help="Check canonical assets without writing")
    parser.add_argument("--chromium-source", type=Path)
    parser.add_argument("--staging-dir", type=Path)
    parser.add_argument("--patch", type=Path)
    args = parser.parse_args()
    source_bytes = args.source.read_bytes()
    if sha(source_bytes) != APPROVED_SHA256:
        raise ValueError("Source is not the approved icon-browser.png; review it before updating the hash")
    image = Image.open(args.source).convert("RGBA")
    width, height = image.size
    pixels = image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
    mask = bytearray(int(a >= 128 and min(r, g, b) >= 240 and
                         max(r, g, b) - min(r, g, b) <= 12)
                     for r, g, b, a in pixels)
    groups, retained, rejected = components(mask, width, height), [], []
    for group in groups:
        box = bounds([(i % width, i // width) for i in group])
        keep = (len(group) >= max(64, width * height // 2000) and
                box[0] >= width / 10 and box[1] >= height / 10 and
                box[2] <= width * 9 / 10 and box[3] <= height * 9 / 10)
        record = {"pixels": len(group), "bbox": box}
        if keep:
            retained.append(record)
        else:
            rejected.append(record)
            for index in group:
                mask[index] = 0
    if len(retained) != 3:
        raise ValueError("Expected the approved p, i stem and i dot components")
    loops = contour(mask, width, height)
    areas = [signed_area(loop) for loop in loops]
    if len(loops) != 4 or sum(area < 0 for area in areas) != 1:
        raise ValueError("Expected three outer boundaries and the p hole")
    roundtrip = rasterize_nonzero(loops, width, height)
    if roundtrip != mask or sum(areas) != sum(mask):
        raise ValueError("Pixel contour did not exactly reconstruct the approved white glyph")
    box = bounds([(i % width, i // width) for i, value in enumerate(mask) if value])
    master_svg = svg(normalized(loops, box, 24))
    record = {
        "source": "assets/icon-browser.png", "source_sha256": APPROVED_SHA256,
        "source_size": [width, height],
        "selection": {"alpha_min": 128, "rgb_min": 240, "chroma_max": 12,
                      "connectivity": 4, "min_component_pixels": max(64, width * height // 2000),
                      "reject_outer_canvas_fraction": 0.1},
        "derivation": "directed pixel boundaries; remove exactly collinear vertices only; no fitting, font or hand-drawn coordinates",
        "layout": "crop glyph bbox; retain aspect/relative spacing; center with proportional 1/12 canvas inset",
        "retained_components": retained, "rejected_components": rejected,
        "glyph_bbox": box, "mask_pixels": sum(mask), "mask_sha256": sha(bytes(mask)),
        "contours": [{"vertices": len(loop), "signed_area": area}
                     for loop, area in zip(loops, areas)],
        "nonzero_fill_roundtrip_exact": True, "pixel_difference": 0,
        "foreground_components": 3, "holes": 1,
        "native_paint": "caller color; no PATH_COLOR_ARGB",
        "webui_paint": "inherited currentColor; external dark SVG remains #fff",
        "master_svg_sha256": sha(master_svg.encode()),
    }
    generated = {"pibrowse-product-glyph.svg": master_svg,
                 "pibrowse-product-glyph.source.json": json.dumps(record, indent=2) + "\n"}
    for name, text in generated.items():
        path = args.output_dir / name
        if args.check:
            if path.read_text() != text:
                raise ValueError(f"Generated asset differs: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
    if args.patch:
        if args.check or not args.chromium_source or not args.staging_dir:
            parser.error("--patch requires --chromium-source and --staging-dir without --check")
        manifest = make_patch(args.chromium_source, args.staging_dir, loops, box, args.patch)
        (args.staging_dir / "0908-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps(manifest, indent=2))
    print(json.dumps({"source_sha256": APPROVED_SHA256, "mask_pixels": sum(mask),
                      "components": len(retained), "loops": len(loops),
                      "vertices": sum(map(len, loops)), "pixel_difference": 0,
                      "master_svg_sha256": sha(master_svg.encode())}))


if __name__ == "__main__":
    main()
