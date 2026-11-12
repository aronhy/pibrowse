// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxiesFor, type ProxyIo } from "../src/proxyIds.ts";

const here = [
  { id: "p-shop", name: "Shop", host: "9.9.9.9", port: 9 },
  { id: "p-old", name: "old", host: "5.5.5.5", port: 5 },
] as never[];

/** A stand-in for the agent's import: reads `host:port`, refuses the rest. */
function fakeIo() {
  const calls = { imported: [] as string[], deleted: [] as string[] };
  const io: ProxyIo = {
    importProxies: async (text) => {
      calls.imported.push(text);
      const saved: { id: string; line: number; host: string; port: number; shape: string }[] = [];
      const rejected: { line: number; error: string }[] = [];
      text.split("\n").forEach((l, i) => {
        const m = /^([\d.]+):(\d+)$/.exec(l);
        if (m) saved.push({ id: `new-${i + 1}`, line: i + 1, host: m[1], port: Number(m[2]), shape: "HostPort" });
        else rejected.push({ line: i + 1, error: `cannot read ${l}` });
      });
      return { saved, rejected };
    },
    deleteProxy: async (id) => {
      calls.deleted.push(id);
      return {};
    },
  };
  return { io, calls };
}

const opts = { existing: here, namePrefix: "", origin: "local" as const, unreadable: "?" };

test("one answer per line, at the line's own position", async () => {
  const { io } = fakeIo();
  const got = await proxiesFor(["1.1.1.1:1", "bad", "2.2.2.2:2", ""], opts, io);
  assert.deepEqual(got.map((g) => g.id), ["new-1", null, "new-3", null]);
  assert.equal(got[1].error, "cannot read bad");
  assert.equal(got[3].error, undefined);
});

test("a proxy already here is used, by name or by address", async () => {
  const { io, calls } = fakeIo();
  const got = await proxiesFor(["shop", "5.5.5.5:5"], opts, io);
  assert.deepEqual(got.map((g) => g.id), ["p-shop", "p-old"]);
  assert.deepEqual(calls.imported, ["5.5.5.5:5"]);
  assert.deepEqual(calls.deleted, ["new-1"]);
});

test("a line given twice is saved once", async () => {
  const { io, calls } = fakeIo();
  const got = await proxiesFor(["1.1.1.1:1", "1.1.1.1:1"], opts, io);
  assert.deepEqual(got.map((g) => g.id), ["new-1", "new-1"]);
  assert.deepEqual(calls.imported, ["1.1.1.1:1"]);
});
