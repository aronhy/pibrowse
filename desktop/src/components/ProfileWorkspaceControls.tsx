import { useI18n } from "../i18n";
import { defaultWorkspacePreferences, deleteWorkspaceView, restoreWorkspaceView, sanitizeWorkspacePreferences, type ProfileColumn, type ProfileQuickFilter, type ProfileSort, type ProfileWorkspacePreferences } from "../profileWorkspace";
import { workspaceLabels } from "../profileWorkspaceI18n";
import { Select } from "./Select";
import "./ProfileWorkspaceControls.css";

export function ProfileWorkspaceControls({ preferences, onChange, counts, onSaveView }: {
  preferences: ProfileWorkspacePreferences;
  onChange: (next: ProfileWorkspacePreferences) => void;
  counts: { all: number; recent: number; attention: number; pinned: number };
  onSaveView: () => void;
}) {
  const { resolved } = useI18n();
  const labels = workspaceLabels(resolved);
  const { filters, columns, views } = preferences;
  const quick: ProfileQuickFilter[] = ["all", "recent", "attention", "pinned"];
  const sorts: [ProfileSort, string][] = [["default", labels.sortDefault], ["recent", labels.sortRecent],
    ["nameAsc", labels.sortNameAsc], ["nameDesc", labels.sortNameDesc], ["attention", labels.sortAttention]];
  const optionalColumns: [ProfileColumn, string][] = [["project", labels.columnProject], ["proxy", labels.columnProxy],
    ["status", labels.columnStatus], ["lastOpened", labels.columnLastOpened]];
  const activeView = views.find((view) => view.id === preferences.activeViewId);
  const change = (next: ProfileWorkspacePreferences) => onChange(sanitizeWorkspacePreferences(next));

  return (
    <div className="profileWorkspaceControls">
      <div className="profileQuickViews" role="group" aria-label={labels.quickViews}>
        {quick.map((key) => (
          <button key={key} className="ghost profileQuickView" aria-pressed={filters.quick === key}
            onClick={() => change({ ...preferences, filters: { ...filters, quick: key } })}>
            {labels[key]} <span className="profileViewCount">{counts[key]}</span>
          </button>
        ))}
      </div>
      <div className="profileWorkspaceOptions">
        <label className="profileWorkspaceField">
          <span>{labels.sort}</span>
          <Select value={filters.sort} aria-label={labels.sort}
            onChange={(event) => change({ ...preferences, filters: { ...filters, sort: event.target.value as ProfileSort } })}>
            {sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
        <label className="profileWorkspaceField profileSavedView">
          <span>{labels.savedViews}</span>
          <Select value={activeView?.id ?? ""} aria-label={labels.savedViews} onChange={(event) => {
            onChange(restoreWorkspaceView(preferences, event.target.value));
          }}>
            <option value="">{labels.customView}</option>
            {views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </Select>
        </label>
        <button className="ghost" onClick={onSaveView}>{labels.saveView}</button>
        {activeView && <button className="ghost" onClick={() => onChange(deleteWorkspaceView(preferences, activeView.id))}>{labels.deleteView}</button>}
        <details className="profileColumnPicker">
          <summary>{labels.columns}</summary>
          <div className="profileColumnOptions">
            {optionalColumns.map(([column, label]) => (
              <label key={column}>
                <input type="checkbox" checked={columns.includes(column)} onChange={(event) => change({
                  ...preferences,
                  columns: event.target.checked ? [...columns, column] : columns.filter((c) => c !== column),
                })} />
                {label}
              </label>
            ))}
          </div>
        </details>
        <button className="ghost" onClick={() => {
          const defaults = defaultWorkspacePreferences();
          change({ ...preferences, filters: defaults.filters, columns: defaults.columns, activeViewId: null });
        }}>{labels.reset}</button>
      </div>
    </div>
  );
}
