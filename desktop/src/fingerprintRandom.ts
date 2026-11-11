// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MachineOverrides, Persona } from "./api";

/** Draw against the pool's own total: catalogue weights sum to less than one. */
export function pickWeighted(list: Persona[], random: () => number = Math.random): string | undefined {
  if (list.length === 0) return undefined;
  const weight = (p: Persona) => Number.isFinite(p.weight) && p.weight > 0 ? p.weight : 0;
  const total = list.reduce((sum, p) => sum + weight(p), 0);
  if (total <= 0) return list[Math.floor(random() * list.length)]?.id;
  let cursor = random() * total;
  for (const p of list) {
    cursor -= weight(p);
    if (cursor < 0) return p.id;
  }
  return list[list.length - 1]?.id;
}

/** A re-roll keeps an explicitly chosen OS and never selects the same device. */
export function randomFingerprintCandidates(list: Persona[], currentId: string, hostOs: string | null): Persona[] {
  const os = list.find((p) => p.id === currentId)?.os.split(" ")[0] ?? hostOs;
  return list.filter((p) => p.id !== currentId && (os === null || p.os.split(" ")[0] === os));
}

export function randomizeFingerprint(
  list: Persona[],
  currentId: string,
  hostOs: string | null,
  overrides: MachineOverrides,
  random: () => number = Math.random,
): { personaId: string; overrides: MachineOverrides } | null {
  const personaId = pickWeighted(randomFingerprintCandidates(list, currentId, hostOs), random);
  if (!personaId) return null;
  // Old hardware pins would mask the new machine or create an invalid mix.
  // Locale, location and advanced preferences belong to the draft and stay.
  const next = { ...overrides };
  delete next.cores;
  delete next.memory_gb;
  delete next.gpu;
  delete next.screen;
  return { personaId, overrides: next };
}
