import { CalendarDays, MapPin, Star } from 'lucide-react';
import { t } from '../../i18n';
import { EXPLORE_CATEGORY_ICONS, type ExploreFeedItem } from '../../types/explore';

type Props = {
  item: ExploreFeedItem;
  busy: boolean;
  leaving: boolean;
  onWant: () => void;
  onDismiss: () => void;
};

export default function ExploreRecommendationCard({ item, busy, leaving, onWant, onDismiss }: Props) {
  const primary = item.recommendationRole === 'primary';
  const activity = item.recommendationKind === 'activity';
  return (
    <article
      data-testid={`explore-recommendation-${item.recommendationRole || 'alternative'}`}
      className={`overflow-hidden rounded-3xl border bg-white shadow-sm transition-all duration-300 ${
        leaving ? 'scale-95 opacity-0' : 'opacity-100'
      } ${primary ? 'border-violet-300 ring-2 ring-violet-100' : 'border-slate-100'}`}
    >
      <div className="relative">
        <img src={item.imageUrl || ''} alt={item.title} loading="lazy" className="h-44 w-full object-cover" />
        <div className="absolute left-3 top-3 flex gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-black text-white shadow-sm ${primary ? 'bg-violet-600' : 'bg-slate-700/90'}`}>
            {primary ? t('explore.recommendPrimary') : t('explore.recommendAlternative')}
          </span>
          <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-black text-slate-700 shadow-sm">
            {activity ? <CalendarDays size={13} className="mr-1 inline" /> : <MapPin size={13} className="mr-1 inline" />}
            {activity ? t('explore.recommendActivity') : t('explore.recommendPlace')}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-lg font-black leading-snug text-slate-900">{item.title}</h4>
          {item.category && (
            <span className="shrink-0 rounded-full bg-sky-50 px-2 py-1 text-[11px] font-black text-sky-700">
              {EXPLORE_CATEGORY_ICONS[item.category] || '📍'} {item.category}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-600 line-clamp-3">{item.summary}</p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {(item.ageMin != null || item.ageMax != null) && (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-700">👦 {item.ageMin ?? ''}{item.ageMin != null && item.ageMax != null ? '–' : ''}{item.ageMax ?? ''} {t('explore.ageSuffix')}</span>
          )}
          {item.price && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">💰 {item.price}</span>}
          {item.signupDeadline && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">⏰ {item.signupDeadline}</span>}
          {(item.venue || item.district) && <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-black text-slate-600">📍 {item.venue || item.district}</span>}
        </div>
        {item.recommendReason && <p className="mt-2 flex gap-1 text-xs font-bold leading-relaxed text-violet-600"><Star size={14} className="mt-0.5 shrink-0" />{item.recommendReason}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onDismiss} disabled={busy} className="min-h-[44px] rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-500 disabled:opacity-50">
            {t('explore.feedDismiss')}
          </button>
          <button type="button" onClick={onWant} disabled={busy} className="min-h-[44px] rounded-2xl bg-emerald-500 text-sm font-black text-white shadow-md shadow-emerald-100 disabled:opacity-50">
            {t('explore.feedWant')}
          </button>
        </div>
      </div>
    </article>
  );
}
