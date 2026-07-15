import { CalendarDays, ListChecks, Users } from 'lucide-react';
import { t } from '../../../i18n';
import type { ParentTaskView } from './types';

type ParentTasksTabsProps = {
  activeTab: ParentTaskView;
  onChange: (tab: ParentTaskView) => void;
};

const tabs = [
  { id: 'today' as const, label: 'parentTasks.tab.today', icon: CalendarDays },
  { id: 'all' as const, label: 'parentTasks.tab.all', icon: ListChecks },
  { id: 'family' as const, label: 'parentTasks.tab.family', icon: Users },
];

export function ParentTasksTabs({ activeTab, onChange }: ParentTasksTabsProps) {
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1"
      role="tablist"
      aria-label={t('parentTasks.tabsLabel')}
    >
      {tabs.map(tab => {
        const Icon = tab.icon;
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`parent-tasks-tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`flex min-h-11 items-center justify-center gap-1 rounded-xl px-2 text-xs font-black transition-colors sm:text-sm ${
              selected
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-500 active:bg-white/70'
            }`}
          >
            <Icon size={16} aria-hidden="true" />
            {t(tab.label)}
          </button>
        );
      })}
    </div>
  );
}
