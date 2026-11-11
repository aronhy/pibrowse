// SPDX-License-Identifier: AGPL-3.0-or-later

const en = {
  all: "All", recent: "Recent 7 days", attention: "Needs attention", pinned: "Pinned",
  quickViews: "Quick views", sort: "Sort", sortDefault: "Default order", sortRecent: "Recently opened",
  sortNameAsc: "Name A–Z", sortNameDesc: "Name Z–A", sortAttention: "Attention first",
  savedViews: "Saved views", customView: "Current filters", saveView: "Save view", deleteView: "Delete view",
  columns: "Columns", columnProject: "Project", columnProxy: "Proxy", columnStatus: "Status", columnLastOpened: "Last opened",
  reset: "Reset filters", pin: "Pin", unpin: "Unpin", pinHint: "Pin this profile", unpinHint: "Unpin this profile", selectAll: "Select all visible profiles",
  saveViewTitle: "Save current view", saveViewName: "View name", saveViewConfirm: "Save view",
  noMatches: "No profiles match these filters.",
};
type WorkspaceLabels = Record<keyof typeof en, string>;

const zh: WorkspaceLabels = {
  all: "全部", recent: "最近7天", attention: "需处理", pinned: "置顶",
  quickViews: "快捷视图", sort: "排序", sortDefault: "默认顺序", sortRecent: "最近打开",
  sortNameAsc: "名称正序", sortNameDesc: "名称倒序", sortAttention: "需处理优先",
  savedViews: "已保存视图", customView: "当前筛选", saveView: "保存视图", deleteView: "删除视图",
  columns: "显示列", columnProject: "项目", columnProxy: "代理", columnStatus: "状态", columnLastOpened: "最近打开",
  reset: "重置筛选", pin: "置顶", unpin: "取消置顶", pinHint: "置顶此环境", unpinHint: "取消置顶此环境", selectAll: "选择全部可见环境",
  saveViewTitle: "保存当前视图", saveViewName: "视图名称", saveViewConfirm: "保存视图",
  noMatches: "没有符合当前筛选条件的环境。",
};

const ru: WorkspaceLabels = {
  all: "Все", recent: "За 7 дней", attention: "Требуют внимания", pinned: "Закреплённые",
  quickViews: "Быстрые виды", sort: "Сортировка", sortDefault: "По умолчанию", sortRecent: "Недавно открытые",
  sortNameAsc: "Название А–Я", sortNameDesc: "Название Я–А", sortAttention: "Сначала проблемы",
  savedViews: "Сохранённые виды", customView: "Текущие фильтры", saveView: "Сохранить вид", deleteView: "Удалить вид",
  columns: "Столбцы", columnProject: "Проект", columnProxy: "Прокси", columnStatus: "Статус", columnLastOpened: "Последнее открытие",
  reset: "Сбросить фильтры", pin: "Закрепить", unpin: "Открепить", pinHint: "Закрепить профиль", unpinHint: "Открепить профиль", selectAll: "Выбрать все видимые профили",
  saveViewTitle: "Сохранить текущий вид", saveViewName: "Название вида", saveViewConfirm: "Сохранить вид",
  noMatches: "Нет профилей, соответствующих фильтрам.",
};

/** Match the app's resolved language; every other locale has English fallback. */
export function workspaceLabels(resolved: string): WorkspaceLabels {
  return resolved === "zh" ? zh : resolved === "ru" ? ru : en;
}
