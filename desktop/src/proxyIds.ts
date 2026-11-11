// SPDX-License-Identifier: AGPL-3.0-or-later

import type { api, LocalProxy, Origin } from "./api";

/** What one line became: the proxy it names, or why it names none. */
export interface ProxyFor {
  id: string | null;
  error?: string;
  code?: string;
}

/** The calls `proxiesFor` makes: `api` itself, or a stand-in in a test. */
export interface ProxyIo {
  importProxies: typeof api.importProxies;
  deleteProxy: typeof api.deleteProxy;
}

/** Proxy lines, each to the proxy it means, in the order given.
 *
 *  Shared by the spreadsheet import and the batch dialog, so a line means the
 *  same proxy in both. A line that is the name of a proxy already here is that
 *  proxy. Any other line goes to the same parser the paste dialog uses, once
 *  however often it appears; the same address under a different spelling is
 *  the proxy already here, and the copy the import just made is dropped.
 *
 *  The answer has one entry per line, at the line's own position: an empty
 *  line is `{ id: null }`, and a line the parser refused is `{ id: null,
 *  error }`, so whatever comes after it still lines up with its own row. */
export async function proxiesFor(
  lines: readonly string[],
  opts: { existing: readonly LocalProxy[]; namePrefix: string; origin: Origin; unreadable: string },
  io: ProxyIo,
): Promise<ProxyFor[]> {
  const byName = new Map<string, LocalProxy>(opts.existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const byAddr = new Map<string, LocalProxy>(opts.existing.map((p) => [`${p.host}:${p.port}`, p]));

  const wanted = [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
  const unknown = wanted.filter((w) => !byName.has(w.toLowerCase()));
  const lineToId = new Map<string, string>();
  const lineError = new Map<string, { error: string; code?: string }>();
  if (unknown.length > 0) {
    const imported = await io.importProxies(unknown.join("\n"), opts.namePrefix, opts.origin);
    for (const s of imported.saved) {
      const line = unknown[s.line - 1];
      const existing = byAddr.get(`${s.host}:${s.port}`);
      if (existing) await io.deleteProxy(s.id, opts.origin).catch(() => {});
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
    if (id) return { id };
    return { id: null, ...(lineError.get(line) ?? { error: opts.unreadable }) };
  });
}
