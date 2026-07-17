import { CalendarDays, Check, MapPin, Send } from 'lucide-react';
import { t } from '../../i18n';
import type { ExploreDiscoveryResult } from '../../types/explore';

type Props = {
  results: ExploreDiscoveryResult[];
  searched: boolean;
  partial: boolean;
  error: string;
  adjustments: string[];
  pendingAction: string;
  completedActions: Set<string>;
  onAdd: (item: ExploreDiscoveryResult) => Promise<void>;
  onRecommend: (item: ExploreDiscoveryResult) => Promise<void>;
  onAdjust: (code: string) => Promise<void>;
};

const displayDate = (value?: string) => value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value)) : '';

export default function ExplorePlannerResults({ results, searched, partial, error, adjustments, pendingAction, completedActions, onAdd, onRecommend, onAdjust }: Props) {
  if (error) return <div role="alert" className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">{t('explore.planner.errorGeneric')}</div>;
  if (!searched) return null;
  if (results.length === 0) return <section data-testid="explore-planner-empty" className="rounded-3xl border border-slate-100 bg-white p-5 text-center shadow-sm">
    <div className="text-lg font-black text-slate-900">{t('explore.planner.emptyTitle')}</div>
    <p className="mt-2 text-xs font-bold leading-relaxed text-slate-500">{t('explore.planner.emptyDesc')}</p>
    {adjustments[0] && <button type="button" onClick={() => { void onAdjust(adjustments[0]).catch(() => {}); }} className="mt-4 min-h-[44px] rounded-xl bg-sky-600 px-5 text-sm font-black text-white">{t(`explore.planner.adjust.${adjustments[0]}`)}</button>}
  </section>;
  return <section data-testid="explore-planner-results" className="space-y-3">
    <div className="flex items-center justify-between px-1"><h3 className="text-base font-black text-slate-900">{t('explore.planner.resultsTitle')}</h3><span className="text-xs font-black text-slate-400">{t('explore.planner.resultCount', { count: results.length })}</span></div>
    {partial && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{t('explore.planner.partial')}</div>}
    {results.map(item => {
      const actionBusy = pendingAction.startsWith(`${item.id}:`);
      return <article key={item.id} className={`overflow-hidden rounded-[1.5rem] border bg-white shadow-sm ${item.recommendationRole === 'primary' ? 'border-sky-200' : 'border-slate-100'}`}>
        <div className="relative h-40 bg-slate-100"><img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" /><span className="absolute left-3 top-3 rounded-full bg-slate-900/85 px-3 py-1 text-[11px] font-black text-white">{item.recommendationRole === 'primary' ? t('explore.planner.primary') : t('explore.planner.alternative')}</span></div>
        <div className="space-y-3 p-4">
          <div><div className="flex items-start justify-between gap-2"><h4 className="text-lg font-black text-slate-900">{item.title}</h4><span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{t(`explore.planner.trust.${item.trustLabel}`)}</span></div><p className="mt-1 line-clamp-3 text-xs font-bold leading-relaxed text-slate-500">{item.summary}</p></div>
          <div className="space-y-1 text-xs font-bold text-slate-600">
            <div className="flex items-center gap-1.5"><MapPin size={14} className="text-sky-500" />{[item.city, item.district, item.address || item.venue].filter(Boolean).join(' · ')}</div>
            {(item.activityStart || item.activityEnd) && <div className="flex items-center gap-1.5"><CalendarDays size={14} className="text-violet-500" />{displayDate(item.activityStart)}{item.activityEnd && item.activityEnd !== item.activityStart ? ` – ${displayDate(item.activityEnd)}` : ''}</div>}
          </div>
          {item.matchedReasons.length > 0 && <div className="flex flex-wrap gap-1.5">{item.matchedReasons.map(reason => <span key={reason} className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-sky-700">{t(`explore.planner.reason.${reason}`)}</span>)}</div>}
          <div className="text-[10px] font-bold text-slate-400">{t('explore.planner.verifiedAt', { date: displayDate(item.verifiedAt) })}</div>
          <div className="grid grid-cols-2 gap-2"><button type="button" disabled={actionBusy || completedActions.has(`${item.id}:recommend`)} onClick={() => { void onRecommend(item).catch(() => {}); }} className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-sky-200 text-xs font-black text-sky-700 disabled:opacity-40"><Send size={15} />{completedActions.has(`${item.id}:recommend`) ? t('explore.planner.recommended') : t('explore.planner.recommend')}</button><button type="button" disabled={actionBusy || completedActions.has(`${item.id}:add`)} onClick={() => { void onAdd(item).catch(() => {}); }} className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl bg-slate-900 text-xs font-black text-white disabled:opacity-40"><Check size={15} />{completedActions.has(`${item.id}:add`) ? t('explore.planner.addedShort') : t('explore.planner.addPlan')}</button></div>
        </div>
      </article>;
    })}
  </section>;
}
