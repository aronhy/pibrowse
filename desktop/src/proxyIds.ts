// SPDX-License-Identifier: AGPL-3.0-or-later

import type { api, LocalProxy, Origin, ParsedProxyLine } from "./api";

/** What one line became: the proxy it names, or why it names none. */
export interface ProxyFor {
  id: string | null;
  error?: string;
  code?: string;
  /** The proxy was saved by this call, not found in the list. What a caller
   *  whose next step fails has to take back out. */
  made?: boolean;
}

/** The calls `proxiesFor` makes: `api` itself, or a stand-in in a test. */
export interface ProxyIo {
  importProxies: typeof api.importProxies;
  deleteProxy: typeof api.deleteProxy;
  parseProxyLine: typeof api.parseProxyLine;
}

/** Whether a line that parsed to an address already in the list is that
 *  proxy, or another one that happens to sit behind the same address.
 *
 *  The address alone decided this until 17.11.2026, as it had in the
 *  spreadsheet import this was lifted from, where the point was that the same
 *  sheet imported twice does not save every proxy twice. But a rotating
 *  gateway is one `host:port` for every session, told apart by the username:
 *  with `gw.p.net:7000` in the list, ten pasted lines with ten session
 *  usernames were all deleted again and ten profiles got the one old proxy
 *  under its old login, while the dialog said "10 assigned, one per profile".
 *  A line carrying a new password for an old login was dropped the same way.
 *
 *  So: the same login and password, and the same type when the line names
 *  one. A line without a scheme says nothing about the type (the parser's is
 *  a default), so the type already saved stands. A team proxy's login and
 *  password never reach this side (`sealed`), so a line that carries either
 *  cannot be shown to be it and is kept as its own proxy. */
function sameProxy(here: LocalProxy, line: ParsedProxyLine): boolean {
  if (line.shape === "Url" && line.kind !== here.kind) return false;
  const user = line.username ?? "";
  const pass = line.password ?? "";
  if (here.sealed) return user === "" && pass === "";
  return (here.username ?? "") === user && (here.password ?? "") === pass;
}

/** Proxy lines, each to the proxy it means, in the order given.
 *
 *  Shared by the spreadsheet import and the batch dialog, so a line means the
 *  same proxy in both. A line that is the name of a proxy already here is that
 *  proxy. Any other line goes to the same parser the paste dialog uses, once
 *  however often it appears; the same proxy under a different spelling is the
 *  one already here (see `sameProxy` for what "the same" takes), and the copy
 *  the import just made is dropped.
 *
 *  The answer has one entry per line, at the line's own position: an empty
 *  line is `{ id: null }`, and a line the parser refused is `{ id: null,
 *  error }`, so whatever comes after it still lines up with its own row. A
 *  line given twice gets the same proxy twice: `sharedExits` is how a caller
 *  finds that out and says so. */
export async function proxiesFor(
  lines: readonly string[],
  opts: { existing: readonly LocalProxy[]; namePrefix: string; origin: Origin; unreadable: string },
  io: ProxyIo,
): Promise<ProxyFor[]> {
  const byName = new Map<string, LocalProxy>(opts.existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const byAddr = new Map<string, LocalProxy[]>();
  for (const p of opts.existing) {
    const at = `${p.host}:${p.port}`;
    byAddr.set(at, [...(byAddr.get(at) ?? []), p]);
  }

  const wanted = [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
  const unknown = wanted.filter((w) => !byName.has(w.toLowerCase()));
  const lineToId = new Map<string, string>();
  const madeIds = new Set<string>();
  const lineError = new Map<string, { error: string; code?: string }>();
  if (unknown.length > 0) {
    const imported = await io.importProxies(unknown.join("\n"), opts.namePrefix, opts.origin);
    for (const s of imported.saved) {
      const line = unknown[s.line - 1];
      const at = byAddr.get(`${s.host}:${s.port}`);
      // Only an address already here needs the line read again: the import
      // answers with the address and not with the login it saved. A line that
      // cannot be read back is not shown to be the old proxy, so it is kept.
      const parsed = at ? await io.parseProxyLine(line).catch(() => null) : null;
      const existing = parsed ? at?.find((p) => sameProxy(p, parsed)) : undefined;
      if (existing) await io.deleteProxy(s.id, opts.origin).catch(() => {});
      else madeIds.add(s.id);
      lineToId.set(line, existing?.id ?? s.id);
    }
    for (const r of imported.rejected) lineError.set(unknown[r.line - 1], { error: r.error, code: r.code });
  }

  return lines.map((raw) => {
    const line = raw.trim();
    if (!line) return { id: null };
    const named = byName.get(line.toLowerCase());
    if (named) return { id: named.id };
    const id = lineToId.get(line);
    if (id) return madeIds.has(id) ? { id, made: true } : { id };
    return { id: null, ...(lineError.get(line) ?? { error: opts.unreadable }) };
  });
}

/** The positions that were given one and the same thing, in groups of two or
 *  more; `null` and "" are nothing and share nothing.
 *
 *  Over the ids `proxiesFor` answered with, these are the profiles that will
 *  leave through one exit: a line pasted twice, or a proxy named once by its
 *  name and once by its address. The batch does not hand its list round a
 *  second time because two accounts behind one exit is what gets both closed
 *  (agent/src/ipc.rs, `profiles.createMany`), and a repeated line did exactly
 *  that without a word. It may be meant, so it is not refused; it is said. */
export function sharedExits(keys: readonly (string | null | undefined)[]): number[][] {
  const at = new Map<string, number[]>();
  keys.forEach((key, i) => {
    if (!key) return;
    at.set(key, [...(at.get(key) ?? []), i]);
  });
  return [...at.values()].filter((group) => group.length > 1);
}

/** The proxies this call saved that no profile ended up with: every position
 *  that was given one is in `failed`.
 *
 *  The batch saves its proxies before it makes its profiles. When the second
 *  step failed, whole or in part, the first one's proxies stayed in the list
 *  with nothing using them, and the next attempt with the same lines found
 *  them there. A proxy that was in the list before the click is never in the
 *  answer, whoever used it. */
export function unusedProxies(found: readonly ProxyFor[], failed: ReadonlySet<number>): string[] {
  const used = new Set(found.flatMap((f, i) => (f.id && !failed.has(i) ? [f.id] : [])));
  return [...new Set(found.flatMap((f) => (f.made && f.id && !used.has(f.id) ? [f.id] : [])))];
}
