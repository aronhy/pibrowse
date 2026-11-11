#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright 2026 Bogdan Shapovalov and the Fury authors
"""Exercise the hunk checker against real Git diffs and corrupted variants."""

import pathlib
import re
import subprocess
import sys
import tempfile
import unittest


CHECKER = pathlib.Path(__file__).with_name("check-hunks.py")


class CheckHunksTests(unittest.TestCase):
    def git_diff(self, old, new):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            before, after = root / "before.svg", root / "after.svg"
            before.write_bytes(old)
            after.write_bytes(new)
            result = subprocess.run(
                ["git", "diff", "--no-index", "--", str(before), str(after)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            return result.stdout

    def check_patch(self, patch):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            patches = root / "core" / "patches"
            patches.mkdir(parents=True)
            (patches / "fixture.patch").write_text(patch)
            return subprocess.run(
                [sys.executable, str(CHECKER)],
                cwd=root,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_old_file_without_newline_can_be_replaced_by_a_newline_terminated_file(self):
        patch = self.git_diff(b"<svg>old</svg>", b"<svg>new</svg>\n")
        self.assertIn("-<svg>old</svg>\n\\ No newline at end of file\n+", patch)
        result = self.check_patch(patch)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_both_sides_without_newline_have_two_uncounted_markers(self):
        patch = self.git_diff(b"old", b"new")
        self.assertEqual(patch.count("\\ No newline at end of file"), 2)
        result = self.check_patch(patch)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_new_file_without_newline_and_ordinary_diffs_still_pass(self):
        for old, new in [(b"old\n", b"new"), (b"old\n", b"new\n")]:
            with self.subTest(old=old, new=new):
                result = self.check_patch(self.git_diff(old, new))
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_no_newline_marker_does_not_hide_an_incorrect_header(self):
        patch = self.git_diff(b"old", b"new\n")
        patch, count = re.subn(r"@@ -1 \+1 @@", "@@ -1 +1,2 @@", patch)
        self.assertEqual(count, 1)
        result = self.check_patch(patch)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("header says 1/2", result.stderr)

    def test_unknown_backslash_line_still_terminates_a_malformed_hunk(self):
        patch = self.git_diff(b"old", b"new\n").replace(
            "\\ No newline at end of file", "\\ Unknown marker"
        )
        result = self.check_patch(patch)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("body has 1/0", result.stderr)


if __name__ == "__main__":
    unittest.main()
