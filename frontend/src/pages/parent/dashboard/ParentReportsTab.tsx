import { Lightbulb } from 'lucide-react';
import { StatsPanel } from '../../../components/StatsPanel';
import { t } from '../../../i18n';
import type { ParentWeeklyReport } from './types';

type Props = { weeklyReports: ParentWeeklyReport[] };

export function ParentReportsTab({ weeklyReports }: Props) {
  return (
    <div className="space-y-4" data-testid="parent-reports-tab">
      <section className="rounded-3xl bg-slate-900 p-5 text-white shadow-lg shadow-slate-200">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-300">{t('parentWorkspace.reports.eyebrow')}</div>
        <h2 className="mt-1 text-2xl font-black">{t('parentWorkspace.reports.title')}</h2>
        <p className="mt-1 text-sm font-medium text-slate-300">{t('parentWorkspace.reports.subtitle')}</p>
      </section>

      {weeklyReports.map(report => (
        <section key={report.id} className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-indigo-800">{report.childName || t('weekly.parentCardTitle')}</div>
              <div className="mt-0.5 text-[11px] font-bold text-slate-400">{t('weekly.weekOf', { date: report.weekStart })}</div>
            </div>
          </div>
          {report.parentNarrative ? <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600">{report.parentNarrative}</p> : null}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              [report.stats?.tasksCompleted ?? 0, 'weekly.statTasks'],
              [report.stats?.activeStarts ?? 0, 'weekly.statStarts'],
              [report.stats?.coinsEarned ?? 0, 'weekly.statCoins'],
            ].map(([value, key]) => (
              <div key={key as string} className="rounded-xl bg-indigo-50 p-2 text-center">
                <div className="text-lg font-black text-indigo-700">{value}</div>
                <div className="text-[10px] font-bold text-slate-500">{t(key as string)}</div>
              </div>
            ))}
          </div>
          {report.suggestion ? (
            <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold leading-relaxed text-amber-800">
              <Lightbulb size={16} className="mt-0.5 shrink-0" />
              {report.suggestion}
            </div>
          ) : null}
        </section>
      ))}

      <StatsPanel />
    </div>
  );
}
