import { ArrowRight, BellRing, CalendarDays, Sparkles } from 'lucide-react';
import { ParentInbox } from '../../../components/ParentInbox';
import { t } from '../../../i18n';
import type {
  ParentDashboardInbox,
  ParentDashboardStats,
  ParentTaskSessionReminder,
} from './types';

type Props = {
  inbox: ParentDashboardInbox;
  stats: ParentDashboardStats;
  pendingCount: number;
  lowEnergyChildren: Array<{ childId: string; name: string }>;
  reminders: ParentTaskSessionReminder[];
  loading: boolean;
  onGoApprovals: () => void;
  onGoTasks: () => void;
  onOpenWelcome: () => void;
};

export function ParentOverviewTab({
  inbox,
  stats,
  pendingCount,
  lowEnergyChildren,
  reminders,
  loading,
  onGoApprovals,
  onGoTasks,
  onOpenWelcome,
}: Props) {
  return (
    <div className="space-y-4" data-testid="parent-overview-tab">
      <section className="relative overflow-hidden rounded-3xl bg-[#fff4d8] p-5 ring-1 ring-amber-200/70">
        <div className="absolute -right-12 -top-10 h-36 w-36 rounded-full bg-amber-300/30 blur-2xl" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-700">{t('parentWorkspace.overview.eyebrow')}</div>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{t('parentWorkspace.overview.title')}</h2>
              <p className="mt-1 text-sm font-medium text-slate-600">{t('parentWorkspace.overview.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={onOpenWelcome}
              className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-white/80 px-3 text-xs font-black text-amber-800 shadow-sm active:scale-[0.98]"
            >
              <Sparkles size={16} />
              {t('parentWorkspace.overview.reopenWelcome')}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/75 p-3">
              <div className="text-xl font-black text-slate-900">{stats.weekTasks}</div>
              <div className="text-[10px] font-bold text-slate-500">{t('parentWorkspace.metric.weekTasks')}</div>
            </div>
            <div className="rounded-2xl bg-white/75 p-3">
              <div className="text-xl font-black text-emerald-700">{stats.weekCompleted}</div>
              <div className="text-[10px] font-bold text-slate-500">{t('parentWorkspace.metric.completed')}</div>
            </div>
            <button type="button" onClick={onGoApprovals} className="min-h-[58px] rounded-2xl bg-slate-900 p-3 text-left text-white active:scale-[0.98]">
              <div className="text-xl font-black">{pendingCount}</div>
              <div className="text-[10px] font-bold text-slate-300">{t('parentWorkspace.metric.pending')}</div>
            </button>
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={onGoTasks}
        className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 text-left active:scale-[0.99]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><CalendarDays size={20} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black text-slate-900">{t('parentWorkspace.overview.todaySchedule')}</span>
          <span className="block text-xs font-medium text-slate-500">{t('parentWorkspace.overview.todayScheduleHint')}</span>
        </span>
        <ArrowRight size={18} className="text-blue-600" />
      </button>

      <ParentInbox items={inbox.items} totalActionCount={inbox.totalActionCount} loading={loading} onGoReview={onGoApprovals} />

      {lowEnergyChildren.map(child => (
        <div key={child.childId} className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
          {t('inbox.lowEnergy', { name: child.name })}
        </div>
      ))}

      {reminders.length > 0 ? (
        <button
          type="button"
          onClick={onGoApprovals}
          className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 text-left active:scale-[0.99]"
        >
          <BellRing size={20} className="text-amber-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-amber-900">{t('parentWorkspace.overview.reminders', { count: reminders.length })}</span>
            <span className="block truncate text-xs font-medium text-amber-700">{reminders[0].childName} · {reminders[0].title}</span>
          </span>
          <ArrowRight size={18} className="text-amber-700" />
        </button>
      ) : null}

      {stats.weekTasks === 0 && pendingCount === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center">
          <div className="text-sm font-black text-slate-800">{t('parentWorkspace.overview.emptyTitle')}</div>
          <p className="mt-1 text-xs font-medium text-slate-500">{t('parentWorkspace.overview.emptyHint')}</p>
          <button type="button" onClick={onGoTasks} className="mt-4 min-h-[44px] rounded-xl bg-slate-900 px-5 text-sm font-black text-white">
            {t('parentWorkspace.overview.createFirstTask')}
          </button>
        </section>
      ) : null}
    </div>
  );
}
