#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 Bogdan Shapovalov and the Fury authors
"""Verify the built core's operator-facing WebUI branding in English and Chinese.

Uses harness.launch with fresh, disposable profiles. No installed browser or
existing profile is inspected. Run only against the newly built core:

    python3 core/verify/verify-0906.py <core binary> \
        --source-dir <approved Chromium source> [--artifacts-dir <directory>]

Selectors follow Chromium 157's actual templates:
  components/webui/version/resources/about_version.html
  chrome/browser/resources/settings/about_page/about_page.html.ts

The product labels must say PiBrowse; upstream copyright must still credit
The Chromium Authors. Both pages' rendered logos and the version tab's favicon
must match approved source images after PNG decoding. CDP reads bytes from the
tested browser; JavaScript Fetch does not support chrome:// URLs. --artifacts-dir
keeps the runtime PNGs and JSON evidence; comparison also runs without it.
"""

import argparse
import base64
import binascii
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import time

try:
    from PIL import Image
except ImportError as error:
    raise SystemExit("WebUI image verification requires Pillow (python3 -m pip install Pillow)") from error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import Claims, launch  # noqa: E402

LANGUAGES = ("en-US", "zh-CN")
KEY = bytes(range(32))

# Walk open shadow roots instead of searching body.innerText: Settings nests
# its about page below several custom elements, and legal text may legitimately
# contain Chromium even when the visible product title has been renamed.
DOM_HELPERS = r"""
function findDeep(selector, root = document) {
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
      const found = findDeep(selector, element.shadowRoot);
      if (found) return found;
    }
  }
  return null;
}
function text(element) {
  return element ? element.textContent.replace(/\s+/g, ' ').trim() : '';
}
function visible(element) {
  return !!element && element.getClientRects().length > 0;
}
function imageInfo(image) {
  if (!image) return null;
  return {
    complete: image.complete,
    width: image.naturalWidth,
    height: image.naturalHeight,
    source: image.currentSrc || image.src || '',
    srcset: image.srcset || '',
    alt: image.alt || '',
    visible: visible(image),
  };
}
function commonInfo() {
  return {
    url: location.href,
    lang: document.documentElement.lang,
    documentTitle: document.title,
  };
}
function readVersion() {
  const version = document.querySelector('#version');
  const label = version && version.previousElementSibling;
  return {
    ...commonInfo(),
    product: text(label),
    visible: visible(label),
    company: text(document.querySelector('#company')),
    copyright: text(document.querySelector('#copyright')),
    logo: imageInfo(document.querySelector('#logo img')),
    favicon: {source: document.querySelector('link[rel~="icon"]')?.href || ''},
  };
}
function readSettings() {
  const host = findDeep('settings-about-page');
  const root = host && host.shadowRoot;
  const title = root && root.querySelector('.product-title');
  const legalSection = root && root.querySelector('.info-sections .info-section');
  const legalRows = legalSection ? legalSection.querySelectorAll('.secondary') : [];
  return {
    ...commonInfo(),
    product: text(title),
    visible: visible(title),
    copyright: text(legalRows[1]),
    logo: imageInfo(root && root.querySelector('#productLogo')),
  };
}
"""

def language_args(locale):
    args = [f"--lang={locale}"]
    if sys.platform == "darwin":
        # macOS chooses UI resources through NSBundle's preferred localizations;
        # --lang alone can leave both test launches in the machine's language.
        # These are process arguments; no defaults or system settings are changed.
        args.extend(("-AppleLanguages", f"({locale})",
                     "-AppleLocale", locale.replace("-", "_")))
    return tuple(args)


def language_matches(actual, requested):
    return (isinstance(actual, str)
            and actual.lower().split("-")[0] == requested.lower().split("-")[0])


def copyright_preserved(value, locale):
    if "The Chromium Authors" not in value or not re.search(r"\d{4}", value):
        return False
    if locale.startswith("zh"):
        return "版权所有" in value and "保留所有权利" in value
    return "Copyright" in value and "All rights reserved" in value


