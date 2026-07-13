export type LevelStageKey = 'seed' | 'steady' | 'explorer' | 'builder' | 'navigator' | 'pioneer';

export type LevelStage = Readonly<{
  key: LevelStageKey;
  minLevel: number;
  maxLevel: number | null;
  title: string;
  meaning: string;
  defaultFrameKey: string;
}>;

export const LEVEL_STAGES: ReadonlyArray<LevelStage> = Object.freeze([
  { key: 'seed', minLevel: 1, maxLevel: 3, title: '启程星芽', meaning: '愿意开始就是第一步', defaultFrameKey: 'frame.seed' },
  { key: 'steady', minLevel: 4, maxLevel: 7, title: '稳步行动家', meaning: '能把小步骤继续做下去', defaultFrameKey: 'frame.morning' },
  { key: 'explorer', minLevel: 8, maxLevel: 12, title: '自主探索者', meaning: '开始选择并安排自己的行动', defaultFrameKey: 'frame.compass' },
  { key: 'builder', minLevel: 13, maxLevel: 18, title: '习惯建造师', meaning: '逐渐形成稳定节奏', defaultFrameKey: 'frame.blocks' },
  { key: 'navigator', minLevel: 19, maxLevel: 25, title: '成长领航员', meaning: '能复盘、计划和帮助家人', defaultFrameKey: 'frame.orbit' },
  { key: 'pioneer', minLevel: 26, maxLevel: null, title: '星河开拓者', meaning: '持续探索自己的成长方向', defaultFrameKey: 'frame.galaxy' },
]);

export const normalizeLevel = (value: unknown) => {
  const level = Number(value);
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
};

export const getLevelStage = (level: unknown): LevelStage => {
  const safeLevel = normalizeLevel(level);
  return LEVEL_STAGES.find(stage => safeLevel >= stage.minLevel && (stage.maxLevel === null || safeLevel <= stage.maxLevel))!;
};

export const getLevelIdentityFromXp = (value: unknown) => {
  const numericXp = Number(value);
  const totalXp = Number.isFinite(numericXp) ? Math.max(0, Math.floor(numericXp)) : 0;
  const level = Math.floor(totalXp / 100) + 1;
  const currentXp = totalXp % 100;
  const nextLevelXp = 100;
  return {
    totalXp,
    level,
    currentXp,
    nextLevelXp,
    remainingXp: nextLevelXp - currentXp,
    stage: getLevelStage(level),
  };
};
