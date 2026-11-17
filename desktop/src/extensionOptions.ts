// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

// The parts of the Extensions section's project block that can go wrong
// without anything on screen looking wrong, kept out of the component so that
// tests/extensionOptions.test.mjs can run them: there is no harness here that
// renders a component.

import type { ExtensionOptions } from "./api";

/** A project's list as the agent last gave it, with the project it is of. */
export type LoadedList<E> = { projectId: string; entries: E[] };

/**
 * The list to show and to edit for the project selected: the one loaded, if
 * it is that project's, and otherwise none yet -- which is what disables Add
 * and Remove.
 *
 * The list used to be kept on its own. After the selection moved from A to B
 * it was still A's until B's arrived, and an Add or a Remove in between sent
 * A's entries to the agent as the whole of B's list, which replaced it.
 */
export function listFor<E>(showing: string, loaded: LoadedList<E> | null): E[] | null {
  return loaded !== null && loaded.projectId === showing ? loaded.entries : null;
}

/**
 * What is kept when the agent answers a read or a save that was begun for
 * `answerFor`: the answer, unless another project is shown by now -- then it
 * is somebody else's list arriving late, and what is there stays.
 */
export function loadedAfter<E>(
  showing: string,
  answerFor: string,
  entries: E[],
  loaded: LoadedList<E> | null,
): LoadedList<E> | null {
  return answerFor === showing ? { projectId: answerFor, entries } : loaded;
}

/**
 * Which project the block shows: the one it shows now while that is still a
 * local project, otherwise the first local one, otherwise none.
 *
 * The choice used to be made once, when the section was first drawn. Drawn
 * before the projects had loaded it stayed on "" and the block showed a list
 * for no project; and a project deleted while selected stayed selected.
 */
export function projectToShow(current: string, localIds: string[]): string {
  return localIds.includes(current) ? current : (localIds[0] ?? "");
}

/**
 * Saves the two switches one change at a time.
 *
 * The agent takes both switches in one call, so a change is sent as "what
 * they are now, with this one different". Two ticks a moment apart were each
 * built from what the component had drawn, which for the second was still
 * the state before the first: it sent the first switch back as it had been.
 * Here a change made while another is on its way is refused -- the
 * checkboxes are disabled for that long, and this is what holds if an event
 * arrives anyway -- and each one is built from the agent's last answer.
 */
export function optionsSaver(
  send: (next: ExtensionOptions) => Promise<ExtensionOptions>,
  initial: ExtensionOptions,
) {
  let latest = initial;
  let saving = false;
  return {
    /** What the agent last said, or was last told to be by `seen`. */
    latest: () => latest,
    saving: () => saving,
    /** The agent's own word on the switches, from a read. */
    seen(options: ExtensionOptions) {
      latest = options;
    },
    /** `null` when a save is already on its way and this one was not sent. */
    async change(change: Partial<ExtensionOptions>): Promise<ExtensionOptions | null> {
      if (saving) return null;
      saving = true;
      try {
        latest = await send({ ...latest, ...change });
        return latest;
      } finally {
        saving = false;
      }
    },
  };
}
