import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import {
  SYSTEM_ACHIEVEMENT_CATALOG,
  getSystemAchievementByKey,
  getSystemAchievementsByLegacySignature,
} from './growthIdentityCatalog';

describe('Phase 4 系统成就目录', () => {
  it('固定覆盖现有92项系统成就，防止发布时静默漏项', () => {
    expect(SYSTEM_ACHIEVEMENT_CATALOG).toHaveLength(92);
    expect(createHash('sha256').update(JSON.stringify(SYSTEM_ACHIEVEMENT_CATALOG)).digest('hex'))
      .toBe('e20d42e1a8c6a0185646d5a493a9e100dc2212c8fea9d32a9c1c41f3099cf1e1');
  });

  it('稳定键、中文名称和图标键全局唯一，避免孩子看到同名或同图标成就', () => {
    const uniqueCount = (values: string[]) => new Set(values).size;

    expect(uniqueCount(SYSTEM_ACHIEVEMENT_CATALOG.map(item => item.systemKey))).toBe(92);
    expect(uniqueCount(SYSTEM_ACHIEVEMENT_CATALOG.map(item => item.title))).toBe(92);
    expect(uniqueCount(SYSTEM_ACHIEVEMENT_CATALOG.map(item => item.iconKey))).toBe(92);
  });

  it('每项都具备可迁移的旧标题和国际化展示键', () => {
    for (const item of SYSTEM_ACHIEVEMENT_CATALOG) {
      expect(item.legacyTitles.length).toBeGreaterThan(0);
      expect(item.legacyTitles.every(title => title.trim().length > 0)).toBe(true);
      expect(item.displayTitleKey).toBe(`achievement.system.${item.systemKey}.title`);
      expect(item.displayDescriptionKey).toBe(`achievement.system.${item.systemKey}.description`);
      expect(item.conditionType).not.toBe('');
      expect(Number.isInteger(item.conditionValue)).toBe(true);
      expect(item.category).not.toBe('');
    }
  });

  it('按稳定键查找返回同一个只读目录项，未知键明确返回空', () => {
    const first = SYSTEM_ACHIEVEMENT_CATALOG[0];
    expect(getSystemAchievementByKey(first.systemKey)).toBe(first);
    expect(getSystemAchievementByKey('unknown.achievement')).toBeUndefined();
  });

  it('旧数据按完整条件签名只返回候选项，保留标题用于保守消歧', () => {
    expect(getSystemAchievementsByLegacySignature({
      conditionType: 'streak_days',
      conditionValue: 3,
      conditionCategory: '生活',
      category: '生活',
    }).map(item => item.systemKey)).toEqual(['life.streak.3']);

    expect(getSystemAchievementsByLegacySignature({
      conditionType: 'manual',
      conditionValue: 0,
      category: '探索',
    })).toHaveLength(4);
  });
});
