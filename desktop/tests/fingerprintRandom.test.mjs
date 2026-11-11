import assert from "node:assert/strict";
import test from "node:test";
import { pickWeighted, randomFingerprintCandidates, randomizeFingerprint } from "../src/fingerprintRandom.ts";

const machine = (id, os, weight) => ({ id, os, weight, gpu: id, screen: "1920×1080", source: "measured" });
const catalogue = [
  machine("mac-a", "macOS 15.2", 0.02),
  machine("mac-b", "macOS 14.7", 0.01),
  machine("mac-c", "macOS 15.3", 0.03),
  machine("win-a", "Windows 11", 0.2),
  machine("win-b", "Windows 10", 0.1),
];

test("randomization excludes the current machine and keeps its OS family", () => {
  assert.deepEqual(randomFingerprintCandidates(catalogue, "mac-a", "Windows").map(p => p.id), ["mac-b", "mac-c"]);
  assert.deepEqual(randomFingerprintCandidates(catalogue, "win-a", "macOS").map(p => p.id), ["win-b"]);
});

test("an unselected machine prefers the host OS and can use an unknown host", () => {
  assert.deepEqual(randomFingerprintCandidates(catalogue, "", "macOS").map(p => p.id), ["mac-a", "mac-b", "mac-c"]);
  assert.equal(randomFingerprintCandidates(catalogue, "", null).length, 5);
});

test("no compatible alternative never silently switches to another OS", () => {
  assert.deepEqual(randomFingerprintCandidates([catalogue[0], catalogue[3]], "mac-a", "macOS"), []);
  assert.equal(randomizeFingerprint([], "", "macOS", {}), null);
  assert.equal(randomizeFingerprint([catalogue[0]], "mac-a", "macOS", {}), null);
});

test("weighted draws normalize the catalogue's fractional weights", () => {
  const list = catalogue.slice(1, 3);
  assert.equal(pickWeighted(list, () => 0.24), "mac-b");
  assert.equal(pickWeighted(list, () => 0.26), "mac-c");
  assert.equal(pickWeighted(list, () => 0.99), "mac-c");
  assert.equal(pickWeighted([]), undefined);
});

test("zero-weight custom machines can still be selected", () => {
  const list = [machine("own-a", "macOS 15", 0), machine("own-b", "macOS 15", 0)];
  assert.equal(pickWeighted(list, () => 0.1), "own-a");
  assert.equal(pickWeighted(list, () => 0.9), "own-b");
});

test("randomization resets hardware pins and preserves locale, location and advanced settings", () => {
  const overrides = {
    cores: 4, memory_gb: 8, gpu: "old-gpu",
    screen: { width: 1280, height: 720, device_pixel_ratio: 1 },
    ui_locale: "de-DE", geolocation: { latitude: 52.5, longitude: 13.4 },
    netinfo: { effectiveType: "4g", rtt: 100 }, fonts_hidden: ["Example"], canvas: "real",
  };
  const original = structuredClone(overrides);
  assert.deepEqual(randomizeFingerprint(catalogue, "mac-a", "macOS", overrides, () => 0.99), {
    personaId: "mac-c",
    overrides: {
      ui_locale: "de-DE", geolocation: { latitude: 52.5, longitude: 13.4 },
      netinfo: { effectiveType: "4g", rtt: 100 }, fonts_hidden: ["Example"], canvas: "real",
    },
  });
  assert.deepEqual(overrides, original);
});

test("successive clicks choose another machine even with the same draw", () => {
  const first = randomizeFingerprint(catalogue, "mac-a", "macOS", {}, () => 0);
  assert.equal(first.personaId, "mac-b");
  const second = randomizeFingerprint(catalogue, first.personaId, "macOS", {}, () => 0);
  assert.equal(second.personaId, "mac-a");
});