def snapshot(session, page, seconds=20):
    reader = "readVersion" if page == "version" else "readSettings"
    expression = "(() => {" + DOM_HELPERS + f"return JSON.stringify({reader}());" + "})()"
    deadline = time.monotonic() + seconds
    last = {}
    while time.monotonic() < deadline:
        value = session.js(expression)
        if isinstance(value, str):
            last = json.loads(value)
            logo = last.get("logo") or {}
            if last.get("product") and last.get("copyright") and logo.get("complete"):
                return last
        elif value:
            last = {"evaluationError": value}
        time.sleep(0.2)
    return last


def discover_source(core):
    for parent in Path(core).resolve().parents:
        if ((parent / "chrome/app/theme").is_dir()
                and (parent / "components/resources").is_dir()):
            return parent
    return None


def approved_image_path(source, page, kind, url):
    match = re.fullmatch(
        r"chrome://theme/(current-channel-logo|IDR_PRODUCT_LOGO(?:_WHITE)?|IDR_PRODUCT_FAVICON)"
        r"(?:@([12])x)?", str(url))
    if not match:
        raise ValueError(f"Unexpected {page} {kind} resource URL: {url!r}")
    resource, scale = match.group(1), int(match.group(2) or 1)
    density = f"default_{scale * 100}_percent/chromium"
    if resource == "current-channel-logo" and (
            (page, kind) == ("settings", "logo") or (page, kind) == ("version", "favicon")):
        # current_channel_logo.cc -> IDR_PRODUCT_LOGO_32, theme_resources.grd.
        return source / "chrome/app/theme" / density / "product_logo_32.png"
    if page == "version" and kind == "logo" and resource in (
            "IDR_PRODUCT_LOGO", "IDR_PRODUCT_LOGO_WHITE"):
        name = "product_logo_white.png" if resource.endswith("_WHITE") else "product_logo.png"
        return source / "components/resources" / density / name
    if (page, kind, resource) == ("version", "favicon", "IDR_PRODUCT_FAVICON"):
        return source / "components/resources" / density / "favicon_product.png"
    raise ValueError(f"Unexpected {page} {kind} resource: {resource}")


def decoded_rgba(data):
    with Image.open(io.BytesIO(data)) as image:
        if image.format != "PNG":
            raise ValueError("The runtime image response was not a PNG")
        image = image.convert("RGBA")
        size = image.size
        pixels = bytearray(image.tobytes())
    # ThemeSource returns raw packaged PNGs at supported 1x/2x scales, so visible
    # RGBA must match exactly. RGB under alpha=0 cannot affect the rendered image
    # and PNG optimizers may discard it; normalize only these invisible values.
    for offset in range(0, len(pixels), 4):
        if pixels[offset + 3] == 0:
            pixels[offset:offset + 3] = b"\0\0\0"
    return size, bytes(pixels)


LOAD_HIDDEN_IMAGE = r"""
(async () => {
  const imageUrl = __IMAGE_URL__;
  const collectorId = __COLLECTOR_ID__;
  const image = new Image();
  image.id = collectorId;
  image.hidden = true;
  image.alt = '';
  let timer;
  const ready = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('image load failed'));
    timer = setTimeout(() => reject(new Error('image load timed out')), 10000);
  });
  try {
    image.src = imageUrl;
    document.body.append(image);
    await ready;
    return JSON.stringify({source: image.currentSrc,
                           width: image.naturalWidth, height: image.naturalHeight});
  } catch (error) {
    return JSON.stringify({error: String(error)});
  } finally {
    clearTimeout(timer);
  }
})()
"""


