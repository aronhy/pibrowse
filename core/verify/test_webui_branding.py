# SPDX-License-Identifier: AGPL-3.0-or-later

import base64
import contextlib
import importlib.util
import io
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, PngImagePlugin


spec = importlib.util.spec_from_file_location(
    "webui_branding", Path(__file__).with_name("verify-0906.py")
)
branding = importlib.util.module_from_spec(spec)
spec.loader.exec_module(branding)


def png_bytes(color, size, *, reencoded=False):
    output = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    if reencoded:
        metadata.add_text("encoder", "runtime resource packaging")
    Image.new("RGBA", size, color).save(
        output, format="PNG", compress_level=0 if reencoded else 9,
        pnginfo=metadata,
    )
    return output.getvalue()


class RuntimeImageSession:
    def __init__(self, page, locale, responses):
        self.page, self.locale, self.responses = page, locale, responses
        self.session = "selected-webui-session"
        self.ws = RuntimeImageCDP(self)
        self.active_images = {}
        self.loaded_urls = []
        self.removed_images = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def js(self, expression, timeout=40000):
        if "new Image()" in expression:
            url = json.loads(re.search(r"const imageUrl = (.*?);", expression)[1])
            image_id = json.loads(re.search(r"const collectorId = (.*?);", expression)[1])
            self.active_images[image_id] = url
            self.loaded_urls.append(url)
            response = next(value for (page, _), value in self.responses.items()
                            if page == self.page and value.get("url") == url)
            if response.get("image_error"):
                return json.dumps({"error": response["image_error"]})
            return json.dumps({"source": response.get("image_source", url),
                               "width": 32, "height": 32})
        if "?.remove()" in expression:
            image_id = json.loads(re.search(r"getElementById\((.*?)\)", expression)[1])
            self.active_images.pop(image_id, None)
            self.removed_images.append(image_id)
            return None
        raise RuntimeError("Fetch API cannot load chrome://theme: URL scheme unsupported")


class RuntimeImageCDP:
    def __init__(self, owner):
        self.owner = owner
        self.enabled = False

    def call(self, method, params=None, session=None):
        if session != "selected-webui-session":
            raise RuntimeError("image collection used the wrong CDP target")
        params = params or {}
        if method == "Page.enable":
            self.enabled = True
            return {}
        if method == "Page.getResourceTree":
            return {"frameTree": {"frame": {"id": "selected-webui-frame"}}}
        if method == "Page.getResourceContent":
            if not self.enabled:
                raise RuntimeError("Page agent is not enabled")
            if params.get("frameId") != "selected-webui-frame":
                raise RuntimeError("image collection used the wrong frame")
            response = next((value for (page, _), value in self.owner.responses.items()
                             if page == self.owner.page and value.get("url") == params.get("url")), None)
            if response is None or response.get("error"):
                raise RuntimeError((response or {}).get("error", "No resource with given URL found"))
            if response.get("uncached") and params["url"] not in self.owner.active_images.values():
                raise RuntimeError("Page.getResourceContent: No resource with given URL found")
            if response.get("error_after_load"):
                raise RuntimeError(response["error_after_load"])
            return {"content": response["base64"], "base64Encoded": True}
        raise RuntimeError(f"Unexpected CDP command: {method}")


