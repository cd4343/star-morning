import { t } from '../i18n';

export type LevelStage = Readonly<{
  key: string;
  minLevel: number;
  maxLevel: number | null;
  titleKey: string;
  meaningKey: string;
  frameKey: string;
}>;

export const LEVEL_STAGES: ReadonlyArray<LevelStage> = [
  { key: 'seed', minLevel: 1, maxLevel: 3, titleKey: 'growthIdentity.stage.seed', meaningKey: 'growthIdentity.stage.seedMeaning', frameKey: 'frame.seed' },
  { key: 'steady', minLevel: 4, maxLevel: 7, titleKey: 'growthIdentity.stage.steady', meaningKey: 'growthIdentity.stage.steadyMeaning', frameKey: 'frame.morning' },
  { key: 'explorer', minLevel: 8, maxLevel: 12, titleKey: 'growthIdentity.stage.explorer', meaningKey: 'growthIdentity.stage.explorerMeaning', frameKey: 'frame.compass' },
  { key: 'builder', minLevel: 13, maxLevel: 18, titleKey: 'growthIdentity.stage.builder', meaningKey: 'growthIdentity.stage.builderMeaning', frameKey: 'frame.blocks' },
  { key: 'navigator', minLevel: 19, maxLevel: 25, titleKey: 'growthIdentity.stage.navigator', meaningKey: 'growthIdentity.stage.navigatorMeaning', frameKey: 'frame.orbit' },
  { key: 'pioneer', minLevel: 26, maxLevel: null, titleKey: 'growthIdentity.stage.pioneer', meaningKey: 'growthIdentity.stage.pioneerMeaning', frameKey: 'frame.galaxy' },
];

export const normalizeLevel = (value: unknown) => {
  const level = Number(value);
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
};

export const getLevelStage = (value: unknown) => {
  const level = normalizeLevel(value);
  return LEVEL_STAGES.find(stage => level >= stage.minLevel && (stage.maxLevel === null || level <= stage.maxLevel))!;
};

export const getLevelTitle = (value: unknown) => t(getLevelStage(value).titleKey);

export const getLevelProgress = (value: unknown) => {
  const numericXp = Number(value);
  const totalXp = Number.isFinite(numericXp) ? Math.max(0, Math.floor(numericXp)) : 0;
  const currentXp = totalXp % 100;
  return { totalXp, level: Math.floor(totalXp / 100) + 1, currentXp, nextLevelXp: 100, remainingXp: 100 - currentXp };
};