def runtime_resource(session, url):
    # The target is the same flattened CDP session that supplied the DOM state.
    # Page.enable is required by Chromium 157 getResourceContent even though
    # getResourceTree itself does not require it.
    session.ws.call("Page.enable", session=session.session)
    tree = session.ws.call("Page.getResourceTree", session=session.session)
    frame_id = tree.get("frameTree", {}).get("frame", {}).get("id")
    if not isinstance(frame_id, str) or not frame_id:
        raise ValueError("The selected WebUI target has no CDP frame ID")
    params = {"frameId": frame_id, "url": url}
    evidence = {"transport": "Page.getResourceContent", "frame_id": frame_id,
                "primed_with_hidden_image": False}
    try:
        response = session.ws.call("Page.getResourceContent", params, session=session.session)
    except RuntimeError as cache_error:
        # Tab favicons can be loaded outside the document's resource cache.
        # Normal img loading supports chrome://theme; Fetch API and
        # Network.loadNetworkResource do not. Keep the same selected URL and
        # target, then read the raw PNG through Page, never a canvas/source file.
        if not any(text in str(cache_error) for text in (
                "No resource with given URL found", "Resource was not cached")):
            raise
        collector_id = f"pibrowse-brand-check-{time.monotonic_ns()}"
        expression = (LOAD_HIDDEN_IMAGE.replace("__IMAGE_URL__", json.dumps(url))
                      .replace("__COLLECTOR_ID__", json.dumps(collector_id)))
        try:
            value = session.js(expression, timeout=15000)
            image = json.loads(value) if isinstance(value, str) else None
            if not isinstance(image, dict) or image.get("error"):
                raise ValueError(f"Hidden image load failed: {image or value!r}")
            if image.get("source") != url:
                raise ValueError("Hidden image did not load the exact selected URL")
            if not all(isinstance(image.get(key), (int, float)) and image[key] > 0
                       for key in ("width", "height")):
                raise ValueError("Hidden image loaded with no decoded pixels")
            response = session.ws.call("Page.getResourceContent", params, session=session.session)
            evidence.update(primed_with_hidden_image=True, cache_miss=str(cache_error),
                            image_load=image)
        finally:
            cleanup = session.js(f"document.getElementById({json.dumps(collector_id)})?.remove()")
            if isinstance(cleanup, dict) and cleanup.get("threw"):
                raise ValueError(f"Could not remove temporary image: {cleanup['threw']}")
    content, encoded = response.get("content"), response.get("base64Encoded")
    if not isinstance(content, str) or not isinstance(encoded, bool):
        raise ValueError("CDP resource response lacks content/base64Encoded")
    data = base64.b64decode(content, validate=True) if encoded else content.encode("utf-8")
    if not data:
        raise ValueError("CDP returned no runtime resource bytes")
    return data, evidence


