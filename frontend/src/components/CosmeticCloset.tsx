import { Lock, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import type { CosmeticType, GrowthIdentity, GrowthProfileUpdate } from '../types/growthIdentity';
import BottomSheet from './BottomSheet';
import { GrowthIcon } from './GrowthIcon';

type CosmeticClosetProps = {
  isOpen: boolean;
  identity: GrowthIdentity;
  saving: boolean;
  onClose: () => void;
  onSave: (selection: GrowthProfileUpdate) => void;
};

const sectionLabels: Record<CosmeticType, string> = {
  avatar: 'growthIdentity.avatarSection',
  frame: 'growthIdentity.frameSection',
  theme: 'growthIdentity.themeSection',
  title: 'growthIdentity.titleSection',
};

export function CosmeticCloset({ isOpen, identity, saving, onClose, onSave }: CosmeticClosetProps) {
  const [draft, setDraft] = useState<GrowthProfileUpdate>(identity.selected);
  const [showAllTitles, setShowAllTitles] = useState(false);
  const [showAllBadges, setShowAllBadges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDraft(identity.selected);
      setShowAllTitles(false);
      setShowAllBadges(false);
    }
  }, [identity.selected, isOpen]);

  const selectCosmetic = (type: CosmeticType, key: string) => {
    setDraft(current => ({ ...current, [`${type}Key`]: key }));
  };

  const toggleBadge = (id: string) => {
    setDraft(current => {
      if (current.featuredAchievementIds.includes(id)) {
        return { ...current, featuredAchievementIds: current.featuredAchievementIds.filter(item => item !== id) };
      }
      if (current.featuredAchievementIds.length >= 3) return current;
      return { ...current, featuredAchievementIds: [...current.featuredAchievementIds, id] };
    });
  };

  const badgeItems = [...identity.unlockedAchievements].sort((left, right) => (
    Number(draft.featuredAchievementIds.includes(right.id)) - Number(draft.featuredAchievementIds.includes(left.id))
  ));

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={saving ? () => undefined : onClose}
      title={t('growthIdentity.closetTitle')}
      footer={(
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(draft)}
          className="min-h-[52px] w-full rounded-2xl bg-indigo-600 px-4 py-3 font-black text-white disabled:opacity-60 active:bg-indigo-700"
        >
          {saving ? t('growthIdentity.saving') : t('growthIdentity.saveDisplay')}
        </button>
      )}
    >
      <div className="space-y-5" data-testid="growth-cosmetic-closet">
        <p className="text-xs font-bold leading-relaxed text-slate-500">{t('growthIdentity.closetHint')}</p>
        {(['avatar', 'frame', 'theme', 'title'] as CosmeticType[]).map(type => {
          const allItems = identity.cosmetics.filter(item => item.type === type);
          const eligibleItems = type === 'title'
            ? allItems.filter(item => item.unlocked || item.sourceType === 'level')
            : allItems;
          const items = type === 'title'
            ? [...eligibleItems].sort((left, right) => {
              const leftSelected = left.key === draft.titleKey ? 1 : 0;
              const rightSelected = right.key === draft.titleKey ? 1 : 0;
              return rightSelected - leftSelected || Number(right.unlocked) - Number(left.unlocked);
            })
            : eligibleItems;
          const visibleItems = type === 'title' && !showAllTitles ? items.slice(0, 6) : items;
          return (
            <section key={type}>
              <h4 className="mb-2 text-sm font-black text-slate-800">{t(sectionLabels[type])}</h4>
              {items.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {type === 'theme' ? (
                    <button
                      type="button"
                      data-testid="cosmetic-theme.default"
                      disabled={saving}
                      onClick={() => setDraft(current => ({ ...current, themeKey: null }))}
                      className={`min-h-[52px] rounded-2xl border px-3 py-2 text-left text-xs font-black ${draft.themeKey === null ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-100 bg-slate-50 text-slate-600'}`}
                    >
                      {t('growthIdentity.defaultTheme')}
                    </button>
                  ) : null}
                  {visibleItems.map(item => {
                    const selected = draft[`${type}Key` as keyof GrowthProfileUpdate] === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-testid={`cosmetic-${item.key}`}
                        disabled={!item.unlocked || saving}
                        onClick={() => selectCosmetic(type, item.key)}
                        className={`min-h-[52px] rounded-2xl border px-3 py-2 text-left text-xs font-black ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-100 bg-slate-50 text-slate-600'} disabled:opacity-50`}
                      >
                        <span className="flex items-center gap-2">
                          {!item.unlocked ? <Lock size={15} aria-hidden="true" /> : type === 'avatar' ? <Star size={15} aria-hidden="true" /> : null}
                          <span>{item.displayName}</span>
                        </span>
                        {!item.unlocked && item.requiredLevel ? (
                          <span className="mt-1 block text-[10px] font-bold text-slate-400">{t('growthIdentity.levelUnlock', { level: item.requiredLevel })}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-400">{t('growthIdentity.noCosmetics')}</div>
              )}
              {type === 'title' && items.length > 6 ? (
                <button
                  type="button"
                  onClick={() => setShowAllTitles(current => !current)}
                  className="mt-2 min-h-[44px] w-full rounded-2xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-600 active:bg-indigo-100"
                >
                  {showAllTitles
                    ? t('growthIdentity.collapseOptions')
                    : t('growthIdentity.showAllTitles', { count: items.length })}
                </button>
              ) : null}
            </section>
          );
        })}

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-black text-slate-800">{t('growthIdentity.badgeSection')}</h4>
            <span className="text-xs font-black text-indigo-500">{draft.featuredAchievementIds.length}/3</span>
          </div>
          {badgeItems.length > 0 ? (
            <div className="space-y-2">
              {(showAllBadges ? badgeItems : badgeItems.slice(0, 6)).map(item => {
                const selected = draft.featuredAchievementIds.includes(item.id);
                const limitReached = draft.featuredAchievementIds.length >= 3 && !selected;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`achievement-badge-${item.id}`}
                    disabled={limitReached || saving}
                    onClick={() => toggleBadge(item.id)}
                    className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl border p-2.5 text-left ${selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-100 bg-white'} disabled:opacity-45`}
                  >
                    <GrowthIcon iconKey={item.iconKey} fallback={item.displayIcon} label={item.displayTitle} />
                    <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-700">{item.displayTitle}</span>
                    <span className="text-xs font-black text-indigo-500">{selected ? t('growthIdentity.selected') : t('growthIdentity.select')}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-400">{t('growthIdentity.noBadges')}</div>
          )}
          {badgeItems.length > 6 ? (
            <button
              type="button"
              onClick={() => setShowAllBadges(current => !current)}
              className="mt-2 min-h-[44px] w-full rounded-2xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-600 active:bg-indigo-100"
            >
              {showAllBadges
                ? t('growthIdentity.collapseOptions')
                : t('growthIdentity.showAllBadges', { count: badgeItems.length })}
            </button>
          ) : null}
        </section>
      </div>
    </BottomSheet>
  );
}
