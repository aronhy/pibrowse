import assert from "node:assert/strict";
import test from "node:test";
import type { Profile } from "../src/api.ts";
import {
  defaultWorkspacePreferences,
  deleteWorkspaceView,
  restoreWorkspaceView,
  sanitizeWorkspacePreferences,
  selectWorkspaceProfiles,
  visibleSelectionState,
} from "../src/profileWorkspace.ts";

const now = Date.parse("2026-11-11T08:00:00Z");
const day = 24 * 60 * 60 * 1000;
const profile = (id: string, extra: Partial<Profile> = {}): Profile => ({
  id, origin: "local", shared_with: 0, project_id: null, project_name: null,
  name: id, tags: [], persona_id: "win11", fp_seed: 1, proxy: null,
  timezone: null, languages: null, lock: null, permissions: ["launch"],
  running: false, last_opened_at: null, ...extra,
});
const context = (extra = {}) => ({ pinned: [], attentionIds: new Set<string>(), runningIds: new Set<string>(), now, ...extra });
const ids = (rows: Profile[]) => rows.map((p) => p.id);

test("damaged or incompatible stored preferences recover to usable defaults", () => {
  for (const value of [null, false, [], "{broken", { version: 99, pinned: ["secret"] }]) {
    const result = sanitizeWorkspacePreferences(value);
    assert.equal(result.filters.quick, "all");
    assert.equal(result.filters.sort, "default");
    assert.deepEqual(result.columns, ["project", "proxy", "status", "lastOpened"]);
    assert.deepEqual(result.pinned, []);
  }
  const first = defaultWorkspacePreferences();
  first.pinned.push("a");
  assert.deepEqual(defaultWorkspacePreferences().pinned, []);
});

test("stored views and columns are sanitized without retaining unknown fields", () => {
  const result = sanitizeWorkspacePreferences({
    version: 1, filters: { query: "ads", quick: "bogus", sort: "recent", openOnly: "yes" },
    columns: ["proxy", "secret", "proxy"], pinned: ["a", "a", 4, "", "b"],
    views: [null, { id: "", name: "No id" },
      { id: "v1", name: " Campaigns ", filters: { quick: "attention", stage: "\u0000none" }, columns: [], password: "do not retain" },
      { id: "v1", name: "Duplicate", filters: {} },
      { id: "v2", name: "Bad fields", filters: { query: 2, openOnly: true }, columns: ["status", "bad"] }],
    password: "do not retain",
  });
  assert.deepEqual(result.pinned, ["a", "b"]);
  assert.deepEqual(result.columns, ["proxy"]);
  assert.equal(result.filters.quick, "all");
  assert.equal(result.filters.openOnly, false);
  assert.equal(result.filters.sort, "recent");
  assert.equal(result.views.length, 2);
  assert.equal(result.views[0].name, "Campaigns");
  assert.equal(result.views[0].filters.stage, "\u0000none");
  assert.deepEqual(result.views[0].columns, []);
  assert.equal(result.views[1].filters.query, "");
  assert.equal(result.views[1].filters.openOnly, true);
  assert.deepEqual(result.views[1].columns, ["status"]);
  assert.equal(JSON.stringify(result).includes("do not retain"), false);
  assert.deepEqual(sanitizeWorkspacePreferences(JSON.parse(JSON.stringify(result))), result);
});

test("pinning stays inside active search, tag and stage filters", () => {
  const rows = [profile("a", { name: "Ads one", tags: ["work"], status: "Ready" }),
    profile("b", { name: "Other", tags: ["work"], status: "ready" }),
    profile("c", { name: "Ads two", tags: ["work"], status: "ready" })];
  const filters = { ...defaultWorkspacePreferences().filters, query: "ads", tag: "work", stage: "ready" };
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, filters, context({ pinned: ["b", "c"] }))), ["c", "a"]);
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, quick: "pinned" }, context({ pinned: ["b", "c"] }))), ["c"]);
  assert.deepEqual(rows.map((p) => p.id), ["a", "b", "c"]);
});

test("recent means the last seven days including the boundary, excluding invalid and future dates", () => {
  const rows = [profile("edge", { last_opened_at: new Date(now - 7 * day).toISOString() }),
    profile("old", { last_opened_at: new Date(now - 7 * day - 1).toISOString() }),
    profile("invalid", { last_opened_at: "not a date" }), profile("never"),
    profile("future", { last_opened_at: new Date(now + 1).toISOString() }),
    profile("today", { last_opened_at: new Date(now).toISOString() })];
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...defaultWorkspacePreferences().filters, quick: "recent" }, context())), ["edge", "today"]);
});

