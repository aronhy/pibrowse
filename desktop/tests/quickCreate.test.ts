// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextNumber, numberedProxyLines, proxyLines } from "../src/quickCreate.ts";

test("the next number is one past the highest taken", () => {
  assert.equal(nextNumber([], "窗口 {n}"), 1);
  assert.equal(nextNumber(["窗口 1", "窗口 7", "窗口 3"], "窗口 {n}"), 8);
});

test("names that do not fit the pattern are not counted", () => {
  assert.equal(nextNumber(["Shop 40", "窗口 2 copy", "窗口 x", "窗口 "], "窗口 {n}"), 1);
  assert.equal(nextNumber(["a-12-b", "a-3-c"], "a-{n}-b"), 13);
});

test("a pattern with no number starts at one", () => {
  assert.equal(nextNumber(["x 5"], "x"), 1);
});

test("blank lines and comments are not proxies", () => {
  assert.deepEqual(proxyLines("1.1.1.1:80\n\n# note\n // other\n 2.2.2.2:81:u:p \n"), ["1.1.1.1:80", "2.2.2.2:81:u:p"]);
});

test("each proxy line keeps the number it has in the box", () => {
  const text = "# mine\n1.1.1.1:80\n\nbad line\n2.2.2.2:81";
  assert.deepEqual(numberedProxyLines(text), [
    { line: 2, text: "1.1.1.1:80" },
    { line: 4, text: "bad line" },
    { line: 5, text: "2.2.2.2:81" },
  ]);
});