class WebUIBrandingAcceptance(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pibrowse-webui-gate-")
        self.root = Path(self.tmp.name)
        self.core = self.root / "out/PiBrowse.app/Contents/MacOS/PiBrowse"
        self.core.parent.mkdir(parents=True)
        self.core.write_bytes(b"not launched by offline acceptance tests")
        self.core.chmod(0o755)
        self.artifacts = self.root / "artifacts"
        self.sessions = []
        self.logo_alt = {"version": "PiBrowse", "settings": "PiBrowse"}
        self.images = {
            "chrome/app/theme/default_100_percent/chromium/product_logo_32.png":
                ((21, 100, 25, 255), (2, 2)),
            "chrome/app/theme/default_200_percent/chromium/product_logo_32.png":
                ((22, 101, 26, 255), (4, 4)),
            "components/resources/default_100_percent/chromium/product_logo.png":
                ((23, 102, 27, 255), (3, 1)),
            "components/resources/default_200_percent/chromium/product_logo.png":
                ((24, 103, 28, 255), (6, 2)),
            "components/resources/default_100_percent/chromium/product_logo_white.png":
                ((240, 240, 240, 255), (3, 1)),
            "components/resources/default_200_percent/chromium/product_logo_white.png":
                ((250, 250, 250, 255), (6, 2)),
            "components/resources/default_100_percent/chromium/favicon_product.png":
                ((25, 104, 29, 255), (2, 2)),
            "components/resources/default_200_percent/chromium/favicon_product.png":
                ((26, 105, 30, 255), (4, 4)),
        }
        for relative, (color, size) in self.images.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(png_bytes(color, size))
        self.responses = {
            ("version", "logo"): self.response(
                "chrome://theme/IDR_PRODUCT_LOGO_WHITE@2x",
                "components/resources/default_200_percent/chromium/product_logo_white.png"),
            ("version", "favicon"): self.response(
                "chrome://theme/current-channel-logo",
                "chrome/app/theme/default_100_percent/chromium/product_logo_32.png"),
            ("settings", "logo"): self.response(
                "chrome://theme/current-channel-logo@2x",
                "chrome/app/theme/default_200_percent/chromium/product_logo_32.png"),
        }

    def tearDown(self):
        self.tmp.cleanup()

    def response(self, url, relative):
        color, size = self.images[relative]
        data = png_bytes(color, size, reencoded=True)
        self.assertNotEqual(data, (self.root / relative).read_bytes())
        return {"url": url, "mime": "image/png", "bytes": len(data),
                "base64": base64.b64encode(data).decode("ascii")}

    def state(self, session, page):
        copyright = ("版权所有2026 The Chromium Authors。保留所有权利。"
                     if session.locale == "zh-CN" else
                     "Copyright 2026 The Chromium Authors. All rights reserved.")
        return {"url": "chrome://version" if page == "version" else "chrome://settings/help",
                "lang": session.locale, "product": "PiBrowse", "visible": True,
                "company": "The Chromium Authors", "copyright": copyright,
                # naturalWidth is density-corrected by <picture>/srcset. The
                # gate must inspect PNG bytes for the real resource dimensions.
                "logo": {"complete": True, "visible": True, "width": 1,
                         "height": 1, "alt": self.logo_alt[page],
                         "source": self.responses[page, "logo"].get("url", "")},
                "favicon": {"source": self.responses.get((page, "favicon"), {}).get("url", "")}}

    def run_gate(self, *, artifacts=True, source_argument=False):
        def launch(_core, _config, page, extra_args, os_crypt_key):
            locale = next(x.split("=", 1)[1] for x in extra_args if x.startswith("--lang="))
            session = RuntimeImageSession("version" if page == "chrome://version" else "settings",
                                          locale, self.responses)
            self.sessions.append(session)
            return session

        arguments = [str(self.core)]
        if artifacts:
            arguments += ["--artifacts-dir", str(self.artifacts)]
        if source_argument:
            arguments += ["--source-dir", str(self.root)]
        with patch.object(branding, "launch", launch), \
                patch.object(branding, "snapshot", self.state), \
                contextlib.redirect_stdout(io.StringIO()):
            return branding.main(arguments)

    def test_old_settings_image_fails_despite_correct_labels_and_loaded_image(self):
        old = png_bytes((20, 40, 220, 255), (4, 4))
        self.responses["settings", "logo"]["base64"] = base64.b64encode(old).decode()
        self.assertEqual(self.run_gate(), 1)
        result = json.loads((self.artifacts / "webui-branding-en-US.json").read_text())
        self.assertIn("differs from approved RGBA", result["settings"]["runtimeLogoExport"]["error"])

    def test_old_version_wordmark_fails_despite_correct_labels(self):
        old = png_bytes((20, 40, 220, 255), (6, 2))
        self.responses["version", "logo"]["base64"] = base64.b64encode(old).decode()
        self.assertEqual(self.run_gate(), 1)

    def test_failed_runtime_resource_read_fails_the_gate(self):
        self.responses["settings", "logo"] = {
            "url": "chrome://theme/current-channel-logo@2x", "error": "CDP resource read failed"}
        self.assertEqual(self.run_gate(), 1)

    def test_failed_version_favicon_resource_read_fails_the_gate(self):
        self.responses["version", "favicon"] = {
            "url": "chrome://theme/current-channel-logo", "error": "CDP resource read failed"}
        self.assertEqual(self.run_gate(), 1)

    def test_reencoded_approved_pngs_pass_and_all_runtime_images_are_saved(self):
        self.assertEqual(self.run_gate(), 0)
        self.assertEqual(len(list(self.artifacts.glob("*.png"))), 6)

    def test_old_or_missing_product_logo_alt_fails_despite_approved_visible_pixels(self):
        for page in ("version", "settings"):
            for alt in ("Chromium logo", "Chromium 徽标", "Fury logo", "", None):
                with self.subTest(page=page, alt=alt):
                    self.logo_alt = {"version": "PiBrowse", "settings": "PiBrowse"}
                    self.logo_alt[page] = alt
                    self.assertEqual(self.run_gate(), 1)

    def test_image_comparison_is_required_without_artifacts_option(self):
        self.responses["version", "logo"] = {"error": "runtime image unavailable"}
        self.assertEqual(self.run_gate(artifacts=False), 1)

    def test_explicit_source_directory_and_light_one_x_variant(self):
        self.responses["version", "logo"] = self.response(
            "chrome://theme/IDR_PRODUCT_LOGO",
            "components/resources/default_100_percent/chromium/product_logo.png")
        self.responses["settings", "logo"] = self.response(
            "chrome://theme/current-channel-logo@1x",
            "chrome/app/theme/default_100_percent/chromium/product_logo_32.png")
        self.assertEqual(self.run_gate(source_argument=True), 0)

    def test_other_version_density_and_color_variants_use_their_own_source(self):
        variants = (
            ("chrome://theme/IDR_PRODUCT_LOGO@2x",
             "components/resources/default_200_percent/chromium/product_logo.png"),
            ("chrome://theme/IDR_PRODUCT_LOGO_WHITE",
             "components/resources/default_100_percent/chromium/product_logo_white.png"),
        )
        for url, relative in variants:
            with self.subTest(url=url):
                self.responses["version", "logo"] = self.response(url, relative)
                self.assertEqual(self.run_gate(), 0)

    def test_hidden_rgb_under_zero_alpha_does_not_cause_a_false_failure(self):
        expected = self.root / "chrome/app/theme/default_200_percent/chromium/product_logo_32.png"
        with Image.open(expected) as image:
            image = image.convert("RGBA")
        image.putpixel((0, 0), (0, 0, 0, 0))
        image.save(expected)
        image.putpixel((0, 0), (120, 200, 255, 0))
        output = io.BytesIO()
        image.save(output, format="PNG")
        self.responses["settings", "logo"]["base64"] = base64.b64encode(output.getvalue()).decode()
        self.assertEqual(self.run_gate(), 0)

    def test_a_one_level_change_in_a_visible_semitransparent_pixel_still_fails(self):
        expected = self.root / "chrome/app/theme/default_200_percent/chromium/product_logo_32.png"
        with Image.open(expected) as image:
            image = image.convert("RGBA")
        image.putpixel((0, 0), (21, 100, 25, 128))
        image.save(expected)
        image.putpixel((0, 0), (22, 100, 25, 128))
        output = io.BytesIO()
        image.save(output, format="PNG")
        self.responses["settings", "logo"]["base64"] = base64.b64encode(output.getvalue()).decode()
        self.assertEqual(self.run_gate(), 1)

    def test_invalid_runtime_png_encoding_fails_without_crashing(self):
        self.responses["settings", "logo"]["base64"] = "not valid base64!"
        self.assertEqual(self.run_gate(), 1)

    def test_uncached_favicon_loads_only_its_selected_url_and_removes_the_hidden_image(self):
        self.responses["version", "favicon"]["uncached"] = True
        self.assertEqual(self.run_gate(), 0)
        for session in self.sessions:
            if session.page == "version":
                self.assertEqual(session.loaded_urls, ["chrome://theme/current-channel-logo"])
                self.assertEqual(len(session.removed_images), 1)
                self.assertEqual(session.active_images, {})
        result = json.loads((self.artifacts / "webui-branding-en-US.json").read_text())
        self.assertTrue(result["version"]["runtimeFaviconExport"]["primed_with_hidden_image"])

    def test_hidden_image_load_failure_fails_and_cleans_up(self):
        self.responses["version", "favicon"].update(uncached=True, image_error="image load failed")
        self.assertEqual(self.run_gate(), 1)
        for session in self.sessions:
            if session.page == "version":
                self.assertEqual(len(session.removed_images), 1)
                self.assertEqual(session.active_images, {})

    def test_failed_cdp_read_after_hidden_image_load_fails_and_cleans_up(self):
        self.responses["version", "favicon"].update(
            uncached=True, error_after_load="Content unavailable after image load")
        self.assertEqual(self.run_gate(), 1)
        for session in self.sessions:
            if session.page == "version":
                self.assertEqual(len(session.removed_images), 1)

    def test_hidden_image_cannot_substitute_another_url(self):
        self.responses["version", "favicon"].update(
            uncached=True, image_source="chrome://theme/current-channel-logo@2x")
        self.assertEqual(self.run_gate(), 1)
        result = json.loads((self.artifacts / "webui-branding-en-US.json").read_text())
        self.assertIn("selected URL", result["version"]["runtimeFaviconExport"]["error"])

    def test_old_pixels_from_the_hidden_image_path_still_fail(self):
        old = png_bytes((20, 40, 220, 255), (2, 2))
        self.responses["version", "favicon"].update(
            uncached=True, base64=base64.b64encode(old).decode())
        self.assertEqual(self.run_gate(), 1)
        result = json.loads((self.artifacts / "webui-branding-en-US.json").read_text())
        self.assertIn("differs from approved RGBA", result["version"]["runtimeFaviconExport"]["error"])

    def test_cached_non_png_is_rejected_without_retrying_as_a_hidden_image(self):
        self.responses["settings", "logo"]["base64"] = base64.b64encode(b"not a PNG").decode()
        self.assertEqual(self.run_gate(), 1)
        self.assertTrue(all(not session.loaded_urls for session in self.sessions))

    def test_hidden_image_non_png_resource_is_rejected_and_cleaned_up(self):
        self.responses["version", "favicon"].update(
            uncached=True, base64=base64.b64encode(b"not a PNG").decode())
        self.assertEqual(self.run_gate(), 1)
        for session in self.sessions:
            if session.page == "version":
                self.assertEqual(len(session.removed_images), 1)
                self.assertEqual(session.active_images, {})


if __name__ == "__main__":
    unittest.main()
