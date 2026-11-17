// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

import { IconButton } from "./Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type CatalogueEntry,
  type ExtensionEverywhere,
  type ExtensionOptions,
  type ExtensionSource,
  type Profile,
  type Project,
  type ProjectExtension,
  type StoreInstallResult,
} from "../api";
import { listFor, loadedAfter, optionsSaver, projectToShow, type LoadedList } from "../extensionOptions";
import { useI18n } from "../i18n";

/** Every extension on this machine, which profiles carry it, and a catalogue
 *  to install from.
 *
 *  The per-profile dialog answers "what does this profile have"; this section
 *  answers the question an operator with forty profiles actually asks — "which
 *  of them have the wallet, and which are missing it" — and lets a .crx go into
 *  many at once. Proposed 12.09.2026 after the AdsPower audit (docs/12, 5.30).
 *
 *  The catalogue (5.31) is shared/extensions/catalogue.json: a short list of
 *  Web Store ids. Installing one fetches the package through the proxy of each
 *  profile it goes into and checks the key derives the id (docs/12, decision
 *  B) — the agent does both; this file only asks. Anything not in the list is
 *  reachable by pasting its id or store link. */

/** What the target picker is open for. `copy` takes the extension from one
 *  profile together with its storage, so the copies are signed in. */
type Pick =
  | { mode: "file" }
  | { mode: "folder"; path: string }
  | { mode: "store"; id: string; name: string }
  | { mode: "copy"; id: string; name: string; from: string };

const ID_IN_TEXT = /[a-p]{32}/;
/** A folder as it has to be typed: absolute, on either platform. A store link
 *  starts with a scheme and an id with a letter, so neither is mistaken. */
const IS_PATH = /^(\/|[A-Za-z]:[\\/])/;

