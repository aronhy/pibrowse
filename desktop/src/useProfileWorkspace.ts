// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import {
  defaultWorkspacePreferences,
  sanitizeWorkspacePreferences,
  type ProfileWorkspacePreferences,
} from "./profileWorkspace";

/** List preferences belong to one account on one server. Nothing in this
 * storage contains profile bodies, proxy credentials or unsaved form data. */
export function useProfileWorkspace(scope: string | null) {
  const key = scope === null ? null : `pibrowse.profileWorkspace.v1:${scope}`;
  const read = (storageKey: string | null): ProfileWorkspacePreferences => {
    if (storageKey === null) return defaultWorkspacePreferences();
    try {
      return sanitizeWorkspacePreferences(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
    } catch {
      return defaultWorkspacePreferences();
    }
  };
  const [snapshot, setSnapshot] = useState(() => ({ key, value: read(key) }));
  // Do not display the previous account's saved views during a scope change.
  const preferences = snapshot.key === key ? snapshot.value : read(key);
  useEffect(() => {
    setSnapshot({ key, value: read(key) });
  }, [key]);

  const updatePreferences = (value: ProfileWorkspacePreferences) => {
    const next = sanitizeWorkspacePreferences(value);
    setSnapshot({ key, value: next });
    if (key !== null) {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage can be disabled or full. Controls still work in this window.
      }
    }
  };

  return { preferences, updatePreferences };
}
