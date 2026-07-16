import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { t } from '../../i18n';
import type { ExploreExperienceGroup } from '../../types/explore';

type Props = {
  groups: ExploreExperienceGroup[];
  selections: string[];
  saving: boolean;
  onChange: (selections: string[]) => void;
  onSave: () => void;
};

export default function ExploreIntentPicker({ groups, selections, saving, onChange, onSave }: Props) {
  const firstSelectedGroup = useMemo(
    () => selections.includes('any') ? undefined : groups.find(group => group.options.some(option => selections.includes(option.key)))?.key,
    [groups, selections]
  );
  const [activeGroup, setActiveGroup] = useState(firstSelectedGroup || groups[0]?.key || '');
  const [limitReached, setLimitReached] = useState(false);
  const group = groups.find(item => item.key === activeGroup) || groups[0];
  const selectedOptions = useMemo(
    () => groups.flatMap(item => item.options).filter(option => option.key !== 'any' && selections.includes(option.key)),
    [groups, selections]
  );

  const toggle = (key: string) => {
    if (key === 'any') {
      setLimitReached(false);
      onChange(['any']);
      return;
    }
    const current = selections.filter(item => item !== 'any');
    if (current.includes(key)) {
      setLimitReached(false);
      onChange(current.filter(item => item !== key).length > 0 ? current.filter(item => item !== key) : ['any']);
      return;
    }
    if (current.length >= 2) {
      setLimitReached(true);
      return;
    }
    setLimitReached(false);
    onChange([...current, key]);
  };

  if (!group) return null;
  return (
    <section data-testid="explore-intent-picker" className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-500 text-xl text-white shadow-sm"><Sparkles size={22} /></span>
        <div>
          <h3 className="text-lg font-black text-slate-900">{t('explore.intentTitle')}</h3>
          <p className="mt-0.5 text-xs font-bold leading-relaxed text-slate-500">{t('explore.intentDesc')}</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label={t('explore.intentCategoryLabel')}>
        {groups.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setActiveGroup(item.key)}
            className={`min-h-[44px] shrink-0 rounded-full border px-3 text-xs font-black transition-colors ${
              item.key === group.key ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {group.options.map(option => {
          const active = selections.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              data-testid={`explore-intent-${option.key}`}
              aria-pressed={active}
              onClick={() => toggle(option.key)}
              className={`min-h-[48px] rounded-2xl border px-3 text-left text-sm font-black transition-all ${
                active ? 'border-violet-500 bg-violet-500 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label={t('explore.intentSelectedLabel')}>
          {selectedOptions.map(option => (
            <button
              key={option.key}
              type="button"
              onClick={() => toggle(option.key)}
              className="min-h-[44px] rounded-full border border-violet-200 bg-white px-3 text-xs font-black text-violet-700"
              aria-label={t('explore.intentRemoveSelection', { label: option.label })}
            >
              {option.label} ×
            </button>
          ))}
        </div>
      )}

      {limitReached && (
        <p data-testid="explore-intent-limit" role="status" className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-black leading-relaxed text-amber-700">
          {t('explore.intentLimit')}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-black text-violet-700">{t('explore.intentSelectedCount', { count: selections.includes('any') ? 0 : selections.length })}</span>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="min-h-[44px] rounded-2xl bg-slate-900 px-5 text-sm font-black text-white disabled:opacity-50"
        >
          {saving ? t('common.loading') : t('explore.intentRecommend')}
        </button>
      </div>
    </section>
  );
}
