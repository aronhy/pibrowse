// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Profile } from "./api";

export type ProfileColumn = "project" | "proxy" | "status" | "lastOpened";
export type ProfileSort = "default" | "recent" | "nameAsc" | "nameDesc" | "attention";
export type ProfileQuickFilter = "all" | "recent" | "attention" | "pinned";
export interface ProfileFilters { query: string; tag: string; stage: string; openOnly: boolean; quick: ProfileQuickFilter; sort: ProfileSort; }
export interface SavedProfileView { id: string; name: string; filters: ProfileFilters; columns: ProfileColumn[]; }
export interface ProfileWorkspacePreferences { version: 1; filters: ProfileFilters; columns: ProfileColumn[]; pinned: string[]; views: SavedProfileView[]; activeViewId: string | null; }
export interface ProfileWorkspaceContext { pinned: readonly string[]; attentionIds: ReadonlySet<string>; runningIds: ReadonlySet<string>; now?: number; }

const COLUMN_NAMES: readonly ProfileColumn[] = ["project", "proxy", "status", "lastOpened"];
const SORT_NAMES: readonly ProfileSort[] = ["default", "recent", "nameAsc", "nameDesc", "attention"];
const QUICK_NAMES: readonly ProfileQuickFilter[] = ["all", "recent", "attention", "pinned"];
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export function defaultWorkspacePreferences(): ProfileWorkspacePreferences {
  return {
    version: 1,
    filters: { query: "", tag: "", stage: "", openOnly: false, quick: "all", sort: "default" },
    columns: [...COLUMN_NAMES], pinned: [], views: [], activeViewId: null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}
function filtersFrom(value: unknown): ProfileFilters {
  const v = record(value) ?? {};
  return {
    query: string(v.query, 1000), tag: string(v.tag, 256), stage: string(v.stage, 256),
    openOnly: v.openOnly === true,
    quick: QUICK_NAMES.includes(v.quick as ProfileQuickFilter) ? v.quick as ProfileQuickFilter : "all",
    sort: SORT_NAMES.includes(v.sort as ProfileSort) ? v.sort as ProfileSort : "default",
  };
}
function columnsFrom(value: unknown): ProfileColumn[] {
  if (!Array.isArray(value)) return [...COLUMN_NAMES];
  return [...new Set(value.filter((v): v is ProfileColumn => COLUMN_NAMES.includes(v)))];
}
function matchesView(view: SavedProfileView, filters: ProfileFilters, columns: readonly ProfileColumn[]): boolean {
  return (Object.keys(filters) as (keyof ProfileFilters)[]).every((key) => view.filters[key] === filters[key])
    && view.columns.length === columns.length && view.columns.every((column) => columns.includes(column));
}

/** Read only known list preferences. Neither a broken store nor an older
 *  format may block the list, and arbitrary saved fields never survive. */
export function sanitizeWorkspacePreferences(value: unknown): ProfileWorkspacePreferences {
  const v = record(value);
  if (!v || v.version !== 1) return defaultWorkspacePreferences();
  const views: SavedProfileView[] = [];
  const seenViews = new Set<string>();
  if (Array.isArray(v.views)) {
    for (const raw of v.views.slice(0, 40)) {
      const view = record(raw);
      if (!view) continue;
      const id = string(view.id, 128).trim();
      const name = string(view.name, 80).trim();
      if (!id || !name || seenViews.has(id)) continue;
      seenViews.add(id);
      views.push({ id, name, filters: filtersFrom(view.filters), columns: columnsFrom(view.columns) });
    }
  }
  const filters = filtersFrom(v.filters);
  const columns = columnsFrom(v.columns);
  const activeView = views.find((view) => view.id === v.activeViewId && matchesView(view, filters, columns));
  return {
    version: 1, filters, columns,
    pinned: Array.isArray(v.pinned)
      ? [...new Set(v.pinned.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128))].slice(0, 5000)
      : [],
    views, activeViewId: activeView?.id ?? null,
  };
}

/** Pins affect order only after every filter has matched. Context carries
 *  the owner's verdicts so this module never guesses at locks or failures. */
export function selectWorkspaceProfiles(profiles: readonly Profile[], filters: ProfileFilters, context: ProfileWorkspaceContext): Profile[] {
  const now = context.now ?? Date.now();
  const pinned = new Set(context.pinned);
  const query = filters.query.trim().toLowerCase();
  const stage = filters.stage.trim().toLowerCase();
  const result = profiles.map((profile, index) => ({ profile, index, opened: openedAt(profile) })).filter(({ profile: p, opened }) => {
    if (query && ![p.name, p.persona_id, p.proxy?.display ?? "", ...p.tags, p.notes ?? "", p.project_name ?? "", p.proxy?.country ?? ""].join(" ").toLowerCase().includes(query)) return false;
    if (filters.tag && (filters.tag === "\u0000none" ? p.tags.length !== 0 : !p.tags.includes(filters.tag))) return false;
    const ownStage = (p.status ?? "").trim().toLowerCase();
    if (stage && (stage === "\u0000none" ? ownStage !== "" : ownStage !== stage)) return false;
    if (filters.openOnly && !context.runningIds.has(p.id)) return false;
    if (filters.quick === "pinned" && !pinned.has(p.id)) return false;
    if (filters.quick === "attention" && !context.attentionIds.has(p.id)) return false;
    if (filters.quick === "recent" && (opened === null || opened < now - SEVEN_DAYS || opened > now)) return false;
    return true;
  });
  result.sort((a, b) => {
    const pinOrder = Number(pinned.has(b.profile.id)) - Number(pinned.has(a.profile.id));
    if (pinOrder) return pinOrder;
    let order = 0;
    if (filters.sort === "recent") order = (b.opened ?? -Infinity) - (a.opened ?? -Infinity);
    if (filters.sort === "nameAsc" || filters.sort === "nameDesc") {
      order = a.profile.name.localeCompare(b.profile.name, undefined, { sensitivity: "base", numeric: true });
      if (filters.sort === "nameDesc") order = -order;
    }
    if (filters.sort === "attention") order = Number(context.attentionIds.has(b.profile.id)) - Number(context.attentionIds.has(a.profile.id));
    return order || a.index - b.index;
  });
  return result.map(({ profile }) => profile);
}

function openedAt(profile: Profile): number | null {
  if (!profile.last_opened_at) return null;
  const time = Date.parse(profile.last_opened_at);
  return Number.isFinite(time) ? time : null;
}

/** A hidden selection cannot make the visible list look fully selected. */
export function visibleSelectionState(profiles: readonly Pick<Profile, "id">[], selected: ReadonlySet<string>): { all: boolean; some: boolean } {
  const count = profiles.reduce((n, p) => n + Number(selected.has(p.id)), 0);
  return { all: profiles.length > 0 && count === profiles.length, some: count > 0 };
}

export function restoreWorkspaceView(preferences: ProfileWorkspacePreferences, viewId: string): ProfileWorkspacePreferences {
  const view = preferences.views.find((saved) => saved.id === viewId);
  if (!view) return sanitizeWorkspacePreferences({ ...preferences, activeViewId: null });
  return sanitizeWorkspacePreferences({ ...preferences, filters: { ...view.filters }, columns: [...view.columns], activeViewId: view.id });
}
export function deleteWorkspaceView(preferences: ProfileWorkspacePreferences, viewId: string): ProfileWorkspacePreferences {
  return sanitizeWorkspacePreferences({
    ...preferences, views: preferences.views.filter((view) => view.id !== viewId),
    activeViewId: preferences.activeViewId === viewId ? null : preferences.activeViewId,
  });
}