def export_logo(session, directory, locale, page, source, kind="logo", *, url):
    # Validate the actual DOM-selected URL before asking the SUT for its bytes.
    # Source files supply only expected pixels; they never supply runtime bytes.
    result = {"matched": False, "url": url}
    try:
        expected = approved_image_path(source, page, kind, url)
        result["expected_path"] = str(expected)
        data, evidence = runtime_resource(session, url)
        result.update(evidence, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        size, actual_rgba = decoded_rgba(data)
        if directory:
            path = directory / f"{page}-{kind}-{locale}.png"
            path.write_bytes(data)
            result["path"] = str(path)
        expected_size, expected_rgba = decoded_rgba(expected.read_bytes())
        result.update(size=list(size), expected_size=list(expected_size))
        if size != expected_size:
            raise ValueError(f"Runtime PNG dimensions {size} differ from approved {expected_size}: {expected}")
        if actual_rgba != expected_rgba:
            changed = sum(actual_rgba[i:i + 4] != expected_rgba[i:i + 4]
                          for i in range(0, len(actual_rgba), 4))
            raise ValueError(f"Runtime PNG differs from approved RGBA at {changed} pixels: {expected}")
        result.update(matched=True, rgba_sha256=hashlib.sha256(actual_rgba).hexdigest())
    except (RuntimeError, OSError, ValueError, TypeError, binascii.Error) as error:
        result.update(matched=False, error=str(error))
    if result.get("error"):
        print(f"  {locale} {page} {kind} image verification failed: {result['error']}")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("core", help="newly built core executable")
    parser.add_argument("--artifacts-dir", type=Path)
    parser.add_argument("--source-dir", type=Path,
                        help="approved Chromium source containing chrome/app/theme and components/resources; "
                             "otherwise discover it from the executable's actual checkout")
    args = parser.parse_args(argv)
    core = os.path.abspath(args.core)
    if not os.access(core, os.X_OK):
        parser.error(f"Not an executable core: {core}")
    source = args.source_dir.resolve() if args.source_dir else discover_source(core)
    if source is None or not all((source / relative).is_dir() for relative in (
            "chrome/app/theme", "components/resources")):
        parser.error("Provide --source-dir with the approved Chromium source for image comparison")
    directory = args.artifacts_dir.resolve() if args.artifacts_dir else None
    if directory:
        directory.mkdir(parents=True, exist_ok=True)
    claims = Claims("0906 — localized version/About product labels and live logo", core)
    observed = {}
    for locale in LANGUAGES:
        observed[locale] = {}
        for page, url in (("version", "chrome://version"),
                          ("settings", "chrome://settings/help")):
            with launch(core, None, page=url, extra_args=language_args(locale),
                        os_crypt_key=KEY) as session:
                state = snapshot(session, page)
                state["runtimeLogoExport"] = export_logo(
                    session, directory, locale, page, source,
                    url=(state.get("logo") or {}).get("source"))
                if page == "version":
                    state["runtimeFaviconExport"] = export_logo(
                        session, directory, locale, page, source, "favicon",
                        url=(state.get("favicon") or {}).get("source"))
            observed[locale][page] = state
            print(f"  {locale} {url}: " + json.dumps(state, ensure_ascii=False))
            claims.check(state.get("product") == "PiBrowse" and state.get("visible"),
                         f"{locale} {url} visibly names the product PiBrowse")
            claims.check(language_matches(state.get("lang", ""), locale),
                         f"{locale} {url} actually loaded the requested UI language "
                         f"(HTML lang={state.get('lang')!r})")
            claims.check(copyright_preserved(state.get("copyright", ""), locale),
                         f"{locale} {url} retains its localized Chromium copyright")
            logo = state.get("logo") or {}
            claims.check(logo.get("complete") and logo.get("visible")
                         and logo.get("width", 0) > 0 and logo.get("height", 0) > 0,
                         f"{locale} {page} renders a nonempty visible logo")
            claims.check(logo.get("alt") == "PiBrowse",
                         f"{locale} {page} logo alt text is PiBrowse "
                         f"(alt={logo.get('alt')!r})")
            for kind, key in (("logo", "runtimeLogoExport"), ("favicon", "runtimeFaviconExport")):
                if kind == "favicon" and page != "version":
                    continue
                result = state[key]
                claims.check(result.get("matched") is True,
                             f"{locale} {page} runtime {kind} PNG matches approved visible RGBA "
                             f"({result.get('error') or result.get('expected_path')})")
        version = observed[locale]["version"]
        settings = observed[locale]["settings"]
        claims.control(version.get("product") == settings.get("product") == "PiBrowse"
                       and version.get("company") == "The Chromium Authors",
                       f"{locale} product labels are renamed while the upstream company "
                       "attribution remains Chromium; replacing every Chromium string "
                       "cannot satisfy this check")
        if directory:
            (directory / f"webui-branding-{locale}.json").write_text(
                json.dumps(observed[locale], ensure_ascii=False, indent=2) + "\n")
    claims.check(observed["en-US"]["version"].get("lang")
                 != observed["zh-CN"]["version"].get("lang"),
                 "the English and Chinese launches used different actual UI locales")
    return claims.done()


if __name__ == "__main__":
    sys.exit(main())
