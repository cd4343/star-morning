export type CosmeticType = 'avatar' | 'frame' | 'theme' | 'title';

export interface GrowthCosmetic {
  key: string;
  type: CosmeticType;
  displayName: string;
  sourceType: 'default' | 'level' | 'achievement';
  sourceKey?: string;
  requiredLevel?: number;
  unlocked: boolean;
}

export interface GrowthAchievementBadge {
  id: string;
  systemKey?: string | null;
  isSystem?: boolean;
  displayTitle: string;
  displayDescription?: string;
  displayIcon?: string;
  iconKey?: string | null;
  category?: string;
}

export interface GrowthProfileSelection {
  avatarKey: string;
  frameKey: string;
  themeKey: string | null;
  titleKey: string;
  featuredAchievementIds: string[];
}

export interface GrowthIdentity {
  child: { id: string; name: string; familyAvatar: string | null };
  levelIdentity: {
    totalXp: number;
    level: number;
    currentXp: number;
    nextLevelXp: number;
    remainingXp: number;
    stage: {
      key: string;
      minLevel: number;
      maxLevel: number | null;
      title: string;
      meaning: string;
      defaultFrameKey: string;
    };
  };
  selected: GrowthProfileSelection;
  cosmetics: GrowthCosmetic[];
  unlockedAchievements: GrowthAchievementBadge[];
}

export type GrowthProfileUpdate = GrowthProfileSelection;

export const isGrowthIdentity = (value: unknown): value is GrowthIdentity => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GrowthIdentity>;
  return Boolean(
    candidate.child &&
    candidate.levelIdentity?.stage &&
    candidate.selected &&
    Array.isArray(candidate.cosmetics) &&
    Array.isArray(candidate.unlockedAchievements),
  );
};
