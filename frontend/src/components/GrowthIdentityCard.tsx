import { Palette, Star } from 'lucide-react';
import { t } from '../i18n';
import type { GrowthIdentity } from '../types/growthIdentity';
import { GrowthIcon } from './GrowthIcon';

type GrowthIdentityCardProps = {
  identity: GrowthIdentity | null;
  loading: boolean;
  unavailable: boolean;
  fallback: { name?: string; avatar?: string; level?: number; xp?: number; maxXp?: number };
  privilegePoints: number;
  rewardXpTotal: number;
  onOpenCloset: () => void;
};

const avatarTone: Record<string, string> = {
  'avatar.star-blue': 'bg-sky-100 text-sky-500',
  'avatar.star-yellow': 'bg-amber-100 text-amber-500',
  'avatar.star-purple': 'bg-violet-100 text-violet-500',
};

const frameTone: Record<string, string> = {
  'frame.seed': 'ring-lime-300',
  'frame.morning': 'ring-amber-300',
  'frame.compass': 'ring-sky-300',
  'frame.blocks': 'ring-indigo-300',
  'frame.orbit': 'ring-violet-300',
  'frame.galaxy': 'ring-fuchsia-300',
};

const themeTone: Record<string, string> = {
  'theme.life': 'from-emerald-50 to-white border-emerald-100',
  'theme.study': 'from-sky-50 to-white border-sky-100',
  'theme.sport': 'from-orange-50 to-white border-orange-100',
  'theme.activity': 'from-violet-50 to-white border-violet-100',
  'theme.explore': 'from-cyan-50 to-white border-cyan-100',
};

export function GrowthIdentityCard({
  identity, loading, unavailable, fallback, privilegePoints, rewardXpTotal, onOpenCloset,
}: GrowthIdentityCardProps) {
  const selected = identity?.selected;
  const level = identity?.levelIdentity.level || Number(fallback.level || 1);
  const currentXp = identity?.levelIdentity.currentXp ?? (Number(fallback.xp || 0) % Number(fallback.maxXp || 100));
  const maxXp = identity?.levelIdentity.nextLevelXp || Number(fallback.maxXp || 100);
  const remainingXp = identity?.levelIdentity.remainingXp ?? Math.max(maxXp - currentXp, 0);
  const rewardXpCurrent = Math.max(0, rewardXpTotal) % 100;
  const rewardXpRemaining = rewardXpCurrent === 0 ? 100 : 100 - rewardXpCurrent;
  const title = identity?.cosmetics.find(item => item.key === selected?.titleKey)?.displayName
    || identity?.levelIdentity.stage.title
    || t('growthIdentity.fallbackTitle');
  const avatarKey = selected?.avatarKey || 'avatar.current';
  const frameKey = selected?.frameKey || '';
  const featured = identity?.unlockedAchievements.filter(item => selected?.featuredAchievementIds.includes(item.id)) || [];

  return (
    <section
      data-testid="child-growth-account"
      data-avatar-key={avatarKey}
      className={`rounded-[1.75rem] border bg-gradient-to-br p-4 shadow-sm ${themeTone[selected?.themeKey || ''] || 'from-indigo-50 to-white border-indigo-100'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-3xl bg-white text-3xl shadow-sm ring-4 ${frameTone[frameKey] || 'ring-indigo-200'}`}>
          {avatarKey === 'avatar.current' ? (
            <span role="img" aria-label={t('growthIdentity.familyAvatar')}>{identity?.child.familyAvatar || fallback.avatar || '⭐'}</span>
          ) : (
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${avatarTone[avatarKey] || 'bg-indigo-100 text-indigo-500'}`}>
              <Star size={28} fill="currentColor" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black text-indigo-500">{t('growthIdentity.currentIdentity')}</div>
          <div className="truncate text-xl font-black text-slate-900">{title}</div>
          <div className="mt-0.5 text-xs font-bold text-slate-500">
            {identity?.child.name || fallback.name || t('growthIdentity.childFallback')} · Lv.{level}
          </div>
          {identity?.levelIdentity.stage.meaning ? (
            <div className="mt-1 text-[11px] font-bold text-slate-500">{identity.levelIdentity.stage.meaning}</div>
          ) : null}
        </div>
        <div className="rounded-2xl bg-white/80 px-3 py-2 text-right shadow-sm">
          <div className="text-lg font-black text-indigo-700">{privilegePoints} {t('growth.pointsUnit')}</div>
          <div className="text-[10px] font-black text-indigo-400">{t('growth.available')}</div>
        </div>
      </div>

      {featured.length > 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/70 p-2.5">
          <div className="text-[10px] font-black text-slate-500">{t('growthIdentity.featuredBadges')}</div>
          <div className="flex gap-1.5">
            {featured.map(item => (
              <GrowthIcon key={item.id} iconKey={item.iconKey} fallback={item.displayIcon} label={item.displayTitle} className="h-9 w-9" />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <div>
          <div className="flex items-center justify-between gap-2 text-xs font-black">
            <span className="text-violet-600">{t('growth.levelXp')}</span>
            <span className="text-slate-500">{currentXp} / {maxXp}</span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-violet-100">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-indigo-500" style={{ width: `${Math.min((currentXp / Math.max(1, maxXp)) * 100, 100)}%` }} />
          </div>
          <div className="mt-1 text-[10px] font-bold text-slate-500">{t('growth.levelXpHint', { remaining: remainingXp })}</div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 text-xs font-black">
            <span className="text-blue-600">{t('growth.rightsProgress')}</span>
            <span className="text-slate-500">{rewardXpCurrent} / 100</span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-500" style={{ width: `${rewardXpCurrent}%` }} />
          </div>
          <div className="mt-1 text-[10px] font-bold text-slate-500">{t('growth.rightsHint', { remaining: rewardXpRemaining })}</div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-white/70 px-3 py-2 text-[11px] font-bold leading-relaxed text-slate-500">
        {unavailable ? t('growthIdentity.unavailable') : loading ? t('growthIdentity.loading') : t('growth.accountsExplain')}
      </div>

      {identity ? (
        <button
          type="button"
          onClick={onOpenCloset}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white active:bg-indigo-700"
        >
          <Palette size={18} aria-hidden="true" />
          {t('growthIdentity.adjustDisplay')}
        </button>
      ) : null}
    </section>
  );
}
