// SPDX-License-Identifier: AGPL-3.0-or-later

const en = {
  label: "Quick fill",
  hint: "Paste or type the whole proxy on one line; the fields below are filled from it.",
  readAs: "Read as {shape}. Check the fields below.",
  bad: "Not recognised as a proxy. Fill in the fields below by hand.",
} as const;
type Labels = { [K in keyof typeof en]: string };
const zh: Labels = {
  label: "一键输入",
  hint: "把整条代理粘贴或输入在这一行，会自动解析并填入下面各项。",
  readAs: "已按“{shape}”解析，请核对下面各项。",
  bad: "无法识别为代理，请在下面手动填写。",
};
const ru: Labels = {
  label: "Быстрый ввод",
  hint: "Вставьте или введите прокси одной строкой — поля ниже заполнятся из неё.",
  readAs: "Прочитано как {shape}. Проверьте поля ниже.",
  bad: "Не распознано как прокси. Заполните поля ниже вручную.",
};
export function proxyQuickLabels(language: string): Labels {
  return language === "zh" ? zh : language === "ru" ? ru : en;
}
