#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Inspect the actual Chromium bundle; this does not replace native UI acceptance."""

import argparse
import hashlib
import json
import os
import plistlib
import re
import subprocess
from pathlib import Path


def read_plist(path):
    try:
        return plistlib.loads(path.read_bytes())
    except plistlib.InvalidFileException:
        # Localized .strings files can be old-style property lists.
        data = subprocess.check_output(
            ["plutil", "-convert", "xml1", "-o", "-", str(path)],
            stderr=subprocess.PIPE,
        )
        return plistlib.loads(data)


def discover_theme(app):
    for parent in Path(app).resolve().parents:
        theme = parent / "chrome/app/theme/chromium/mac"
        if theme.is_dir():
            return theme
    return None


def inspect_bundle(app, theme_dir):
    app, theme_dir = Path(app), Path(theme_dir)
    errors = []
    try:
        manifest = json.loads((theme_dir / "pibrowse-brand.json").read_text())
        if manifest.get("product") != "PiBrowse":
            errors.append("theme manifest does not identify PiBrowse")
        if manifest.get("icon_style") != "chromium-numbered":
            errors.append("theme manifest icon_style must retain the approved Chromium numbered Dock base")
        if not re.fullmatch(r"[0-9a-f]{40}", str(manifest.get("source_revision", ""))):
            errors.append("theme manifest lacks the upstream source revision")
        for name in ("app.icns", "Assets.car"):
            source = theme_dir / name
            if (not source.is_file() or manifest.get("generated", {}).get(name)
                    != hashlib.sha256(source.read_bytes()).hexdigest()):
                errors.append(f"theme manifest does not approve the current {name}")
    except (OSError, ValueError, TypeError):
        errors.append("missing or invalid PiBrowse theme manifest")
    if app.name != "PiBrowse.app":
        errors.append(f"bundle name is {app.name!r}, expected PiBrowse.app")

    helpers = [p for p in app.rglob("*.app") if "Helper" in p.name]
    if not helpers:
        errors.append("no embedded browser Helper bundles found")
    bundle_metadata = {}
    for bundle in [app] + helpers:
        if bundle != app and not bundle.stem.startswith("PiBrowse Helper"):
            errors.append(f"old helper name: {bundle}")
        try:
            info = read_plist(bundle / "Contents/Info.plist")
        except (OSError, ValueError, subprocess.CalledProcessError) as exc:
            errors.append(f"cannot read {bundle}/Contents/Info.plist: {exc}")
            continue
        bundle_metadata[bundle] = info
        expected = bundle.stem
        for key in ("CFBundleName", "CFBundleDisplayName", "CFBundleExecutable"):
            value = info.get(key, info.get("CFBundleName") if key == "CFBundleDisplayName" else None)
            if value != expected:
                errors.append(f"{bundle.name} {key}={value!r}, expected {expected!r}")
        identifier = info.get("CFBundleIdentifier", "")
        valid_id = identifier == "dev.fury.core" if bundle == app else identifier.startswith("dev.fury.core.")
        if not valid_id:
            errors.append(f"{bundle.name} CFBundleIdentifier={identifier!r} is not the compatible core identity")
        executable = bundle / "Contents/MacOS" / str(info.get("CFBundleExecutable", ""))
        if not executable.is_file() or not os.access(executable, os.X_OK):
            errors.append(f"missing executable: {executable}")

    # A correct main Info.plist can be overridden by old localized labels.
    for strings in app.rglob("InfoPlist.strings"):
        try:
            values = read_plist(strings)
        except (OSError, ValueError, subprocess.CalledProcessError) as exc:
            errors.append(f"cannot read localized strings {strings}: {exc}")
            continue
        for key in ("CFBundleName", "CFBundleDisplayName", "CFBundleGetInfoString"):
            if key not in values:
                continue
            label = str(values[key])
            if key == "CFBundleGetInfoString":
                # Chromium 157 infoplist_strings_util.cc formats "%s %s, %s"
                # from product, version and the SAME localized copyright also
                # stored in NSHumanReadableCopyright. Match that whole template;
                # translated author names may legitimately contain Chromium.
                owner = next((p for p in strings.parents if p.suffix == ".app"), None)
                metadata = bundle_metadata.get(owner, {})
                version = metadata.get("CFBundleShortVersionString")
                copyright = values.get("NSHumanReadableCopyright")
                expected_info = f"{metadata.get('CFBundleName')} {version}, {copyright}"
                if (not isinstance(version, str)
                        or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,3}", version)
                        or not isinstance(copyright, str) or not copyright.strip()
                        or label != expected_info):
                    errors.append(f"invalid localized product/version/copyright template in {strings}: "
                                  f"{key}={values[key]!r}")
                continue
            # Unicode word boundaries miss brands next to Japanese/Korean text.
            if re.search(r"Fury|Chromium", label, re.I):
                errors.append(f"old localized product label in {strings}: {key}={values[key]!r}")

    frameworks = list((app / "Contents/Frameworks").glob("*.framework"))
    if not frameworks or any(p.name != "PiBrowse Framework.framework" for p in frameworks):
        errors.append(f"unexpected framework names: {[p.name for p in frameworks]}")

    for name in ("app.icns", "Assets.car"):
        expected = theme_dir / name
        actual = app / "Contents/Resources" / name
        if not expected.is_file() or not actual.is_file():
            errors.append(f"missing approved or bundled {name}")
        elif hashlib.sha256(expected.read_bytes()).digest() != hashlib.sha256(actual.read_bytes()).digest():
            errors.append(f"bundled {name} differs from approved original Chromium Dock theme")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--theme-dir", type=Path)
    args = parser.parse_args()
    theme = args.theme_dir or discover_theme(args.app)
    if theme is None:
        parser.error("provide --theme-dir with the approved generated macOS theme")
    errors = inspect_bundle(args.app, theme)
    for error in errors:
        print(f"FAIL: {error}")
    if errors:
        return 1
    print("PASS: PiBrowse metadata/labels, compatible identities and approved Chromium numbered Dock base")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
