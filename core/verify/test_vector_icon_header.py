# SPDX-License-Identifier: AGPL-3.0-or-later

"""Exercise 0909 against a scratch copy of the actual Chromium producer.

Set FURY_CHROMIUM_SRC to the owning checkout. No source/cache/generated file in
that checkout is written; the canonical patch and generator run only in temp.
"""

import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import time
import unittest


CORE = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("FURY_CHROMIUM_SRC", CORE / "src"))
PRODUCER = Path("components/vector_icons/aggregate_vector_icons.py")
PATCH = CORE / "patches/0909-stable-vector-icon-header.patch"


class VectorIconHeaderAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = SOURCE / PRODUCER
        if not source.is_file():
            raise unittest.SkipTest("Set FURY_CHROMIUM_SRC to the actual Chromium source")
        cls.source_code = source.read_bytes()
        cls.templates = {
            name: (source.parent / name).read_bytes()
            for name in ("vector_icons.h.template", "vector_icons.cc.template")
        }

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pibrowse-icon-header-")
        self.root = Path(self.tmp.name)
        producer = self.root / PRODUCER
        producer.parent.mkdir(parents=True)
        producer.write_bytes(self.source_code)
        if PATCH.is_file():
            # Apply only to the scratch copy. Also support rerunning this test
            # after the owning checkout has received the canonical patch.
            command = ["git", "apply", "--check", str(PATCH)]
            check = subprocess.run(command, cwd=self.root, capture_output=True)
            if check.returncode == 0:
                subprocess.run(["git", "apply", str(PATCH)], cwd=self.root, check=True,
                               capture_output=True)
            else:
                subprocess.run(["git", "apply", "--reverse", "--check", str(PATCH)],
                               cwd=self.root, check=True, capture_output=True)
        namespace = {"__name__": "scratch_vector_icon_producer"}
        exec(compile(producer.read_text(), str(producer), "exec"), namespace)
        self.aggregate = namespace["AggregateVectorIcons"]
        self.icons = self.root / "icons"
        self.icons.mkdir()
        for name, data in self.templates.items():
            (self.icons / name).write_bytes(data)
        self.listing = self.root / "icons.rsp"
        self.header = self.root / "vector_icons.h"
        self.cc = self.root / "vector_icons.cc"

    def tearDown(self):
        self.tmp.cleanup()

    def icon(self, name, x=0):
        path = self.icons / f"{name}.icon"
        path.write_text(f"CANVAS_DIMENSIONS, 16,\nMOVE_TO, {x}, 0,\nLINE_TO, 8, 8,\nCLOSE\n")
        return path

    def generate(self, *icons):
        self.listing.write_text(shlex.join([str(icon) for icon in icons]))
        self.aggregate(str(self.icons), str(self.listing), str(self.cc), str(self.header), None)

    def test_initial_generation_creates_header_and_definitions(self):
        self.generate(self.icon("alpha"))
        self.assertIn("VECTOR_ICON_TEMPLATE_H(kAlphaIcon)\n", self.header.read_text())
        self.assertIn("MOVE_TO, 0, 0,", self.cc.read_text())

    def test_path_only_change_preserves_header_content_and_mtime_but_updates_cc(self):
        icon = self.icon("alpha")
        self.generate(icon)
        header, modified = self.header.read_bytes(), self.header.stat().st_mtime_ns
        cc = self.cc.read_bytes()
        time.sleep(0.02)
        self.icon("alpha", x=7)
        self.generate(icon)
        self.assertEqual(self.header.read_bytes(), header)
        self.assertEqual(self.header.stat().st_mtime_ns, modified)
        self.assertNotEqual(self.cc.read_bytes(), cc)
        self.assertIn("MOVE_TO, 7, 0,", self.cc.read_text())

    def test_new_symbol_updates_the_header(self):
        alpha = self.icon("alpha")
        self.generate(alpha)
        header, modified = self.header.read_bytes(), self.header.stat().st_mtime_ns
        time.sleep(0.02)
        self.generate(alpha, self.icon("beta"))
        self.assertNotEqual(self.header.read_bytes(), header)
        self.assertGreater(self.header.stat().st_mtime_ns, modified)
        self.assertIn("VECTOR_ICON_TEMPLATE_H(kBetaIcon)\n", self.header.read_text())


if __name__ == "__main__":
    unittest.main()