test("search includes existing fields plus notes, project and proxy country", () => {
  const rows = [profile("a", { notes: "Launch supplier" }), profile("b", { project_name: "Supplier outreach" }),
    profile("c", { proxy: { id: "px", name: "US exit", kind: "socks5", display: "socks5://example", country: "US" } }),
    profile("d", { tags: ["Supplier"] }), profile("e", { persona_id: "supplier-device" })];
  const filters = defaultWorkspacePreferences().filters;
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, query: " supplier " }, context())), ["a", "b", "d", "e"]);
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, query: "us" }, context())), ["c"]);
});

test("attention and running filters use supplied ids rather than treating team locks as problems", () => {
  const rows = [profile("a"), profile("b", { running: true }), profile("c")];
  const filters = defaultWorkspacePreferences().filters;
  const ctx = context({ attentionIds: new Set(["c"]), runningIds: new Set(["a"]) });
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, quick: "attention" }, ctx)), ["c"]);
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, openOnly: true }, ctx)), ["a"]);
});

test("none sentinels preserve profiles without tags or a stage", () => {
  const rows = [profile("a"), profile("b", { tags: ["work"] }), profile("c", { status: "ready" }), profile("d", { status: "  " })];
  const filters = { ...defaultWorkspacePreferences().filters, tag: "\u0000none", stage: "\u0000none" };
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, filters, context())), ["a", "d"]);
});

test("sorting is stable for equal names, dates and attention while pins precede matches", () => {
  const rows = [profile("a", { name: "Beta" }), profile("b", { name: "Alpha" }), profile("c", { name: "Alpha" }),
    profile("d", { name: "Zulu", last_opened_at: "2026-11-10T08:00:00Z" })];
  const filters = defaultWorkspacePreferences().filters;
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, sort: "nameAsc" }, context())), ["b", "c", "a", "d"]);
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, sort: "nameDesc" }, context())), ["d", "a", "b", "c"]);
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, sort: "recent" }, context())), ["d", "a", "b", "c"]);
  assert.deepEqual(ids(selectWorkspaceProfiles(rows, { ...filters, sort: "attention" }, context({ pinned: ["a"], attentionIds: new Set(["b", "c"]) }))), ["a", "b", "c", "d"]);
});

test("select all compares visible ids, not unrelated selection counts", () => {
  const rows = [profile("a"), profile("b")];
  assert.deepEqual(visibleSelectionState(rows, new Set(["a", "hidden"])), { all: false, some: true });
  assert.deepEqual(visibleSelectionState(rows, new Set(["a", "b", "hidden"])), { all: true, some: true });
  assert.deepEqual(visibleSelectionState(rows, new Set(["x", "y"])), { all: false, some: false });
  assert.deepEqual(visibleSelectionState([], new Set(["a"])), { all: false, some: false });
});

test("identical saved views keep their own identity when restored and deleted", () => {
  const base = defaultWorkspacePreferences();
  const preferences = sanitizeWorkspacePreferences({ ...base, views: [
    { id: "a", name: "A", filters: { ...base.filters }, columns: [...base.columns] },
    { id: "b", name: "B", filters: { ...base.filters }, columns: [...base.columns] },
  ] });
  const restoredB = restoreWorkspaceView(preferences, "b");
  assert.equal(restoredB.activeViewId, "b");
  assert.equal(sanitizeWorkspacePreferences(restoredB).activeViewId, "b");
  const withoutA = deleteWorkspaceView(restoredB, "a");
  assert.deepEqual(withoutA.views.map((v) => v.id), ["b"]);
  assert.equal(withoutA.activeViewId, "b");
  const withoutB = deleteWorkspaceView(restoredB, "b");
  assert.deepEqual(withoutB.views.map((v) => v.id), ["a"]);
  assert.equal(withoutB.activeViewId, null);
});

test("editing saved view filters or columns makes it custom without deleting the saved view", () => {
  const base = defaultWorkspacePreferences();
  const preferences = restoreWorkspaceView(sanitizeWorkspacePreferences({ ...base, views: [
    { id: "a", name: "A", filters: { ...base.filters }, columns: [...base.columns] },
  ] }), "a");
  assert.equal(sanitizeWorkspacePreferences({ ...preferences, filters: { ...preferences.filters, query: "new" } }).activeViewId, null);
  assert.equal(sanitizeWorkspacePreferences({ ...preferences, columns: ["status"] }).activeViewId, null);
  assert.equal(sanitizeWorkspacePreferences({ ...preferences, pinned: ["profile"] }).activeViewId, "a");
  assert.equal(sanitizeWorkspacePreferences({ ...preferences, activeViewId: "missing" }).activeViewId, null);
  assert.equal(sanitizeWorkspacePreferences({ ...preferences, activeViewId: 2 }).activeViewId, null);
  assert.equal(restoreWorkspaceView(preferences, "missing").activeViewId, null);
  assert.equal(sanitizeWorkspacePreferences(preferences).views.length, 1);
  assert.equal(defaultWorkspacePreferences().activeViewId, null);
});
