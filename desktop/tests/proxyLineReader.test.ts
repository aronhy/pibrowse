// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineReader, type LineIo, type Spread } from "../src/proxyLineReader.ts";

/** Lets every promise already resolved run its continuations. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A stand-in for the agent: reads `host:port[:user:pass]` and URLs, and
 *  answers "http" for whatever address it is asked about. */
function fake() {
  const asked: string[] = [];
  const parses: { line: string; answer: () => void }[] = [];
  const parse = (l: string) => {
    const url = /^(\w+):\/\/([\w.]+):(\d+)$/.exec(l);
    if (url) return { kind: url[1], host: url[2], port: Number(url[3]), username: null, password: null, shape: "Url" as const };
    const m = /^([\w.]+):(\d+)(?::(\w+):(\w+))?$/.exec(l);
    if (!m) return null;
    return {
      kind: "socks5", host: m[1], port: Number(m[2]), username: m[3] ?? null, password: m[4] ?? null,
      shape: m[3] ? ("HostPortUserPass" as const) : ("HostPort" as const),
    };
  };
  const io: LineIo = {
    parseProxyLine: async (line) => parse(line),
    sniffProxyKind: async (host, port) => {
      asked.push(`${host}:${port}`);
      return { kind: "http" };
    },
  };
  /** The same, but each parse waits to be answered by hand. */
  const slow: LineIo = {
    ...io,
    parseProxyLine: (line) =>
      new Promise((resolve) => parses.push({ line, answer: () => resolve(parse(line)) })),
  };
  return { io, slow, asked, parses };
}

test("a line fills the fields it carries and no others", async () => {
  const { io } = fake();
  const got: (Spread | null)[] = [];
  const reader = lineReader(io, (p) => got.push(p));
  reader.read("1.2.3.4:8080:u:p");
  await settle();
  reader.read("http://gw.p.net:7000");
  await settle();
  reader.read("not a proxy");
  await settle();
  assert.deepEqual(got, [
    { kind: undefined, host: "1.2.3.4", port: "8080", username: "u", password: "p", shape: "HostPortUserPass" },
    { kind: "http", host: "gw.p.net", port: "7000", username: undefined, password: undefined, shape: "Url" },
    null,
  ]);
});

test("a box read as it is typed does not probe an address still being typed", async () => {
  const { io, asked } = fake();
  const kinds: string[] = [];
  const reader = lineReader(io, () => {}, (k) => kinds.push(k), true);
  // Typing `1.2.3.4:8080` passes through two shorter ports that are valid lines.
  for (const typed of ["1.2.3.4:8", "1.2.3.4:80", "1.2.3.4:808", "1.2.3.4:8080"]) {
    reader.read(typed);
    await settle();
  }
  assert.deepEqual(asked, [], "nothing is asked while the line is being typed");
  // Leaving the box: the line is whole, and only the last one is asked about.
  reader.flush();
  await settle();
  assert.deepEqual(asked, ["1.2.3.4:8080"]);
  assert.deepEqual(kinds, ["http"]);
  reader.flush();
  await settle();
  assert.deepEqual(asked, ["1.2.3.4:8080"], "once");
});

test("a pasted line is whole, and is asked about at once", async () => {
  const { io, asked } = fake();
  const reader = lineReader(io, () => {}, () => {}, true);
  reader.read("5.6.7.8:3128", true);
  await settle();
  assert.deepEqual(asked, ["5.6.7.8:3128"]);
});

test("a line that names its type is not asked about", async () => {
  const { io, asked } = fake();
  const reader = lineReader(io, () => {}, () => {});
  reader.read("socks5://gw.p.net:1080");
  await settle();
  assert.deepEqual(asked, []);
});

test("only the latest line is answered", async () => {
  const { slow, asked, parses } = fake();
  const got: (Spread | null)[] = [];
  const reader = lineReader(slow, (p) => got.push(p), () => {});
  reader.read("1.1.1.1:1");
  reader.read("2.2.2.2:2");
  // The first line's answer arrives after the second was read: it is dropped.
  parses[1].answer();
  parses[0].answer();
  await settle();
  assert.deepEqual(got.map((p) => p?.host), ["2.2.2.2"]);
  assert.deepEqual(asked, ["2.2.2.2:2"]);
});

test("an emptied box drops what was waiting", async () => {
  const { io, asked } = fake();
  const reader = lineReader(io, () => {}, () => {}, true);
  reader.read("1.2.3.4:80");
  await settle();
  reader.cancel();
  reader.flush();
  await settle();
  assert.deepEqual(asked, []);
});
