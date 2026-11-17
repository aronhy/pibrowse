// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxiesFor, sharedExits, unusedProxies, type ProxyIo } from "../src/proxyIds.ts";

const here = [
  { id: "p-shop", name: "Shop", host: "9.9.9.9", port: 9 },
  { id: "p-old", name: "old", host: "5.5.5.5", port: 5 },
] as never[];

/** A line as the agent's parser would read it, for the shapes used here. */
function parse(l: string) {
  const url = /^(\w+):\/\/(?:([^:@]+):([^@]+)@)?([\w.]+):(\d+)$/.exec(l);
  if (url) {
    return { kind: url[1], host: url[4], port: Number(url[5]), username: url[2] ?? null, password: url[3] ?? null, shape: "Url" as const };
  }
  const m = /^([\w.]+):(\d+)(?::([^:]+):([^:]+))?$/.exec(l);
  if (!m) return null;
  return {
    kind: "socks5", host: m[1], port: Number(m[2]), username: m[3] ?? null, password: m[4] ?? null,
    shape: m[3] ? ("HostPortUserPass" as const) : ("HostPort" as const),
  };
}

/** A stand-in for the agent's import: saves what `parse` reads, refuses the rest. */
function fakeIo() {
  const calls = { imported: [] as string[], deleted: [] as string[] };
  const io: ProxyIo = {
    importProxies: async (text) => {
      calls.imported.push(text);
      const saved: { id: string; line: number; host: string; port: number; shape: string }[] = [];
      const rejected: { line: number; error: string }[] = [];
      text.split("\n").forEach((l, i) => {
        const p = parse(l);
        if (p) saved.push({ id: `new-${i + 1}`, line: i + 1, host: p.host, port: p.port, shape: p.shape });
        else rejected.push({ line: i + 1, error: `cannot read ${l}` });
      });
      return { saved, rejected };
    },
    deleteProxy: async (id) => {
      calls.deleted.push(id);
      return {};
    },
    parseProxyLine: async (line) => parse(line),
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

// A rotating gateway: one address for every session, told apart by the login.
const gateway = [
  { id: "p-gw", name: "gateway", kind: "http", host: "gw.p.net", port: 7000, username: "sess-old", password: "pw" },
] as never[];

test("the same gateway under another login is another proxy", async () => {
  const { io, calls } = fakeIo();
  const got = await proxiesFor(
    ["gw.p.net:7000:sess-1:pw", "gw.p.net:7000:sess-2:pw", "gw.p.net:7000:sess-3:pw"],
    { ...opts, existing: gateway },
    io,
  );
  assert.deepEqual(got.map((g) => g.id), ["new-1", "new-2", "new-3"]);
  assert.deepEqual(calls.deleted, [], "none of the three is the proxy already here");
  assert.ok(got.every((g) => g.made));
});

test("a new password for an old login is not dropped for the old one", async () => {
  const { io, calls } = fakeIo();
  const got = await proxiesFor(["gw.p.net:7000:sess-old:rotated"], { ...opts, existing: gateway }, io);
  assert.deepEqual(got, [{ id: "new-1", made: true }]);
  assert.deepEqual(calls.deleted, []);
});

test("the same login and password is the proxy already here, whatever the spelling", async () => {
  const { io, calls } = fakeIo();
  const got = await proxiesFor(
    ["gw.p.net:7000:sess-old:pw", "http://sess-old:pw@gw.p.net:7000"],
    { ...opts, existing: gateway },
    io,
  );
  assert.deepEqual(got, [{ id: "p-gw" }, { id: "p-gw" }]);
  assert.deepEqual(calls.deleted, ["new-1", "new-2"]);
});

test("a line that names another type is another proxy; one that names none keeps the saved type", async () => {
  const { io, calls } = fakeIo();
  const got = await proxiesFor(
    ["socks5://sess-old:pw@gw.p.net:7000", "gw.p.net:7000:sess-old:pw"],
    { ...opts, existing: gateway },
    io,
  );
  assert.deepEqual(got.map((g) => g.id), ["new-1", "p-gw"]);
  assert.deepEqual(calls.deleted, ["new-2"]);
});

test("a team proxy's login is not here to compare, so a line with one is kept", async () => {
  const sealed = [
    { id: "t-gw", name: "team gateway", kind: "http", host: "gw.p.net", port: 7000, username: null, password: null, sealed: true },
  ] as never[];
  const { io, calls } = fakeIo();
  const got = await proxiesFor(
    ["gw.p.net:7000:sess-1:pw", "gw.p.net:7000"],
    { ...opts, existing: sealed, origin: "team" },
    io,
  );
  assert.deepEqual(got, [{ id: "new-1", made: true }, { id: "t-gw" }]);
  assert.deepEqual(calls.deleted, ["new-2"]);
});

test("a line that cannot be read back is kept, not taken for the old proxy", async () => {
  const { io, calls } = fakeIo();
  io.parseProxyLine = async () => {
    throw new Error("no agent");
  };
  const got = await proxiesFor(["gw.p.net:7000:sess-old:pw"], { ...opts, existing: gateway }, io);
  assert.deepEqual(got, [{ id: "new-1", made: true }]);
  assert.deepEqual(calls.deleted, []);
});

test("profiles given one proxy are named together", async () => {
  const { io } = fakeIo();
  // Twice as a line, and once more as the name of a proxy and as its address.
  const got = await proxiesFor(["1.1.1.1:1", "shop", "1.1.1.1:1", "bad", "9.9.9.9:9", ""], opts, io);
  assert.deepEqual(sharedExits(got.map((g) => g.id)), [[0, 2], [1, 4]]);
  assert.deepEqual(sharedExits(["a", "b", null, ""]), []);
});

test("only a proxy this call saved, and that no profile got, is taken back", () => {
  const found = [
    { id: "new-1", made: true }, // its profile failed
    { id: "new-2", made: true }, // made
    { id: "new-3", made: true }, // given twice: one profile failed, one made
    { id: "new-3", made: true },
    { id: "p-old" },             // was here before: stays whatever happens
    { id: null, error: "?" },
  ];
  assert.deepEqual(unusedProxies(found, new Set([0, 2, 4])), ["new-1"]);
  // The whole batch failed: everything this call saved goes, once each.
  assert.deepEqual(unusedProxies(found, new Set([0, 1, 2, 3, 4, 5])), ["new-1", "new-2", "new-3"]);
  assert.deepEqual(unusedProxies(found, new Set()), []);
});
