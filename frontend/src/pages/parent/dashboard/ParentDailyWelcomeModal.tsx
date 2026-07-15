import { ArrowRight, CheckCircle2, ClipboardList, Gift, Sparkles, Users } from 'lucide-react';
import { Modal } from '../../../components/Modal';
import { t } from '../../../i18n';
import type { ParentDashboardStats } from './types';

type Props = {
  isOpen: boolean;
  stats: ParentDashboardStats;
  pendingCount: number;
  onClose: () => void;
  onGoTasks: () => void;
  onGoApprovals: () => void;
};

export function ParentDailyWelcomeModal({
  isOpen,
  stats,
  pendingCount,
  onClose,
  onGoTasks,
  onGoApprovals,
}: Props) {
  const isNewFamily = stats.weekTasks === 0 && pendingCount === 0;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('parentWorkspace.welcome.title')}>
      <div data-testid="parent-daily-welcome" className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl bg-slate-950 px-4 py-5 text-white">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-amber-300/20 blur-2xl" />
          <div className="relative flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-300 text-slate-950 shadow-lg shadow-amber-400/20">
              <Sparkles size={22} aria-hidden="true" />
            </div>
            <div>
              <div className="text-lg font-black tracking-tight">{t('parentWorkspace.welcome.greeting')}</div>
              <p className="mt-1 text-sm font-medium leading-relaxed text-slate-300">
                {isNewFamily ? t('parentWorkspace.welcome.newFamily') : t('parentWorkspace.welcome.returning')}
              </p>
            </div>
          </div>
        </div>

        {isNewFamily ? (
          <div className="space-y-2">
            {[
              [ClipboardList, 'parentWorkspace.welcome.stepTask'],
              [Gift, 'parentWorkspace.welcome.stepReward'],
              [Users, 'parentWorkspace.welcome.stepSwitch'],
            ].map(([Icon, key], index) => {
              const StepIcon = Icon as typeof ClipboardList;
              return (
                <div key={key as string} className="flex min-h-[52px] items-center gap-3 rounded-xl bg-slate-50 px-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-black text-slate-800 shadow-sm">
                    {index + 1}
                  </span>
                  <StepIcon size={18} className="text-amber-600" aria-hidden="true" />
                  <span className="text-sm font-bold text-slate-700">{t(key as string)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-amber-50 p-3 text-center">
              <div className="text-2xl font-black text-amber-700">{stats.weekTasks}</div>
              <div className="mt-1 text-[11px] font-bold text-amber-700/70">{t('parentWorkspace.metric.weekTasks')}</div>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-3 text-center">
              <div className="text-2xl font-black text-emerald-700">{stats.weekCompleted}</div>
              <div className="mt-1 text-[11px] font-bold text-emerald-700/70">{t('parentWorkspace.metric.completed')}</div>
            </div>
            <div className="rounded-2xl bg-rose-50 p-3 text-center">
              <div className="text-2xl font-black text-rose-700">{pendingCount}</div>
              <div className="mt-1 text-[11px] font-bold text-rose-700/70">{t('parentWorkspace.metric.pending')}</div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            onClose();
            if (pendingCount > 0) onGoApprovals();
            else onGoTasks();
          }}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 font-black text-slate-950 shadow-lg shadow-amber-200 active:scale-[0.99]"
        >
          {pendingCount > 0 ? <CheckCircle2 size={19} /> : <ClipboardList size={19} />}
          {pendingCount > 0 ? t('parentWorkspace.welcome.goApprovals') : t('parentWorkspace.welcome.goTasks')}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </Modal>
  );
}
