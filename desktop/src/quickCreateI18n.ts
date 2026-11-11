// SPDX-License-Identifier: AGPL-3.0-or-later

const en = {
  one: "Quick create", oneTitle: "Create one profile now, with no proxy. Add a proxy later in its settings.",
  batch: "Batch", batchTitle: "Create several at once: how many, how to name them, and a list of proxies",
  name: "Profile {n}", made: "{name} created with no proxy. Add one in its settings before opening it.",
  team: "A team profile needs a proxy. Use Batch and paste one, or New profile.",
  proxies: "Proxies", proxiesHint: "One per line, any common format. The first line goes to the first profile, the second to the second, and so on. A proxy already in the list is used as it is; the rest are saved to the list and not checked.",
  fewer: "{p} proxies for {n} profiles: the remaining {r} get the proxy chosen above, or none.",
  extra: "{p} proxies for {n} profiles: only the first {n} lines are used.",
  exact: "{n} proxies, one for each profile.",
  assigned: "{n} proxies assigned, one per profile in order.",
  rejected: "{n} proxy lines were not understood: their profiles get the proxy chosen above, or none",
  line: "Line {n}",
  unreadable: "Not a proxy line",
} as const;
type Labels = { [K in keyof typeof en]: string };
const zh: Labels = {
  one: "一键创建", oneTitle: "立即创建一个环境，先不配置代理，之后可在设置中补充。",
  batch: "批量", batchTitle: "批量创建：设置数量、命名规则，并粘贴代理列表",
  name: "环境 {n}", made: "已创建“{name}”，尚未配置代理，打开前请在设置中补充。",
  team: "团队环境必须配置代理。请使用“批量”粘贴代理，或使用“新建环境”。",
  proxies: "批量代理", proxiesHint: "每行一个，支持常见格式。第 1 行分配给第 1 个环境，第 2 行给第 2 个，依此类推。代理列表里已有的直接使用，其余保存到代理列表，不做连通性检测。",
  fewer: "{p} 个代理，{n} 个环境：其余 {r} 个使用上方选择的代理，未选择则不配置。",
  extra: "{p} 个代理，{n} 个环境：只使用前 {n} 行。",
  exact: "{n} 个代理，每个环境一个。",
  assigned: "已按顺序分配 {n} 个代理，每个环境一个。",
  rejected: "{n} 行代理无法识别：对应的环境使用上方选择的代理，未选择则不配置",
  line: "第 {n} 行",
  unreadable: "不是代理格式",
};
const ru: Labels = {
  one: "Быстро создать", oneTitle: "Создать один профиль сейчас, без прокси. Прокси можно добавить позже в настройках.",
  batch: "Пачка", batchTitle: "Создать несколько: сколько, как назвать и список прокси",
  name: "Профиль {n}", made: "«{name}» создан без прокси. Добавьте его в настройках перед запуском.",
  team: "Командному профилю нужен прокси. Откройте «Пачка» и вставьте его или используйте «Новый профиль».",
  proxies: "Прокси", proxiesHint: "По одному в строке, в любом распространённом формате. Первая строка — первому профилю, вторая — второму и так далее. Прокси, уже бывший в списке, используется как есть; остальные сохраняются в список и не проверяются.",
  fewer: "Прокси: {p}, профилей: {n}. Остальные {r} получат прокси, выбранный выше, или останутся без него.",
  extra: "Прокси: {p}, профилей: {n}. Используются только первые {n} строк.",
  exact: "Прокси: {n}, по одному на профиль.",
  assigned: "Назначено прокси: {n}, по одному на профиль по порядку.",
  rejected: "Не удалось разобрать строк с прокси: {n}. Их профили получат прокси, выбранный выше, или останутся без него",
  line: "Строка {n}",
  unreadable: "Это не строка прокси",
};
export function quickCreateLabels(language: string): (key: keyof Labels, vars?: Record<string, string | number>) => string {
  const table = language === "zh" ? zh : language === "ru" ? ru : en;
  return (key, vars = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), table[key] as string);
}
