import assert from "node:assert/strict";
import test from "node:test";
import { listFor, loadedAfter, optionsSaver, projectToShow } from "../src/extensionOptions.ts";

test("the project shown follows the local projects there are", () => {
  assert.equal(projectToShow("", []), "");
  assert.equal(projectToShow("", ["a", "b"]), "a", "drawn before the projects loaded");
  assert.equal(projectToShow("b", ["a", "b"]), "b");
  assert.equal(projectToShow("gone", ["a", "b"]), "a", "the selected project was deleted");
  assert.equal(projectToShow("gone", []), "");
});

test("a second change while one is being saved is not sent, and the next is built on the answer", async () => {
  const sent = [];
  let release;
  const send = (next) => {
    sent.push(next);
    return new Promise((resolve) => {
      release = () => resolve(next);
    });
  };
  const saver = optionsSaver(send, { exclusive: false, wipe_storage: false });

  const first = saver.change({ exclusive: true });
  assert.equal(saver.saving(), true);
  // The second tick, before the first has been answered.
  assert.equal(await saver.change({ wipe_storage: true }), null);
  assert.equal(sent.length, 1);
  release();
  assert.deepEqual(await first, { exclusive: true, wipe_storage: false });
  assert.equal(saver.saving(), false);

  // Ticked again once it can be: the first switch is sent as it now is.
  const second = saver.change({ wipe_storage: true });
  release();
  assert.deepEqual(await second, { exclusive: true, wipe_storage: true });
  assert.deepEqual(sent[1], { exclusive: true, wipe_storage: true });
});

test("a save that fails leaves the switches as they were and lets the next one through", async () => {
  let fail = true;
  const saver = optionsSaver(
    (next) => (fail ? Promise.reject(new Error("no agent")) : Promise.resolve(next)),
    { exclusive: false, wipe_storage: false },
  );
  await assert.rejects(saver.change({ exclusive: true }));
  assert.equal(saver.saving(), false);
  assert.deepEqual(saver.latest(), { exclusive: false, wipe_storage: false });
  fail = false;
  saver.seen({ exclusive: false, wipe_storage: true });
  assert.deepEqual(await saver.change({ exclusive: true }), { exclusive: true, wipe_storage: true });
});

test("a list is shown, and can be edited, only for the project it was loaded for", () => {
  const ofA = { projectId: "a", entries: ["x", "y"] };
  assert.deepEqual(listFor("a", ofA), ["x", "y"]);
  // The selection moved to B and B's list has not arrived: nothing to send
  // as B's, rather than A's entries.
  assert.equal(listFor("b", ofA), null);
  assert.equal(listFor("a", null), null);
  assert.deepEqual(listFor("a", { projectId: "a", entries: [] }), [], "an empty list is a list");
});

test("an answer for a project no longer shown changes nothing", () => {
  const ofB = { projectId: "b", entries: ["z"] };
  // A save begun for A answers after the selection moved to B.
  assert.equal(loadedAfter("b", "a", ["x", "y", "new"], ofB), ofB);
  assert.equal(loadedAfter("b", "a", ["x"], null), null, "and B's own list is still on its way");
  // The answer for the project that is shown is kept.
  assert.deepEqual(loadedAfter("b", "b", ["z", "new"], ofB), { projectId: "b", entries: ["z", "new"] });
  assert.deepEqual(loadedAfter("a", "a", [], null), { projectId: "a", entries: [] });
});
