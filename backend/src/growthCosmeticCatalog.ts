import { LEVEL_STAGES } from './levelIdentity';
import { SYSTEM_ACHIEVEMENT_CATALOG } from './growthIdentityCatalog';

export type CosmeticType = 'avatar' | 'frame' | 'theme' | 'title';
export type CosmeticSourceType = 'default' | 'level' | 'achievement';

export type GrowthCosmeticDefinition = Readonly<{
  key: string;
  type: CosmeticType;
  displayName: string;
  sourceType: CosmeticSourceType;
  sourceKey?: string;
  requiredLevel?: number;
}>;

const fixedCosmetics: GrowthCosmeticDefinition[] = [
  { key: 'avatar.current', type: 'avatar', displayName: '家庭头像', sourceType: 'default' },
  { key: 'avatar.star-blue', type: 'avatar', displayName: '蓝色星星', sourceType: 'default' },
  { key: 'avatar.star-yellow', type: 'avatar', displayName: '黄色星星', sourceType: 'default' },
  { key: 'avatar.star-purple', type: 'avatar', displayName: '紫色星星', sourceType: 'default' },
  ...LEVEL_STAGES.map(stage => ({
    key: stage.defaultFrameKey,
    type: 'frame' as const,
    displayName: `${stage.title}头像框`,
    sourceType: 'level' as const,
    sourceKey: stage.key,
    requiredLevel: stage.minLevel,
  })),
  { key: 'theme.life', type: 'theme', displayName: '生活绿意', sourceType: 'achievement', sourceKey: 'life.count.100' },
  { key: 'theme.study', type: 'theme', displayName: '学习书海', sourceType: 'achievement', sourceKey: 'study.count.100' },
  { key: 'theme.sport', type: 'theme', displayName: '运动活力', sourceType: 'achievement', sourceKey: 'sport.count.100' },
  { key: 'theme.activity', type: 'theme', displayName: '活动创意', sourceType: 'achievement', sourceKey: 'activity.count.100' },
  { key: 'theme.explore', type: 'theme', displayName: '探索远行', sourceType: 'achievement', sourceKey: 'explore.checkin.25' },
  ...LEVEL_STAGES.map(stage => ({
    key: `title.stage.${stage.key}`,
    type: 'title' as const,
    displayName: stage.title,
    sourceType: 'level' as const,
    sourceKey: stage.key,
    requiredLevel: stage.minLevel,
  })),
  ...SYSTEM_ACHIEVEMENT_CATALOG.map(achievement => ({
    key: `title.achievement.${achievement.systemKey}`,
    type: 'title' as const,
    displayName: achievement.title,
    sourceType: 'achievement' as const,
    sourceKey: achievement.systemKey,
  })),
];

const keys = fixedCosmetics.map(item => item.key);
if (new Set(keys).size !== keys.length) throw new Error('Duplicate growth cosmetic key');
if (fixedCosmetics.some(item => !item.key || !item.displayName)) throw new Error('Invalid growth cosmetic definition');

export const GROWTH_COSMETIC_CATALOG: ReadonlyArray<GrowthCosmeticDefinition> = Object.freeze(fixedCosmetics);
export const GROWTH_COSMETIC_BY_KEY = new Map(GROWTH_COSMETIC_CATALOG.map(item => [item.key, item]));