export function ExtensionsView({ profiles, projects }: { profiles: Profile[]; projects: Project[] }) {
  const { t, say, resolved } = useI18n();
  const [rows, setRows] = useState<ExtensionEverywhere[] | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which profiles the next install goes into. Starts as every one it can go into:
  // "install everywhere" is the common case, unticking is the exception.
  //
  // Team profiles too, for whoever may edit them -- the rule the extensions
  // button on a profile's row already follows. This screen used to take local
  // profiles only, so a tester whose one profile was a team profile saw every
  // button greyed and no reason, and was told to close profiles he had never
  // opened (08.10.2026).
  const eligible = profiles.filter((p) => p.origin === "local" || p.permissions.includes("edit_profile"));
  const isTeam = (id: string) => profiles.find((p) => p.id === id)?.origin === "team";
  const [targets, setTargets] = useState<Set<string>>(() => new Set(eligible.map((p) => p.id)));
  const [picking, setPicking] = useState<Pick | null>(null);
  const [byId, setById] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState("");
  // A project's list (extsets.rs in the agent). Local projects only: a team
  // project is the server's, and its profiles' extensions come in the bundle.
  const localProjects = projects.filter((p) => p.origin === "local");
  const [projectId, setProjectId] = useState<string>(() => localProjects[0]?.id ?? "");
  // The list with the project it is of, so that it is nobody's while another
  // project's is on its way (extensionOptions.ts).
  const [loaded, setLoaded] = useState<LoadedList<ProjectExtension> | null>(null);
  const given = listFor(projectId, loaded);
  // What is shown now, for an answer that arrives after the selection moved.
  const showing = useRef(projectId);
  showing.current = projectId;
  const [options, setOptions] = useState<ExtensionOptions>({ exclusive: false, wipe_storage: false });
  const [savingOptions, setSavingOptions] = useState(false);
  // One save of the switches at a time, each built on the agent's last answer
  // rather than on what was drawn when the box was ticked (extensionOptions.ts).
  const saver = useRef(optionsSaver((next) => api.setExtensionOptions(next).then((r) => r.options), options)).current;
  const [adding, setAdding] = useState("");

  // The projects arrive after the first draw, and one can be deleted while
  // it is the one shown.
  const localIds = localProjects.map((p) => p.id).join("\n");
  useEffect(() => {
    setProjectId((current) => projectToShow(current, localIds ? localIds.split("\n") : []));
  }, [localIds]);

  useEffect(() => {
    // Nothing to edit until this project's own list is here.
    setLoaded(null);
    if (!projectId) return;
    let stale = false;
    api.projectExtensions(projectId).then(
      (r) => {
        if (stale) return;
        setLoaded((was) => loadedAfter(showing.current, projectId, r.entries, was));
        saver.seen(r.options);
        setOptions(r.options);
      },
      (e) => !stale && setError(say(e)),
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /** An entry as the agent takes it back: what it is, not what it looks like now. */
  const asSource = (e: ProjectExtension): ExtensionSource =>
    e.kind === "folder" ? { kind: "folder", path: e.path ?? "" } : { kind: "store", id: e.id ?? "" };

  const saveGiven = async (next: ExtensionSource[]) => {
    setBusy(true);
    setError(null);
    // The project this save is for, whatever is selected when it answers.
    const savedFor = projectId;
    try {
      const r = await api.setProjectExtensions(savedFor, next);
      if (showing.current !== savedFor) return;
      setLoaded((was) => loadedAfter(showing.current, savedFor, r.entries, was));
      setAdding("");
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  };

  const saveOptions = async (change: Partial<ExtensionOptions>) => {
    if (saver.saving()) return;
    setError(null);
    setSavingOptions(true);
    try {
      const saved = await saver.change(change);
      if (saved) setOptions(saved);
    } catch (e) {
      setError(say(e));
    } finally {
      setSavingOptions(false);
    }
  };

  const addingText = adding.trim();
  const addingSource: ExtensionSource | null = IS_PATH.test(addingText)
    ? { kind: "folder", path: addingText }
    : addingText.match(ID_IN_TEXT)
      ? { kind: "store", id: addingText.match(ID_IN_TEXT)![0] }
      : null;

  const load = useCallback(async () => {
    try {
      setRows(await api.allExtensionsWith(profiles.filter((p) => p.origin === "team").map((p) => ({ id: p.id, name: p.name }))));
      setError(null);
    } catch (e) {
      setError(say(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    api.extensionCatalogue().then(setCatalogue, (e) => setError(say(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** The agent's reasons are stable names; the sentence is ours. */
  const reason = (r: string) => {
    if (r === "proxy_missing") return t("exv.reason.proxy_missing");
    if (r === "not_here") return t("exv.reason.not_here");
    if (r.startsWith("id_mismatch:")) return t("exv.reason.id_mismatch");
    if (r.startsWith("fetch:")) return t("exv.reason.fetch", { detail: r.slice(6) });
    if (r.startsWith("folder:")) return t("exv.reason.folder", { detail: r.slice(7) });
    if (r === "no_source") return t("exv.reason.no_source");
    if (r.startsWith("in_use:")) {
      const [who, machine] = r.slice(7).split("|");
      return t("exv.reason.in_use", { who: who || "?", machine: machine || "?" });
    }
    return r;
  };

  const report = (r: StoreInstallResult | { extension: { name: string } | null; installed: string[]; skipped: { id: string; reason: string }[] }, fallback: string) => {
    const skippedOpen = r.skipped.filter((s) => s.reason === "open").length;
    const others = r.skipped.filter((s) => s.reason !== "open");
    setNote(
      [
        t("exv.installed", { name: r.extension?.name ?? fallback, n: r.installed.length }),
        skippedOpen > 0 ? t("exv.skippedOpen", { n: skippedOpen }) : "",
        others.length > 0 ? others.map((s) => `${nameOf(s.id)}: ${reason(s.reason)}`).join("; ") : "",
        "routes" in r && r.installed.length > 0 ? t("exv.fetchedVia", { n: r.routes }) : "",
        r.installed.some(isTeam) ? t("exv.teamNote") : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  const installFile = async (f: File) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(r.error);
        r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
        r.readAsDataURL(f);
      });
      report(await api.installExtensionMany([...targets], b64), f.name);
      setPicking(null);
      await load();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const installStore = async (id: string, name: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const mine = [...targets].filter((x) => !isTeam(x));
      const team = [...targets].filter(isTeam);
      const a = mine.length > 0 ? await api.installExtensionFromStore(mine, id) : null;
      const b = team.length > 0 ? await api.installExtensionFromStoreTeam(team, id) : null;
      report(
        {
          extension: a?.extension ?? b?.extension ?? null,
          installed: [...(a?.installed ?? []), ...(b?.installed ?? [])],
          skipped: [...(a?.skipped ?? []), ...(b?.skipped ?? [])],
          routes: (a?.routes ?? 0) + (b?.installed.length ?? 0),
        },
        name,
      );
      setPicking(null);
      await load();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  };

  const installFolder = async (path: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      // This machine's profiles only: the folder is on this machine, and a
      // team profile's extensions reach it through its bundle.
      report(await api.installExtensionFolder([...targets].filter((x) => !isTeam(x)), path), path);
      setPicking(null);
      setFolder("");
      await load();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  };

  const update = async (x: ExtensionEverywhere) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.refreshExtension(x.id, x.profiles.map((p) => p.id).filter((id) => !isTeam(id)));
      const skippedOpen = r.skipped.filter((s) => s.reason === "open").length;
      // One sentence per reason rather than per profile: forty profiles with
      // no source is one fact.
      const why = [...new Set(r.skipped.filter((s) => s.reason !== "open").map((s) => reason(s.reason)))];
      setNote(
        [
          t("exv.updated", {
            name: x.name,
            n: r.refreshed.filter((p) => p.changed).length,
            m: r.refreshed.filter((p) => !p.changed).length,
          }),
          skippedOpen > 0 ? t("exv.skippedOpen", { n: skippedOpen }) : "",
          why.join("; "),
        ]
          .filter(Boolean)
          .join(" "),
      );
      await load();
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  };

  const copyWithState = async (p: Extract<Pick, { mode: "copy" }>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.copyExtensionWithState(p.from, p.id, [...targets].filter((x) => x !== p.from));
      const skippedOpen = r.skipped.filter((s) => s.reason === "open").length;
      const others = r.skipped.filter((s) => s.reason !== "open");
      setNote(
        [
          t("exv.copied", { name: r.extension?.name ?? p.name, n: r.installed.length }),
          skippedOpen > 0 ? t("exv.skippedOpen", { n: skippedOpen }) : "",
          others.length > 0 ? others.map((s) => `${nameOf(s.id)}: ${reason(s.reason)}`).join("; ") : "",
          r.installed.some(isTeam) ? t("exv.teamNote") : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      setPicking(null);
      await load();
    } catch (e) {
      const text = say(e);
      setError(
        text.includes("source_open")
          ? t("exv.err.sourceOpen", { name: nameOf(p.from) })
          : text.includes("not_installed")
            ? t("exv.err.notInSource", { name: nameOf(p.from) })
            : text,
      );
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;
  const carriers = (extId: string) => rows?.find((x) => x.id === extId)?.profiles.length ?? 0;
  const targetsWithoutProxy = [...targets].filter((id) => {
    const p = profiles.find((x) => x.id === id);
    return !p?.proxy_id && !p?.proxy;
  }).length;
  const pastedId = byId.match(ID_IN_TEXT)?.[0] ?? null;

  return (
    <>
      <div className="toolbar">
        <button
          className="primary"
          disabled={busy || eligible.length === 0}
          onClick={() => setPicking((v) => (v?.mode === "file" ? null : { mode: "file" }))}
        >
          {t("exv.add")}
        </button>
        <div className="spacer" />
        <IconButton icon="refresh" label={t("bar.refresh")} onClick={() => void load()} />
      </div>

      {picking && (
        <div className="notice" style={{ display: "block" }}>
          {picking.mode === "copy" && (
            <div className="row" style={{ marginBottom: "var(--s-2)" }}>
              <span>{t("exv.copyFrom")}</span>
              <select
                value={picking.from}
                onChange={(e) => setPicking({ ...picking, from: e.target.value })}
                style={{ width: "auto" }}
              >
                {(rows?.find((x) => x.id === picking.id)?.profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{nameOf(p.id)}</option>
                ))}
              </select>
            </div>
          )}
          <p style={{ margin: "0 0 var(--s-2)" }}>
            {t("exv.pickTargets", { n: picking.mode === "copy" ? [...targets].filter((x) => x !== picking.from).length : targets.size })}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2) var(--s-4)", marginBottom: "var(--s-3)" }}>
            {eligible.filter((p) => picking.mode !== "copy" || p.id !== picking.from).map((p) => (
              <label key={p.id} className="row">
                <input
                  type="checkbox"
                  style={{ width: 14, height: 14, accentColor: "var(--accent)" }}
                  checked={targets.has(p.id)}
                  onChange={(e) =>
                    setTargets((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
                <span>{p.name}</span>
                {p.origin === "team" && <span className="muted small">{t("exv.team")}</span>}
                {p.running && <span className="muted small">{t("exv.open")}</span>}
              </label>
            ))}
          </div>
          <div className="row">
            <button className="linky" onClick={() => setTargets(new Set(eligible.map((p) => p.id)))}>{t("exv.all")}</button>
            <button className="linky" onClick={() => setTargets(new Set())}>{t("exv.clear")}</button>
            <div className="spacer" />
            {picking.mode === "file" ? (
              <>
                <input
                  ref={file}
                  type="file"
                  accept=".crx"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void installFile(f);
                  }}
                />
                <button className="primary" disabled={busy || targets.size === 0} onClick={() => file.current?.click()}>
                  {busy ? t("ck.working") : t("exv.chooseFile", { n: targets.size })}
                </button>
              </>
            ) : picking.mode === "folder" ? (
              <button
                className="primary"
                disabled={busy || [...targets].filter((x) => !isTeam(x)).length === 0}
                onClick={() => void installFolder(picking.path)}
              >
                {busy
                  ? t("ck.working")
                  : t("exv.storeTarget", {
                      name: picking.path.split(/[\\/]/).filter(Boolean).pop() ?? picking.path,
                      n: [...targets].filter((x) => !isTeam(x)).length,
                    })}
              </button>
            ) : picking.mode === "store" ? (
              <button
                className="primary"
                disabled={busy || targets.size === 0}
                onClick={() => void installStore(picking.id, picking.name)}
              >
                {busy ? t("ck.working") : t("exv.storeTarget", { name: picking.name, n: targets.size })}
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || [...targets].filter((x) => x !== picking.from).length === 0}
                onClick={() => void copyWithState(picking)}
              >
                {busy
                  ? t("ck.working")
                  : t("exv.copyTarget", { name: picking.name, n: [...targets].filter((x) => x !== picking.from).length })}
              </button>
            )}
            <button className="ghost" disabled={busy} onClick={() => setPicking(null)}>{t("ui.cancel")}</button>
          </div>
          {picking.mode === "store" && targetsWithoutProxy > 0 && (
            <p className="hint warn">{t("exv.noProxyWarn", { n: targetsWithoutProxy })}</p>
          )}
          {picking.mode === "file" && <p className="hint">{t("ext.hint")}</p>}
          {picking.mode === "folder" && <p className="hint" style={{ maxWidth: 720 }}>{t("exv.folderHint")}</p>}
          {picking.mode === "copy" && <p className="hint" style={{ maxWidth: 720 }}>{t("exv.copyHint")}</p>}
        </div>
      )}

      {eligible.length === 0 && <div className="notice">{t("exv.noTargets")}</div>}
      {note && <div className="notice">{note}</div>}
      {error && <div className="notice warnBar">{error}</div>}

      <h2 className="sectionTitle">{t("exv.catalogue")}</h2>
      <p className="hint" style={{ maxWidth: 720 }}>{t("exv.catalogueHint")}</p>
      {catalogue.length > 0 && (
        <table className="grid" style={{ marginBottom: "var(--s-4)" }}>
          <tbody>
            {catalogue.map((c) => {
              const n = carriers(c.id);
              return (
                <tr key={c.id}>
                  <td style={{ minWidth: 180 }}>
                    <div className="name">{c.name}</div>
                    <div className="muted small">
                      {/* A Tauri window has no tab to open; the click goes to the system browser. */}
                      <a
                        href={c.homepage}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          void api.openUrl(c.homepage);
                        }}
                      >
                        {c.homepage.replace(/^https:\/\//, "")}
                      </a>{" "}
                      · {c.licence}
                    </div>
                  </td>
                  <td className="muted" style={{ maxWidth: 420 }}>{resolved === "ru" ? c.summary.ru : c.summary.en}</td>
                  <td className="muted small" style={{ whiteSpace: "nowrap" }}>
                    {n > 0 ? t("exv.inN", { n, m: eligible.length }) : t("exv.notInstalled")}
                  </td>
                  <td className="actions">
                    <button
                      className="ghost"
                      disabled={busy || eligible.length === 0}
                      onClick={() => setPicking({ mode: "store", id: c.id, name: c.name })}
                    >
                      {t("exv.installInto")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginBottom: "var(--s-5)", maxWidth: 720 }}>
        <span className="muted small" style={{ whiteSpace: "nowrap" }}>{t("exv.byId")}</span>
        <input
          value={byId}
          spellCheck={false}
          placeholder="https://chromewebstore.google.com/detail/…/hlkenndednhfkekhgcdicdfddnkalmdm"
          style={{ fontFamily: "var(--mono)", fontSize: 12 }}
          onChange={(e) => setById(e.target.value)}
        />
        <button
          className="ghost"
          disabled={busy || !pastedId || eligible.length === 0}
          onClick={() => pastedId && setPicking({ mode: "store", id: pastedId, name: pastedId.slice(0, 8) + "…" })}
        >
          {t("exv.byIdGo")}
        </button>
      </div>

      <div className="row" style={{ marginBottom: "var(--s-5)", maxWidth: 720 }}>
        <span className="muted small" style={{ whiteSpace: "nowrap" }}>{t("exv.folder")}</span>
        <input
          value={folder}
          spellCheck={false}
          placeholder="/Users/me/dev/my-extension"
          title={t("exv.folderHint")}
          style={{ fontFamily: "var(--mono)", fontSize: 12 }}
          onChange={(e) => setFolder(e.target.value)}
        />
        <button
          className="ghost"
          disabled={busy || !IS_PATH.test(folder.trim()) || eligible.length === 0}
          onClick={() => setPicking({ mode: "folder", path: folder.trim() })}
        >
          {t("exv.folderGo")}
        </button>
      </div>

      {localProjects.length > 0 && (
        <>
          <h2 className="sectionTitle">{t("exv.projects")}</h2>
          <p className="hint" style={{ maxWidth: 720 }}>{t("exv.projectsHint")}</p>
          <div className="row" style={{ marginBottom: "var(--s-2)", maxWidth: 720 }}>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ width: "auto" }}>
              {localProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              value={adding}
              spellCheck={false}
              placeholder={t("exv.projectAddPlaceholder")}
              style={{ fontFamily: "var(--mono)", fontSize: 12 }}
              onChange={(e) => setAdding(e.target.value)}
            />
            <button
              className="ghost"
              disabled={busy || !addingSource || given === null}
              onClick={() => addingSource && void saveGiven([...(given ?? []).map(asSource), addingSource])}
            >
              {t("exv.projectAdd")}
            </button>
          </div>
          {given !== null && given.length === 0 && <p className="empty">{t("exv.projectNone")}</p>}
          {given !== null && given.length > 0 && (
            <table className="grid" style={{ marginBottom: "var(--s-3)" }}>
              <tbody>
                {given.map((g, i) => (
                  <tr key={`${g.kind}:${g.id ?? ""}:${g.path ?? ""}`}>
                    <td style={{ minWidth: 180 }}>
                      <div className="name">
                        {g.name ?? (g.kind === "folder" ? g.path : g.id)} {g.version && <span className="muted">{g.version}</span>}
                      </div>
                      <div className="muted small mono">{g.kind === "folder" ? g.path : g.id}</div>
                    </td>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>
                      {g.kind === "folder" ? t("exv.srcFolder") : t("exv.srcStore")}
                      {g.problem && <span className="warn" title={g.problem}> · {t("exv.projectProblem")}</span>}
                    </td>
                    <td className="actions">
                      <button
                        className="ghost danger"
                        disabled={busy}
                        onClick={() => void saveGiven(given.filter((_, j) => j !== i).map(asSource))}
                      >
                        {t("exv.projectRemove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ display: "grid", gap: "var(--s-2)", marginBottom: "var(--s-5)", maxWidth: 720 }}>
            <label className="row">
              <input
                type="checkbox"
                style={{ width: 14, height: 14, accentColor: "var(--accent)" }}
                checked={options.exclusive}
                disabled={savingOptions}
                onChange={(e) => void saveOptions({ exclusive: e.target.checked })}
              />
              <span>{t("exv.optExclusive")}</span>
            </label>
            <label className="row">
              <input
                type="checkbox"
                style={{ width: 14, height: 14, accentColor: "var(--accent)" }}
                checked={options.wipe_storage}
                disabled={savingOptions}
                onChange={(e) => void saveOptions({ wipe_storage: e.target.checked })}
              />
              <span>{t("exv.optWipe")}</span>
            </label>
          </div>
        </>
      )}

      <h2 className="sectionTitle">{t("exv.extension")}</h2>
      <div className="tableWrap">
        {rows === null ? (
          <p className="empty pad">{t("ext.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="empty pad">{t("exv.none")}</p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>{t("exv.extension")}</th>
                <th>{t("exv.inProfiles")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <div className="name">
                      {x.name} <span className="muted">{x.version}</span>
                    </div>
                    <div className="muted small mono">{x.id}</div>
                  </td>
                  <td>
                    <div className="tags">
                      {x.profiles.map((p) => (
                        <span key={p.id} title={p.version !== x.version ? t("exv.older", { v: p.version }) : undefined}>
                          {nameOf(p.id)}
                          {p.version !== x.version && ` · ${p.version}`}
                        </span>
                      ))}
                    </div>
                    {eligible.length > x.profiles.length && (
                      <div className="muted small" style={{ marginTop: "var(--s-1)" }}>
                        {t("exv.missingFrom", { n: eligible.length - x.profiles.length })}
                      </div>
                    )}
                  </td>
                  <td className="actions">
                    <button className="ghost" disabled={busy} title={t("exv.updateTitle")} onClick={() => void update(x)}>
                      {t("exv.update")}
                    </button>
                    <button
                      className="ghost"
                      disabled={busy || eligible.length < 2}
                      title={t("exv.copyWithLoginTitle")}
                      onClick={() => {
                        // From a profile that is not open, if there is one: an
                        // open source is refused, and starting there is a click
                        // the operator would only have to undo.
                        const from = x.profiles.find((p) => !profiles.find((q) => q.id === p.id)?.running) ?? x.profiles[0];
                        setPicking({ mode: "copy", id: x.id, name: x.name, from: from.id });
                      }}
                    >
                      {t("exv.copyWithLogin")}
                    </button>
                    <button
                      className="ghost danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          for (const p of x.profiles) {
                            await api.removeExtension(p.id, x.id);
                          }
                          setNote(t("exv.removed", { name: x.name, n: x.profiles.length }));
                          await load();
                        } catch (e) {
                          setError(say(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t("exv.removeEverywhere")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
