// SPDX-License-Identifier: AGPL-3.0-or-later

/** The number the next profile named by `pattern` gets: one past the highest
 *  already taken, so a click never makes a second "Profile 3". Names that do
 *  not fit the pattern are not counted. */
export function nextNumber(names: readonly string[], pattern: string): number {
  const at = pattern.indexOf("{n}");
  if (at < 0) return 1;
  const head = pattern.slice(0, at);
  const tail = pattern.slice(at + 3);
  let top = 0;
  for (const raw of names) {
    const name = raw.trim();
    if (name.length <= head.length + tail.length) continue;
    if (!name.startsWith(head) || !name.endsWith(tail)) continue;
    const digits = name.slice(head.length, name.length - tail.length);
    if (!/^\d{1,9}$/.test(digits)) continue;
    top = Math.max(top, Number(digits));
  }
  return top + 1;
}

/** The lines of a pasted block that are proxies: not blank, not a comment.
 *  The same reading as the agent's `parse_block`, so the count shown before
 *  the click is the count it will try. */
export function proxyLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#") && !l.startsWith("//"));
}

/** The proxy lines of a pasted block with the number each has in the box,
 *  so a line named in a refusal is the line the operator sees. */
export function numberedProxyLines(text: string): { line: number; text: string }[] {
  return text.split("\n").flatMap((raw, i) => proxyLines(raw).map((t) => ({ line: i + 1, text: t })));
}
