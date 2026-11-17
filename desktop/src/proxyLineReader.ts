// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import type { api } from "./api";

/** The fields a pasted line can fill. Everything is optional because a plain
 *  `host:port` fills two of them and `user:pass@host:port` fills four, and a
 *  field the line did not carry is left as the operator had it. */
export interface Spread {
  kind?: string;
  host: string;
  port: string;
  username?: string;
  password?: string;
  /** Which of the parser's shapes the line was, for a form that says so. */
  shape?: string;
}

/** The calls a reader makes: `api` itself, or a stand-in in a test. */
export type LineIo = Pick<typeof api, "parseProxyLine" | "sniffProxyKind">;

/** Reads one proxy line into the fields it fills: the paste into the address
 *  box and the form's one-line box both go through here, so a line is read
 *  one way. In a file of its own, with nothing imported but types, so a test
 *  can drive it without the shell.
 *
 *  `apply` hears the fields, or `null` for a line that is not a proxy.
 *  `onKind`, when given, hears which protocol the address itself answered on,
 *  for a line that did not say -- see `spreadPastedProxy` for why it matters.
 *
 *  Asking means connecting to the address. With `hold`, a line is read but
 *  its address is not asked until `flush`, or unless `read` is told the line
 *  is whole (`now`). A box read as it is typed holds: it asked 700 ms after
 *  the last keystroke until 17.11.2026, and a pause at `1.2.3.4:80` on the
 *  way to `:8080` sent a probe to a port nobody had named.
 *
 *  Only the latest line may be answered: a slow answer about the line before
 *  must not overwrite the one read since. `cancel` drops whatever is pending. */
export function lineReader(
  io: LineIo,
  apply: (found: Spread | null) => void,
  onKind?: (kind: "http" | "socks5") => void,
  hold = false,
) {
  let seq = 0;
  let held: (() => void) | undefined;
  const cancel = () => {
    seq += 1;
    held = undefined;
  };
  const flush = () => {
    const ask = held;
    held = undefined;
    ask?.();
  };
  const read = (text: string, now = !hold) => {
    cancel();
    const mine = seq;
    io.parseProxyLine(text)
      .then((p) => {
        if (mine !== seq) return;
        if (!p) return apply(null);
        apply({
          // The scheme only when the line carried one: `host:port:user:pass`
          // says nothing about the type, and the parser's default is a guess.
          // What the address answers on is found out below.
          kind: p.shape === "Url" ? p.kind : undefined,
          host: p.host,
          port: String(p.port),
          username: p.username ?? undefined,
          password: p.password ?? undefined,
          shape: p.shape,
        });
        if (p.shape === "Url" || !onKind) return;
        const ask = () =>
          io.sniffProxyKind(p.host, p.port)
            .then((r) => {
              if (mine === seq && r.kind) onKind(r.kind);
            })
            // No agent, or it could not tell: the button stays as it was, which
            // is what happened before there was a guess at all.
            .catch(() => {});
        if (now) ask();
        else held = ask;
      })
      .catch(() => {
        if (mine === seq) apply(null);
      });
  };
  return { read, flush, cancel };
}
