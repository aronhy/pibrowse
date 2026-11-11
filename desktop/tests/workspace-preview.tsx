// This entry renders the real app against in-memory fixtures. Every API method
// is replaced before mounting, including methods this fixture does not support.
// Never import this entry from production sources or add it to the build input.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import {
  api,
  ApiError,
  type LocalProxy,
  type ParsedProxyLine,
  type Persona,
  type Preview,
  type Profile,
  type Project,
  type Shell,
} from "../src/api";
import "../src/styles.css";

if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.port !== "5274") {
  throw new Error("WORKSPACE_PREVIEW_ISOLATION: serve this fixture on http://127.0.0.1:5274 only.");
}

document.title = "隔离验收 · Fury 环境工作台";
localStorage.setItem("fury.language", "zh");
// Only the language preference is set. Existing list preferences are preserved
// so a reload can verify persistence. No clear(), token reads, or real secrets.
const params = new URLSearchParams(location.search);
const clone = <T,>(value: T): T => structuredClone(value);
const now = Date.now();
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();

const personas: Persona[] = [
  { id: "fixture-mac-m2", os: "macOS 14.7", gpu: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", screen: "1512 × 982", weight: 0.4, source: "Measured desktop", own: false },
  { id: "fixture-mac-m3", os: "macOS 15.1", gpu: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)", screen: "1728 × 1117", weight: 0.3, source: "Measured desktop", own: false },
  { id: "fixture-win-iris", os: "Windows 11", gpu: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", screen: "1920 × 1080", weight: 0.2, source: "Measured desktop", own: false },
  { id: "fixture-win-rtx", os: "Windows 11", gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)", screen: "2560 × 1440", weight: 0.1, source: "Measured desktop", own: false },
];

const proxies: LocalProxy[] = [
  { id: "fixture-proxy-us", name: "美国住宅出口", kind: "socks5", host: "192.0.2.10", port: 1080, username: "fixture_user_us", password: "fixture_password_us", last_country: "US", last_ip: "198.51.100.10", last_timezone: "America/New_York", rotate_url: null, checker_url: null },
  { id: "fixture-proxy-de", name: "德国住宅出口", kind: "http", host: "192.0.2.20", port: 8080, username: "fixture_user_de", password: "fixture_password_de", last_country: "DE", last_ip: "198.51.100.20", last_timezone: "Europe/Berlin", rotate_url: null, checker_url: null },
];

const proxySummary = (id?: string | null): Profile["proxy"] => {
  const p = proxies.find((proxy) => proxy.id === id);
  return p ? { id: p.id, name: p.name, kind: p.kind, display: `${p.host}:${p.port}`, country: p.last_country, last_timezone: p.last_timezone } : null;
};

const projectNames = new Map([["fixture-project-marketing", "海外投放"], ["fixture-project-commerce", "店铺运营"]]);
const profile = (id: string, name: string, extra: Partial<Profile> = {}): Profile => ({
  id,
  name,
  origin: "local",
  shared_with: 0,
  project_id: "fixture-project-marketing",
  project_name: "海外投放",
  notes: "",
  start_urls: ["https://example.com/"],
  status: "ready",
  tags: [],
  persona_id: "fixture-mac-m2",
  fp_seed: 123456,
  proxy: null,
  proxy_id: null,
  allow_no_proxy: true,
  timezone: null,
  languages: null,
  overrides: {},
  blocklists: [],
  lock: null,
  permissions: ["view", "launch", "edit_profile", "edit_fingerprint", "edit_proxy", "reveal_secrets", "export_cookies", "create_profile", "delete_profile", "manage_access"],
  running: false,
  last_opened_at: null,
  ...extra,
});

const rows: Profile[] = [
  profile("fixture-01", "Meta 美国主号", { tags: ["Meta", "主号"], status: "working", proxy: proxySummary(proxies[0].id), proxy_id: proxies[0].id, allow_no_proxy: false, running: true, last_opened_at: ago(1 / 24) }),
  profile("fixture-02", "TikTok 德国账号", { tags: ["TikTok"], proxy: proxySummary(proxies[1].id), proxy_id: proxies[1].id, allow_no_proxy: false, last_opened_at: ago(2) }),
  profile("fixture-03", "Facebook 受限账号", { tags: ["Meta"], status: "limited", proxy: proxySummary(proxies[0].id), proxy_id: proxies[0].id, allow_no_proxy: false, last_opened_at: ago(3) }),
  profile("fixture-04", "Google 已停用账号", { tags: ["Google"], status: "banned", last_opened_at: ago(9) }),
  profile("fixture-05", "店铺资料保存失败", { project_id: "fixture-project-commerce", project_name: "店铺运营", tags: ["店铺"], status: "paused", last_opened_at: ago(5) }),
  profile("fixture-06", "欧洲店铺时区待调整", { project_id: "fixture-project-commerce", project_name: "店铺运营", tags: ["店铺", "欧洲"], proxy: proxySummary(proxies[1].id), proxy_id: proxies[1].id, allow_no_proxy: false, timezone: "Asia/Tokyo", last_opened_at: ago(8) }),
  profile("fixture-07", "新建待登录店铺", { project_id: "fixture-project-commerce", project_name: "店铺运营", tags: ["店铺"], status: "new" }),
  profile("fixture-08", "归档备用环境", { project_id: "fixture-project-commerce", project_name: "店铺运营", last_opened_at: ago(60) }),
];

const requestedRows = Number(params.get("rows") || "8");
const rowCount = Number.isFinite(requestedRows) ? Math.max(8, Math.min(2000, Math.trunc(requestedRows))) : 8;
for (let i = rows.length; i < rowCount; i++) {
  const projectId = i % 2 ? "fixture-project-commerce" : "fixture-project-marketing";
  rows.push(profile(`fixture-${String(i + 1).padStart(3, "0")}`, `运营环境 ${String(i + 1).padStart(3, "0")}`, {
    project_id: projectId,
    project_name: projectNames.get(projectId)!,
    tags: [i % 2 ? "店铺" : "投放"],
    status: i % 15 === 0 ? "limited" : "ready",
    last_opened_at: i % 9 === 0 ? null : ago(i % 30),
  }));
}

const shell: Shell = {
  mode: "local",
  server_url: null,
  machine_name: "Mac Studio",
  signed_in: false,
  native: false,
  agent_ready: true,
  core_ready: true,
  core_problem: null,
  core_outdated: null,
  core_stale: null,
  core_download: null,
  profile_operations: {},
  profile_saves: { "fixture-05": { saved_at: null, failed: true } },
  remember_org_key: false,
  version: "0.5.3",
  org_key_ready: true,
  last_email: null,
  last_server: null,
  awaiting_key: false,
  log_file: "/fixture/logs/desktop.log",
};

type ApiCall = { method: string; args: unknown[]; at: number };
const fixture = {
  calls: [] as ApiCall[],
  savedProfiles: [] as unknown[],
  savedProxies: [] as unknown[],
  rejectedMethods: [] as string[],
  rows,
  proxies,
  failNextSave: params.get("failSave") === "1",
};
declare global {
  interface Window { __workspacePreview: typeof fixture; }
}
window.__workspacePreview = fixture;

const makePreview = (spec: Parameters<typeof api.preview>[0]): Preview => {
  const persona = personas.find((p) => p.id === spec.persona_id) ?? personas[0];
  const mac = persona.os.startsWith("macOS");
  const ov = spec.overrides ?? {};
  const screen: [number, number] = mac ? [1512, 982] : [1920, 1080];
  return {
    user_agent: mac ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    platform: mac ? "MacIntel" : "Win32",
    languages: spec.languages ?? ["en-US", "en"],
    timezone: spec.timezone ?? "America/New_York",
    hardware_concurrency: ov.cores ?? 8,
    device_memory: ov.memory_gb ?? 8,
    screen: ov.screen ? `${ov.screen.width} × ${ov.screen.height}` : `${screen[0]} × ${screen[1]}`,
    gpu_vendor: mac ? "Google Inc. (Apple)" : "Google Inc. (Intel)",
    gpu_renderer: personas.find((p) => p.id === ov.gpu)?.gpu ?? persona.gpu,
    client_hints_platform: mac ? "macOS" : "Windows",
    chrome_version: "140.0.7339.80",
    client_hints: '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    avail: `${screen[0]} × ${screen[1] - 25}`,
    device_pixel_ratio: ov.screen?.device_pixel_ratio ?? (mac ? 2 : 1),
    color_depth: 24,
    max_touch_points: 0,
    webgpu: mac ? "Apple M2" : "Intel Iris Xe",
    webgl_extensions: 35,
    audio_sample_rate: 48000,
    voices: 20,
    media_devices: "1 microphone, 1 camera, 1 speaker",
    ui_locale: ov.ui_locale ?? "en-US",
    webrtc: "proxy",
    js_heap_gb: 4,
    persona_source: persona.source,
    persona_weight: persona.weight,
    fonts: mac ? 98 : 121,
    noise: { canvas: ov.canvas !== "real", audio: true, client_rects: true },
    problems: [],
    options: {
      screens: [screen, [1920, 1080], [2560, 1440]],
      device_pixel_ratios: [1, 1.25, 1.5, 2],
      cores: [4, 8, 10, 12, 16],
      memory_gb: [4, 8, 16],
      gpus: personas.filter((p) => p.os.startsWith(mac ? "macOS" : "Windows")).map((p) => ({ id: p.id, renderer: p.gpu })),
      ui_locales: ["en-US", "zh-CN", "de-DE"],
    },
    base: { screen, device_pixel_ratio: mac ? 2 : 1, cores: 8, memory_gb: 8, gpu: persona.gpu },
    geolocation: ov.geolocation ?? null,
  };
};

function parseProxyLine(line: string): ParsedProxyLine | null {
  const value = line.trim();
  try {
    if (value.includes("://")) {
      const url = new URL(value);
      if (!["http:", "https:", "socks5:"].includes(url.protocol)) return null;
      const port = Number(url.port);
      if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) return null;
      return { kind: url.protocol.slice(0, -1), host: url.hostname, port, username: decodeURIComponent(url.username) || null, password: decodeURIComponent(url.password) || null, shape: "Url" };
    }
    const at = /^(?:([^:@]+):([^@]*)@)?([^:\s]+):(\d+)$/.exec(value);
    if (at) return { kind: "socks5", host: at[3], port: Number(at[4]), username: at[1] ?? null, password: at[2] ?? null, shape: at[1] ? "AtSign" : "HostPort" };
    const fields = /^([^:\s]+):(\d+):([^:]+):(.*)$/.exec(value);
    if (fields) return { kind: "socks5", host: fields[1], port: Number(fields[2]), username: fields[3], password: fields[4], shape: "HostPortUserPass" };
  } catch { /* Invalid fixture input follows the normal paste fallback. */ }
  return null;
}

// Fail closed for all methods, even APIs added after this fixture was written.
Object.assign(api, Object.fromEntries(Object.keys(api).map((method) => [method, async (...args: unknown[]) => {
  fixture.calls.push({ method, args: clone(args), at: Date.now() });
  fixture.rejectedMethods.push(method);
  throw new ApiError(0, `WORKSPACE_PREVIEW_UNSTUBBED_API: ${method}`);
}])));

const stubs = {
  shell: async () => clone(shell),
  projects: async (): Promise<Project[]> => [...projectNames].map(([id, name]) => ({ id, name, origin: "local", profile_count: rows.filter((p) => p.project_id === id).length })),
  profiles: async (projectId?: string) => clone(projectId ? rows.filter((p) => p.project_id === projectId) : rows),
  personas: async () => clone(personas),
  proxies: async () => clone(proxies),
  openUrl: async (url: string) => {
    // The UI can verify destinations through a DOM attribute without opening
    // a real merchant page or exposing fixture internals to browser tooling.
    document.documentElement.dataset.previewOpenedUrl = url;
  },
  blocklists: async () => [{ name: "常规屏蔽", domains: 12, allow_only: false, local: false }],
  checkUpdate: async () => ({ current: "0.5.3", latest: "0.5.3", url: null, download: null, notes: null, status: "current" as const, message: null }),
  warmStatus: async () => [],
  farmDue: async () => [],
  farmList: async () => ({ now_ms: Date.now(), farms: [] }),
  mirrorStatus: async () => ({ active: false, typing: false, members: [], mirrored: 0 }),
  preview: async (spec: Parameters<typeof api.preview>[0]) => clone(makePreview(spec)),
  credentials: async () => [],
  parseProxyLine: async (line: string) => parseProxyLine(line),
  sniffProxyKind: async () => ({ kind: null }),
  checkProxy: async () => ({ ok: true, ip: "198.51.100.25", country: "US", city: "New York", timezone: "America/New_York", ms: 120 }),
  saveProxy: async (input: Partial<LocalProxy>) => {
    const id = input.id || `fixture-proxy-created-${fixture.savedProxies.length + 1}`;
    const result: LocalProxy = { name: "新建代理", kind: "socks5", host: "192.0.2.30", port: 1080, username: null, password: null, last_country: null, last_ip: null, rotate_url: null, checker_url: null, ...clone(input), id };
    const index = proxies.findIndex((p) => p.id === id);
    if (index >= 0) proxies[index] = result;
    else proxies.push(result);
    fixture.savedProxies.push(clone(input));
    return { id };
  },
  saveProfile: async (input: unknown, origin?: Profile["origin"]) => {
    fixture.savedProfiles.push(clone(input));
    if (fixture.failNextSave) {
      fixture.failNextSave = false;
      throw new ApiError(0, "环境暂时无法保存，请重试。");
    }
    const payload = input as Partial<Profile>;
    const id = payload.id || `fixture-created-${fixture.savedProfiles.length}`;
    const index = rows.findIndex((p) => p.id === id);
    const prior = rows[index];
    const updated = profile(id, payload.name || "Untitled", {
      ...prior,
      ...clone(payload),
      id,
      origin: origin ?? prior?.origin ?? "local",
      project_name: payload.project_id ? projectNames.get(payload.project_id) ?? null : null,
      proxy: proxySummary(payload.proxy_id),
      fp_seed: payload.fp_seed || prior?.fp_seed || 987654,
    });
    if (index >= 0) rows[index] = updated;
    else rows.push(updated);
    if (shell.profile_saves) delete shell.profile_saves[id];
    return { id };
  },
  launch: async (id: string) => {
    const row = rows.find((p) => p.id === id);
    if (row) { row.running = true; row.last_opened_at = new Date().toISOString(); }
    return { launched: true, pid: 4242 };
  },
  stop: async (id: string) => { const row = rows.find((p) => p.id === id); if (row) row.running = false; },
} satisfies Partial<typeof api>;

Object.assign(api, Object.fromEntries(Object.entries(stubs).map(([method, implementation]) => [method, async (...args: unknown[]) => {
  fixture.calls.push({ method, args: clone(args), at: Date.now() });
  return (implementation as (...values: unknown[]) => Promise<unknown>)(...args);
}])));

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
