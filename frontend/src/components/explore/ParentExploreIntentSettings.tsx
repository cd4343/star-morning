import { SlidersHorizontal } from 'lucide-react';
import { t } from '../../i18n';
import type { ParentExploreIntentSettings } from '../../types/explore';

type Props = {
  settings: ParentExploreIntentSettings;
  disabledKeys: string[];
  saving: boolean;
  onToggle: (key: string) => void;
  onSave: () => void;
};

export default function ParentExploreIntentSettings({ settings, disabledKeys, saving, onToggle, onSave }: Props) {
  const labels = new Map(settings.groups.flatMap(group => group.options).map(option => [option.key, option.label]));
  return (
    <section data-testid="parent-explore-intent-settings" className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-teal-50 text-teal-700"><SlidersHorizontal size={21} /></span>
        <div>
          <h3 className="font-black text-slate-900">{t('explore.parentIntentTitle')}</h3>
          <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">{t('explore.parentIntentDesc')}</p>
        </div>
      </div>

      {settings.children.length > 0 && (
        <div className="space-y-2 rounded-2xl bg-violet-50 p-3">
          <div className="text-xs font-black text-violet-700">{t('explore.childCurrentIntent')}</div>
          {settings.children.map(child => (
            <div key={child.id} className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-600">
              <span className="mr-1 font-black text-slate-900">{child.name}</span>
              {(child.selections.length ? child.selections : ['any']).map(key => (
                <span key={key} className="rounded-full bg-white px-2 py-1">{labels.get(key) || t('explore.intentAny')}</span>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {settings.groups.filter(group => group.key !== 'any').map(group => (
          <details key={group.key} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
            <summary className="min-h-[44px] cursor-pointer list-none py-2 text-sm font-black text-slate-800">
              {group.icon} {group.label}
            </summary>
            <div className="grid grid-cols-2 gap-2 pt-2">
              {group.options.map(option => {
                const enabled = !disabledKeys.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={enabled}
                    onClick={() => onToggle(option.key)}
                    className={`min-h-[44px] rounded-xl border px-2 text-left text-xs font-black ${enabled ? 'border-teal-300 bg-white text-teal-700' : 'border-slate-200 bg-slate-100 text-slate-400'}`}
                  >
                    {enabled ? '✓ ' : '— '}{option.label}
                  </button>
                );
              })}
            </div>
          </details>
        ))}
      </div>

      <button type="button" onClick={onSave} disabled={saving} className="min-h-[44px] w-full rounded-2xl bg-slate-900 text-sm font-black text-white disabled:opacity-50">
        {saving ? t('common.loading') : t('explore.parentIntentSave')}
      </button>
    </section>
  );
}
