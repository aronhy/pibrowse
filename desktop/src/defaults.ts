// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

/** A hosted endpoint supplied by the distributor. Saved team addresses take precedence. */
export const DEFAULT_SERVER = (import.meta.env.VITE_PIBROWSE_TEAM_SERVER ?? "").trim();

/** Public product site for invitation messages. */
export const PRODUCT_SITE = (import.meta.env.VITE_PIBROWSE_SITE ?? "https://pibrowse.dev").trim();

export const OUR_SERVERS: string[] = (() => {
  try {
    return DEFAULT_SERVER ? [new URL(DEFAULT_SERVER.includes("://") ? DEFAULT_SERVER : `https://${DEFAULT_SERVER}`).hostname] : [];
  } catch {
    return [];
  }
})();

/** `a` is a newer dotted version than `b`. Numeric, so 0.10.0 beats 0.9.0;
 *  a leading v and a pre-release suffix are ignored, as in src-tauri/update.rs. */
export function versionNewer(a: string, b: string): boolean {
  const parts = (v: string) =>
    v.replace(/^[vV]/, "").split(/[-+]/)[0].split(".").map((p) => parseInt(p, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}
