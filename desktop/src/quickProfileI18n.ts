const en = {
  quick: "Quick creation", advanced: "Advanced", hint: "Name, proxy and start pages. A suitable device is selected automatically.",
  summary: "Device and fingerprint", showSummary: "Show full fingerprint", hideSummary: "Hide full fingerprint",
  following: "Language and timezone follow the proxy unless changed in Advanced.",
  closeTitle: "Keep your changes?", closeBody: "Keep a draft to continue later in this app, or discard the unsaved changes.",
  continue: "Continue editing", keep: "Keep draft", discard: "Discard changes",
  draftNote: "Drafts are kept in memory until the app closes.", restored: "Unsaved draft restored.",
  invalid: "Review the fields in Advanced before saving.",
} as const;
type Labels = { [K in keyof typeof en]: string };
const zh: Labels = {
  quick: "快速创建", advanced: "高级设置", hint: "填写名称、代理和启动网址，自动选择合适设备。",
  summary: "设备与指纹", showSummary: "展开完整指纹", hideSummary: "收起完整指纹",
  following: "语言和时区默认跟随代理，可在高级设置中调整。",
  closeTitle: "如何处理未保存的修改？", closeBody: "保留草稿可在当前应用中继续编辑，也可以丢弃本次修改。",
  continue: "继续编辑", keep: "保留草稿", discard: "丢弃修改",
  draftNote: "草稿仅保留在内存中，退出应用后清除。", restored: "已恢复未保存的草稿。",
  invalid: "请在高级设置中检查相关字段后再保存。",
};
const ru: Labels = {
  quick: "Быстрое создание", advanced: "Расширенные настройки", hint: "Название, прокси и стартовые страницы. Подходящее устройство выбирается автоматически.",
  summary: "Устройство и отпечаток", showSummary: "Показать весь отпечаток", hideSummary: "Скрыть весь отпечаток",
  following: "Язык и часовой пояс следуют за прокси, если не изменены в расширенных настройках.",
  closeTitle: "Сохранить изменения?", closeBody: "Сохраните черновик для продолжения в этом приложении или удалите несохранённые изменения.",
  continue: "Продолжить", keep: "Сохранить черновик", discard: "Удалить изменения",
  draftNote: "Черновики хранятся в памяти до закрытия приложения.", restored: "Несохранённый черновик восстановлен.",
  invalid: "Проверьте поля в расширенных настройках перед сохранением.",
};
export function quickProfileLabels(language: string): Labels {
  return language === "zh" ? zh : language === "ru" ? ru : en;
}
