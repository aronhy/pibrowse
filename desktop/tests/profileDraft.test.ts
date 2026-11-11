// SPDX-License-Identifier: AGPL-3.0-or-later

import test from "node:test";
import assert from "node:assert/strict";
import { hasProfileChanges, makeProfileValues, snapshotProfileDraft, withDefaultPersona } from "../src/profileDraft.ts";

test("dirty protection covers ordinary, advanced and secret fields", () => {
  const baseline = makeProfileValues();
  for (const patch of [
    { name: "Store A" }, { notes: "Keep this account" }, { startUrls: "https://example.com" },
    { pxPass: "secret" }, { pxConf: "[Interface]\nPrivateKey=private" },
    { pxRotate: "https://proxy.example/rotate?key=secret" }, { proxyId: "saved-proxy" },
    { proxyMode: "saved" as const }, { allowNoProxy: true }, { where: "team" as const },
    { pickedProject: "team-a" }, { tags: "client" }, { status: "active" },
    { personaId: "mac-1" }, { timezone: "Asia/Hong_Kong" }, { languages: "zh-HK" },
    { overrides: { hardware_concurrency: 8 } }, { geoText: "22.3,114.2" }, { blocklists: ["ads"] },
  ]) assert.equal(hasProfileChanges(makeProfileValues(patch), baseline), true, JSON.stringify(Object.keys(patch)));
});

test("reverting fields and automatic device initialization do not trigger dirty protection", () => {
  const baseline = withDefaultPersona(makeProfileValues(), "mac-default");
  assert.equal(baseline.personaId, "mac-default");
  const values = withDefaultPersona(makeProfileValues(), "mac-default");
  assert.equal(hasProfileChanges(values, baseline), false);
  assert.equal(hasProfileChanges({ ...values, name: "Changed" }, baseline), true);
  assert.equal(hasProfileChanges({ ...values, name: "" }, baseline), false);
  assert.equal(withDefaultPersona({ ...values, personaId: "user-choice" }, "other").personaId, "user-choice");
});

test("geolocation initialization and object key order are semantically unchanged", () => {
  const baseline = makeProfileValues({ overrides: { hardware_concurrency: 8, device_memory: 16 } });
  const values = makeProfileValues({ overrides: { device_memory: 16, geolocation: undefined, hardware_concurrency: 8 } });
  assert.equal(hasProfileChanges(values, baseline), false);
});

test("retained draft detaches nested fields and preserves its original baseline", () => {
  const baseline = makeProfileValues({ name: "Original", personaId: "mac-default" });
  const values = makeProfileValues({ name: "Typed name", pxPass: "secret", pxConf: "private config", pxRotate: "private rotation", overrides: { fonts_hidden: ["Font A"] }, blocklists: ["ads"] });
  const draft = snapshotProfileDraft({ values, baseline, mode: "quick", tab: "Proxy", check: { ok: true, ip: "192.0.2.1" }, sniffed: "http", kindTouched: true, summaryOpen: false });
  values.overrides.fonts_hidden!.push("Font B");
  values.blocklists.push("tracking");
  values.pxPass = "changed";
  baseline.name = "mutated";
  assert.deepEqual(draft.values.overrides.fonts_hidden, ["Font A"]);
  assert.deepEqual(draft.values.blocklists, ["ads"]);
  assert.equal(draft.values.pxPass, "secret");
  assert.equal(draft.values.pxConf, "private config");
  assert.equal(draft.values.pxRotate, "private rotation");
  assert.equal(draft.baseline.name, "Original");
  assert.equal(hasProfileChanges(draft.values, draft.baseline), true);
  draft.mode = "advanced";
  assert.equal(hasProfileChanges(draft.values, draft.baseline), true);
});
