import type { MachineOverrides } from "./api";

export type ProfileMode = "quick" | "advanced";
export type ProfileTab = "General" | "Proxy" | "Device" | "Machine" | "Logins" | "Advanced";

export interface ProfileDraftValues {
  where: "local" | "team";
  pickedProject: string;
  proxyMode: "configure" | "saved";
  pxKind: string;
  pxTypedHost: string;
  pxTypedPort: string;
  pxConf: string;
  pxUser: string;
  pxPass: string;
  pxRotate: string;
  pxChecker: string;
  name: string;
  tags: string;
  personaId: string;
  proxyId: string;
  allowNoProxy: boolean;
  timezone: string;
  languages: string;
  overrides: MachineOverrides;
  geoText: string;
  startUrls: string;
  notes: string;
  status: string;
  blocklists: string[];
}

export interface ProxyDraftCheck {
  ok: boolean; error?: string; ip?: string; country?: string;
  city?: string; timezone?: string; ms?: number; error_code?: string | null;
}

/** Memory only: these values may contain proxy credentials. */
export interface ProfileDraft {
  values: ProfileDraftValues;
  baseline: ProfileDraftValues;
  mode: ProfileMode;
  tab: ProfileTab;
  check: ProxyDraftCheck | null;
  sniffed: string | null;
  kindTouched: boolean;
  summaryOpen: boolean;
}

export function makeProfileValues(patch: Partial<ProfileDraftValues> = {}): ProfileDraftValues {
  return {
    where: "local", pickedProject: "", proxyMode: "configure", pxKind: "socks5",
    pxTypedHost: "", pxTypedPort: "", pxConf: "", pxUser: "", pxPass: "",
    pxRotate: "", pxChecker: "", name: "", tags: "", personaId: "", proxyId: "",
    allowNoProxy: false, timezone: "", languages: "", overrides: {}, geoText: "",
    startUrls: "", notes: "", status: "", blocklists: [], ...patch,
  };
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, comparable(v)]));
  }
  return value;
}

export function hasProfileChanges(values: ProfileDraftValues, baseline: ProfileDraftValues): boolean {
  return JSON.stringify(comparable(values)) !== JSON.stringify(comparable(baseline));
}

export function snapshotProfileDraft(draft: ProfileDraft): ProfileDraft {
  return structuredClone(draft);
}

export function withDefaultPersona(values: ProfileDraftValues, personaId: string): ProfileDraftValues {
  return values.personaId ? values : { ...values, personaId };
}
