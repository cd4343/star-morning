import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import {
  getChildExploreIntent,
  getEnrichmentRetryAt,
  isExploreFeedItemComplete,
  normalizeExploreSelections,
  saveChildExploreIntent,
  selectExploreRecommendations,
} from './exploreExperience';

describe('探索体验选择规则', () => {
  it('孩子最多选择两项，随便看看不能和具体体验混选', () => {
    expect(normalizeExploreSelections(['science_experiment', 'museum'])).toEqual(['science_experiment', 'museum']);
    expect(() => normalizeExploreSelections(['science_experiment', 'museum', 'park_walk'])).toThrow('最多选择 2 项');
    expect(() => normalizeExploreSelections(['any', 'museum'])).toThrow('随便看看不能和其他选项一起选择');
    expect(() => normalizeExploreSelections(['unknown-option'])).toThrow('体验选项不存在');
  });

  it('只允许孩子保存自己家庭已启用的体验选项', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    try {
      await db.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT, role TEXT);
        CREATE TABLE explore_child_intents (childId TEXT PRIMARY KEY, familyId TEXT, selectionsJson TEXT, updatedAt TEXT);
        CREATE TABLE explore_experience_settings (familyId TEXT PRIMARY KEY, disabledOptionsJson TEXT, updatedAt TEXT);
        INSERT INTO users VALUES ('child-1', 'family-1', 'child'), ('child-2', 'family-2', 'child');
        INSERT INTO explore_experience_settings VALUES ('family-1', '["museum"]', CURRENT_TIMESTAMP);
      `);
      await expect(saveChildExploreIntent(db, 'family-1', 'child-2', ['science_experiment'])).rejects.toMatchObject({ statusCode: 404 });
      await expect(saveChildExploreIntent(db, 'family-1', 'child-1', ['museum'])).rejects.toThrow('已被家长停用');
      await saveChildExploreIntent(db, 'family-1', 'child-1', ['science_experiment', 'handcraft']);
      const intent = await getChildExploreIntent(db, 'family-1', 'child-1');
      expect(intent.selections).toEqual(['science_experiment', 'handcraft']);
      expect(intent.groups.flatMap(group => group.options).map(option => option.key)).not.toContain('museum');
    } finally {
      await db.close();
    }
  });
});

describe('探索推荐完整度和排序', () => {
  const completePlace = {
    id: 'place-1', type: 'poi', title: '上海自然博物馆', summary: '可以观察恐龙化石和自然标本。',
    imageUrl: '/uploads/explore/feed/family-1/place.jpg', latitude: 31.2, longitude: 121.4,
    category: '博物馆', feedCategory: '文博', recommendScore: 4,
  };
  const completeActivity = {
    id: 'activity-1', type: 'source', title: '周末小小科学家活动', summary: '跟着老师完成一次有趣的科学实验。',
    imageUrl: '/uploads/explore/feed/family-1/activity.jpg', venue: '城市科技馆', activityStart: '2026-07-18',
    category: '活动', feedCategory: '科普', recommendScore: 5,
  };

  it('缺少真实图片、说明或地点活动信息的内容绝不进入孩子推荐', () => {
    expect(isExploreFeedItemComplete(completePlace)).toBe(true);
    expect(isExploreFeedItemComplete({ ...completePlace, imageUrl: null })).toBe(false);
    expect(isExploreFeedItemComplete({ ...completePlace, summary: '' })).toBe(false);
    expect(isExploreFeedItemComplete({ ...completePlace, latitude: null, longitude: null })).toBe(false);
    expect(isExploreFeedItemComplete({ ...completeActivity, venue: null, activityStart: null })).toBe(false);
  });

  it('只返回一个主推荐和两个备选，并优先混合地点与活动', () => {
    const results = selectExploreRecommendations([
      completePlace,
      completeActivity,
      { ...completePlace, id: 'place-2', title: '儿童公园', category: '公园', feedCategory: '户外', recommendScore: 3 },
      { ...completePlace, id: 'incomplete', imageUrl: null },
    ], ['science_experiment']);

    expect(results).toHaveLength(3);
    expect(results[0].recommendationRole).toBe('primary');
    expect(results.slice(1).every(item => item.recommendationRole === 'alternative')).toBe(true);
    expect(results.map(item => item.id)).not.toContain('incomplete');
    expect(new Set(results.map(item => item.recommendationKind))).toEqual(new Set(['place', 'activity']));
  });
});

describe('探索自动补全重试节奏', () => {
  it('按创建时间在 1 小时、6 小时和 24 小时重试，三次后停止', () => {
    const createdAt = '2026-07-16T00:00:00.000Z';
    expect(getEnrichmentRetryAt(createdAt, 0)).toBe('2026-07-16T01:00:00.000Z');
    expect(getEnrichmentRetryAt(createdAt, 1)).toBe('2026-07-16T06:00:00.000Z');
    expect(getEnrichmentRetryAt(createdAt, 2)).toBe('2026-07-17T00:00:00.000Z');
    expect(getEnrichmentRetryAt(createdAt, 3)).toBeNull();
  });
});
