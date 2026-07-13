import { describe, expect, it } from 'vitest';
import { getLevelIdentityFromXp, getLevelStage, normalizeLevel } from './levelIdentity';

describe('Phase 4 个人等级成长身份', () => {
  it.each([
    [1, '启程星芽'], [3, '启程星芽'], [4, '稳步行动家'], [7, '稳步行动家'],
    [8, '自主探索者'], [12, '自主探索者'], [13, '习惯建造师'], [18, '习惯建造师'],
    [19, '成长领航员'], [25, '成长领航员'], [26, '星河开拓者'],
  ])('Lv.%i 使用批准的阶段称号 %s', (level, title) => {
    expect(getLevelStage(level).title).toBe(title);
  });

  it('无效等级统一回退 Lv.1，避免页面出现空身份', () => {
    expect([undefined, null, Number.NaN, -9, 0].map(normalizeLevel)).toEqual([1, 1, 1, 1, 1]);
  });

  it('成长经验仍严格保持每 100 点一级且不与特权进度混算', () => {
    expect(getLevelIdentityFromXp(0)).toMatchObject({ level: 1, currentXp: 0, nextLevelXp: 100, remainingXp: 100 });
    expect(getLevelIdentityFromXp(99)).toMatchObject({ level: 1, currentXp: 99, remainingXp: 1 });
    expect(getLevelIdentityFromXp(100)).toMatchObject({ level: 2, currentXp: 0, remainingXp: 100 });
    expect(getLevelIdentityFromXp(1249)).toMatchObject({ level: 13, currentXp: 49, remainingXp: 51 });
    expect(getLevelIdentityFromXp(-1)).toMatchObject({ totalXp: 0, level: 1 });
    expect(getLevelIdentityFromXp('invalid')).toMatchObject({ totalXp: 0, level: 1 });
  });
});
