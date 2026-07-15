import { BarChart3, ClipboardCheck, LayoutDashboard, Menu } from 'lucide-react';
import { t } from '../../../i18n';
import type { ParentDashboardTab } from './types';

type Props = {
  activeTab: ParentDashboardTab;
  pendingCount: number;
  onChange: (tab: ParentDashboardTab) => void;
};

const items: Array<{ id: ParentDashboardTab; icon: typeof LayoutDashboard; labelKey: string }> = [
  { id: 'overview', icon: LayoutDashboard, labelKey: 'parentWorkspace.tab.overview' },
  { id: 'approvals', icon: ClipboardCheck, labelKey: 'parentWorkspace.tab.approvals' },
  { id: 'reports', icon: BarChart3, labelKey: 'parentWorkspace.tab.reports' },
  { id: 'tools', icon: Menu, labelKey: 'parentWorkspace.tab.tools' },
];

export function ParentDashboardTabs({ activeTab, pendingCount, onChange }: Props) {
  return (
    <nav
      className="grid grid-cols-4 gap-1 rounded-2xl border border-slate-200/80 bg-white/90 p-1.5 shadow-sm"
      aria-label={t('parentWorkspace.tabsLabel')}
      data-testid="parent-workspace-tabs"
    >
      {items.map(item => {
        const Icon = item.icon;
        const active = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            data-testid={`parent-workspace-tab-${item.id}`}
            aria-current={active ? 'page' : undefined}
            className={`relative flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-black transition-all active:scale-[0.98] ${
              active
                ? 'bg-slate-900 text-white shadow-md shadow-slate-300'
                : 'text-slate-500 active:bg-slate-100'
            }`}
          >
            <Icon size={18} aria-hidden="true" />
            <span className="max-w-full truncate">{t(item.labelKey)}</span>
            {item.id === 'approvals' && pendingCount > 0 ? (
              <span className="absolute right-1.5 top-1 min-w-4 rounded-full bg-rose-500 px-1 text-[9px] leading-4 text-white">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
