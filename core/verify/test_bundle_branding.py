# SPDX-License-Identifier: AGPL-3.0-or-later

import importlib.util
import hashlib
import json
import plistlib
import tempfile
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "bundle_branding", Path(__file__).with_name("bundle_branding.py")
)
branding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(branding)


class BundleBrandingAcceptance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pibrowse-brand-gate-")
        self.root = Path(self.tmp.name)
        self.app = self.root / "PiBrowse.app"
        self.theme = self.root / "theme"
        self.theme.mkdir()
        for name in ("app.icns", "Assets.car"):
            (self.theme / name).write_bytes(b"approved-native-chromium-" + name.encode())
        (self.theme / "pibrowse-brand.json").write_text(json.dumps({
            "product": "PiBrowse",
            "icon_style": "chromium-numbered",
            "source_revision": "0" * 40,
            "generated": {name: hashlib.sha256((self.theme / name).read_bytes()).hexdigest()
                          for name in ("app.icns", "Assets.car")},
        }))
        self.make_bundle(self.app, "PiBrowse", "dev.fury.core")
        resources = self.app / "Contents/Resources"
        resources.mkdir()
        for name in ("app.icns", "Assets.car"):
            (resources / name).write_bytes((self.theme / name).read_bytes())
        framework = self.app / "Contents/Frameworks/PiBrowse Framework.framework"
        self.helper = framework / "Versions/A/Helpers/PiBrowse Helper.app"
        self.make_bundle(self.helper, "PiBrowse Helper", "dev.fury.core.helper")

    def tearDown(self):
        self.tmp.cleanup()

    def make_bundle(self, app, name, identifier):
        contents = app / "Contents"
        contents.mkdir(parents=True)
        with (contents / "Info.plist").open("wb") as f:
            plistlib.dump({"CFBundleName": name, "CFBundleDisplayName": name,
                          "CFBundleExecutable": name,
                          "CFBundleShortVersionString": "157.0.8103.39",
                          "CFBundleIdentifier": identifier}, f)
        exe = contents / "MacOS" / name
        exe.parent.mkdir()
        exe.write_bytes(b"test executable")
        exe.chmod(0o755)

    def localized(self, product, copyright="Copyright The Fury Authors"):
        locale = self.app / "Contents/Resources/zh_CN.lproj"
        locale.mkdir(exist_ok=True)
        with (locale / "InfoPlist.strings").open("wb") as f:
            plistlib.dump({"CFBundleGetInfoString": product,
                          "NSHumanReadableCopyright": copyright}, f)

    def test_localized_copyright_is_not_an_old_product_label(self):
        # Exact output from Chromium 157's compiled el/fa InfoPlist.strings.
        copyrights = (
            "Πνευματικά δικαιώματα 2026 Οι συντάκτες του Chromium. Με επιφύλαξη παντός δικαιώματος.",
            "\u200fحق نشر 2026 نویسندگان Chromium. کلیه حقوق محفوظ است.",
        )
        for copyright in copyrights:
            with self.subTest(copyright=copyright):
                self.localized(f"PiBrowse 157.0.8103.39, {copyright}", copyright)
                self.assertEqual(branding.inspect_bundle(self.app, self.theme), [])

    def test_old_product_before_localized_copyright_is_still_rejected(self):
        copyrights = (
            "Πνευματικά δικαιώματα 2026 Οι συντάκτες του Chromium. Με επιφύλαξη παντός δικαιώματος.",
            "\u200fحق نشر 2026 نویسندگان Chromium. کلیه حقوق محفوظ است.",
        )
        for copyright in copyrights:
            for name in ("Fury", "Chromium", "このFuryについて"):
                with self.subTest(product=name, copyright=copyright):
                    self.localized(f"{name} 157.0.8103.39, {copyright}", copyright)
                    self.assertTrue(any("localized" in x for x in
                                        branding.inspect_bundle(self.app, self.theme)))

    def test_copyright_exemption_does_not_hide_an_unmatched_trailing_label(self):
        self.localized("PiBrowse 157.0.8103.39, Copyright The Fury Authors, Fury browser")
        self.assertTrue(any("localized" in x for x in
                            branding.inspect_bundle(self.app, self.theme)))

    def test_get_info_string_must_use_the_owning_bundle_version(self):
        self.localized("PiBrowse 155.0.8059.39, Copyright The Fury Authors")
        self.assertTrue(any("localized" in x for x in
                            branding.inspect_bundle(self.app, self.theme)))

    def test_new_name_keeps_original_author_and_compatible_bundle_id(self):
        self.localized("PiBrowse 157.0.8103.39, Copyright The Fury Authors")
        self.assertEqual(branding.inspect_bundle(self.app, self.theme), [])

    def test_localized_old_product_is_rejected_despite_correct_main_plist(self):
        self.localized("Fury 157.0.8103.39, Copyright The Fury Authors")
        self.assertTrue(any("localized" in x for x in
                            branding.inspect_bundle(self.app, self.theme)))

    def test_non_ascii_adjacent_old_product_is_rejected(self):
        self.localized("このFuryについて、Copyright The Fury Authors")
        self.assertTrue(any("localized" in x for x in
                            branding.inspect_bundle(self.app, self.theme)))

    def test_stale_asset_catalogue_is_rejected_despite_new_icns(self):
        (self.app / "Contents/Resources/Assets.car").write_bytes(b"old flame")
        self.assertTrue(any("Assets.car" in x for x in
                            branding.inspect_bundle(self.app, self.theme)))

    def test_unmarked_stock_theme_cannot_approve_itself(self):
        (self.theme / "pibrowse-brand.json").unlink()
        self.assertTrue(any("manifest" in x for x in
                            branding.inspect_bundle(self.app, self.theme)))

    def test_native_dock_policy_cannot_silently_be_replaced_by_pi(self):
        path = self.theme / "pibrowse-brand.json"
        manifest = json.loads(path.read_text())
        manifest["icon_style"] = "pibrowse"
        path.write_text(json.dumps(manifest))
        self.assertTrue(any("icon_style" in x for x in
                            branding.inspect_bundle(self.app, self.theme)))

    def test_old_helper_display_name_and_shell_identifier_are_rejected(self):
        info_path = self.helper / "Contents/Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        info["CFBundleDisplayName"] = "Fury Helper"
        info_path.write_bytes(plistlib.dumps(info))
        main_path = self.app / "Contents/Info.plist"
        main_info = plistlib.loads(main_path.read_bytes())
        main_info["CFBundleIdentifier"] = "dev.fury.desktop"
        main_path.write_bytes(plistlib.dumps(main_info))
        problems = branding.inspect_bundle(self.app, self.theme)
        self.assertTrue(any("CFBundleDisplayName" in x for x in problems))
        self.assertTrue(any("CFBundleIdentifier" in x for x in problems))


if __name__ == "__main__":
    unittest.main()
