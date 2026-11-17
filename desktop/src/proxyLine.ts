// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import type { ClipboardEvent } from "react";
import { api } from "./api";
import { lineReader, type Spread } from "./proxyLineReader";

export type { Spread };

/** `lineReader` with the shell's own calls: what a component uses. */
export const proxyLineReader = (
  apply: (found: Spread | null) => void,
  onKind?: (kind: "http" | "socks5") => void,
  hold = false,
) => lineReader(api, apply, onKind, hold);

/** A whole proxy line, pasted into the host box.
 *
 *  Suppliers hand out `ip:port:login:pass` on one line and people paste that
 *  whole line into the first field, which is the reasonable thing to do with
 *  it. Before this, the host field then held all four values joined by colons
 *  and the check button said the host did not resolve. Now the line goes to
 *  the same parser the "paste a list" screen uses, and what it finds lands in
 *  the right boxes.
 *
 *  Only on paste, never on every keystroke: `host:1` while somebody is still
 *  typing a port is a valid `host:port` line, and moving the "1" into the port
 *  box mid-word would be the kind of help nobody wants.
 *
 *  Returns a handler for the input's `onPaste`. Everything that is not a line
 *  the parser recognises -- a bare hostname, an IP, anything else -- is pasted
 *  as it always was, so the fallback is a paste, not a refusal.
 *
 *  `onKind`, when given, hears which protocol the address itself answered on,
 *  for a line that did not say. `host:port:user:pass` names none, and keeping
 *  the pressed type button -- SOCKS5 in a fresh form -- saved HTTP proxies as
 *  SOCKS5, where they look exactly like dead ones (23.09.2026, an operator told
 *  his working proxy was "off"). It arrives after the fields, one round trip
 *  later, and only when exactly one protocol answered. */
export function spreadPastedProxy(
  apply: (found: Spread) => void,
  onKind?: (kind: "http" | "socks5") => void,
) {
  // One reader for every paste into this box, so a slow answer about the
  // line pasted before cannot overwrite the one pasted since.
  let asPasted = "";
  // Not a proxy line after all -- give it what the paste would have done.
  const reader = proxyLineReader((found) => apply(found ?? { host: asPasted, port: "" }), onKind);
  return (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").trim();
    // A line with no separator is a hostname and nothing else. Let the
    // browser paste it and do not make a round trip to say so.
    // Spaces, tabs, ';' and '|' separate fields too (`ip port user pass`).
    if (!text || !/[:@\s;|]/.test(text) || text.includes("\n")) return;
    e.preventDefault();
    const input = e.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    asPasted = input.value.slice(0, start) + text + input.value.slice(end);
    reader.read(text);
  };
}
