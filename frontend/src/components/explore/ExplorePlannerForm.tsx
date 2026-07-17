import { Search, Sparkles } from 'lucide-react';
import { t } from '../../i18n';
import type {
  ExploreExperienceGroup,
  ExplorePlannerRequest,
  ParsedExploreIntent,
} from '../../types/explore';

type Props = {
  draft: ExplorePlannerRequest;
  children: { id: string; name: string; selections: string[] }[];
  groups: ExploreExperienceGroup[];
  parsed: ParsedExploreIntent | null;
  loading: boolean;
  onChange: (patch: Partial<ExplorePlannerRequest>) => void;
  onPreview: () => Promise<unknown>;
  onSearch: () => Promise<unknown>;
};

const choiceClass = (active: boolean) => `min-h-[44px] rounded-xl border px-3 text-xs font-black transition-colors ${
  active ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600'
}`;

export default function ExplorePlannerForm({ draft, children, groups, parsed, loading, onChange, onPreview, onSearch }: Props) {
  const selectedChild = children.find(child => child.id === draft.childId);
  const optionLabels = new Map(groups.flatMap(group => group.options.map(option => [option.key, option.label])));
  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-sky-100 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-sky-600 via-cyan-600 to-teal-500 p-5 text-white">
        <div className="flex items-center gap-2 text-sm font-black text-white/80"><Sparkles size={18} />{t('explore.planner.eyebrow')}</div>
        <h3 className="mt-2 text-xl font-black">{t('explore.planner.title')}</h3>
        <p className="mt-1 text-xs font-bold leading-relaxed text-white/80">{t('explore.planner.description')}</p>
      </div>
      <div className="space-y-4 p-4">
        <label className="block text-xs font-black text-slate-600">
          {t('explore.planner.customLabel')}
          <textarea
            value={draft.customText || ''}
            maxLength={160}
            onChange={event => onChange({ customText: event.target.value })}
            placeholder={t('explore.planner.customPlaceholder')}
            className="mt-1 min-h-[88px] w-full resize-none rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-sky-400"
          />
        </label>

        {children.length > 0 && <label className="block text-xs font-black text-slate-600">
          {t('explore.planner.childLabel')}
          <select value={draft.childId || ''} onChange={event => {
            const child = children.find(item => item.id === event.target.value);
            onChange({ childId: event.target.value || undefined, experienceKeys: child?.selections?.length ? child.selections.slice(0, 2) : ['any'] });
          }} className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">
            <option value="">{t('explore.planner.familyAnyChild')}</option>
            {children.map(child => <option key={child.id} value={child.id}>{child.name}</option>)}
          </select>
        </label>}
        {selectedChild && <div className="rounded-2xl bg-violet-50 p-3">
          <div className="text-[11px] font-black text-violet-700">{t('explore.planner.childIntent')}</div>
          <div className="mt-2 flex flex-wrap gap-2">{(selectedChild.selections.length ? selectedChild.selections.slice(0, 2) : ['any']).map(key => (
            <span key={key} className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-violet-700">{optionLabels.get(key) || t('explore.intentAny')}</span>
          ))}</div>
        </div>}

        <div>
          <div className="mb-2 text-xs font-black text-slate-600">{t('explore.planner.dateLabel')}</div>
          <div className="grid grid-cols-2 gap-2">{(['today', 'weekend', 'next-week', 'custom'] as const).map(value => (
            <button key={value} type="button" onClick={() => onChange({ datePreset: value })} className={choiceClass(draft.datePreset === value)}>{t(`explore.planner.date.${value}`)}</button>
          ))}</div>
          {draft.datePreset === 'custom' && <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs font-black text-slate-600">{t('explore.planner.dateFrom')}<input type="date" value={draft.dateFrom || ''} onChange={event => onChange({ dateFrom: event.target.value || undefined })} className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 px-2 text-sm font-bold" /></label>
            <label className="text-xs font-black text-slate-600">{t('explore.planner.dateTo')}<input type="date" value={draft.dateTo || ''} onChange={event => onChange({ dateTo: event.target.value || undefined })} className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 px-2 text-sm font-bold" /></label>
          </div>}
        </div>
        <div>
          <div className="mb-2 text-xs font-black text-slate-600">{t('explore.planner.objectiveLabel')}</div>
          <div className="grid grid-cols-2 gap-2">{(['energy', 'knowledge', 'hands-on', 'family'] as const).map(value => (
            <button key={value} type="button" onClick={() => onChange({ objective: draft.objective === value ? undefined : value })} className={choiceClass(draft.objective === value)}>{t(`explore.planner.objective.${value}`)}</button>
          ))}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-black text-slate-600">{t('explore.planner.cityLabel')}<input value={draft.city} onChange={event => onChange({ city: event.target.value })} placeholder={t('explore.planner.cityPlaceholder')} className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 px-3 text-sm font-bold" /></label>
          <label className="text-xs font-black text-slate-600">{t('explore.planner.districtLabel')}<input value={draft.districtScope?.[0] || ''} onChange={event => onChange({ districtScope: event.target.value.trim() ? [event.target.value] : [] })} placeholder={t('explore.planner.districtPlaceholder')} className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 px-3 text-sm font-bold" /></label>
          <label className="text-xs font-black text-slate-600">{t('explore.planner.budgetLabel')}<input type="number" min="0" value={draft.budgetMax ?? ''} onChange={event => onChange({ budgetMax: event.target.value === '' ? undefined : Math.max(0, Number(event.target.value)) })} placeholder={t('explore.planner.budgetPlaceholder')} className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 px-3 text-sm font-bold" /></label>
          <label className="text-xs font-black text-slate-600">{t('explore.planner.indoorLabel')}<select value={draft.indoorPreference || 'any'} onChange={event => onChange({ indoorPreference: event.target.value as ExplorePlannerRequest['indoorPreference'] })} className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="any">{t('explore.planner.indoor.any')}</option><option value="indoor">{t('explore.planner.indoor.indoor')}</option><option value="outdoor">{t('explore.planner.indoor.outdoor')}</option></select></label>
        </div>

        {parsed && <div data-testid="explore-planner-parsed" className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 p-3">
          <div className="text-xs font-black text-slate-700">{t('explore.planner.recognized')}</div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700">{parsed.hardConditions.city}</span>
            {parsed.hardConditions.dateFrom && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700">{parsed.hardConditions.dateFrom}{parsed.hardConditions.dateTo !== parsed.hardConditions.dateFrom ? ` – ${parsed.hardConditions.dateTo}` : ''}</span>}
            {parsed.preferences.experienceKeys.map(key => <span key={key} className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-black text-violet-700">{optionLabels.get(key) || t('explore.intentAny')}</span>)}
            {parsed.unsupported.map(key => <span key={key} className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-700">{t(`explore.planner.unsupported.${key}`)}</span>)}
          </div>
          {parsed.unsupported.length > 0 && <p className="text-[11px] font-bold leading-relaxed text-amber-700">{t('explore.planner.unsupportedHint')}</p>}
        </div>}

        <button type="button" disabled={loading} onClick={() => { void onPreview().catch(() => {}); }} className="min-h-[44px] w-full rounded-xl border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50">{t('explore.planner.preview')}</button>
        <button data-testid="explore-planner-search" type="button" disabled={loading || !draft.city.trim()} onClick={() => { void onSearch().catch(() => {}); }} className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-black text-white shadow-lg shadow-slate-200 disabled:opacity-40"><Search size={18} />{loading ? t('explore.planner.searching') : t('explore.planner.search')}</button>
      </div>
    </section>
  );
}
