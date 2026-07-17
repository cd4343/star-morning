import { describe, expect, it } from 'vitest';
import {
  deduplicateExploreCandidates,
  getCandidateRejection,
  parseExploreIntent,
  rankExploreCandidates,
  resolveAuthoritativeField,
  scoreExploreCandidate,
  type ExploreDiscoveryCandidate,
} from './exploreDiscoveryRules';

const now = new Date('2026-07-17T04:00:00.000Z');

const candidate = (overrides: Partial<ExploreDiscoveryCandidate> = {}): ExploreDiscoveryCandidate => ({
  sourceKey: 'amap-poi',
  sourceUrl: 'https://restapi.amap.com/v3/place/text',
  trustTier: 'A',
  type: 'poi',
  title: '上海自然博物馆',
  summary: '高德标注为博物馆，地址为静安区北京西路。',
  imageUrl: '/uploads/explore/family/item.webp',
  category: '博物馆',
  city: '上海',
  district: '静安区',
  address: '静安区北京西路510号',
  latitude: 31.236,
  longitude: 121.462,
  experienceKeys: ['museum'],
  objectiveKeys: ['knowledge'],
  verifiedAt: '2026-07-17T03:00:00.000Z',
  freshUntil: '2026-08-16T03:00:00.000Z',
  authorityFields: ['title', 'address', 'latitude', 'longitude', 'category', 'imageUrl'],
  ...overrides,
});

describe('Explore discovery rules', () => {
  it('parses verifiable conditions while surfacing unsupported claims and preserving unknown words', () => {
    const parsed = parseExploreIntent({
      city: '上海',
      customText: '周末想去浦东室内做手工，预算100元，人少，车程30分钟，https://example.com/a 神秘主题',
    }, now);

    expect(parsed.hardConditions).toMatchObject({
      city: '上海', dateFrom: '2026-07-18', dateTo: '2026-07-19', budgetMax: 100,
      indoorPreference: 'indoor', officialUrl: 'https://example.com/a',
    });
    expect(parsed.preferences.experienceKeys).toContain('handcraft');
    expect(parsed.preferences.queryText).toContain('神秘主题');
    expect(parsed.unsupported).toEqual(expect.arrayContaining(['crowd', 'route_time']));
  });

  it('uses field authority and blocks an unresolved equal-tier critical conflict', () => {
    expect(resolveAuthoritativeField('activityStart', [
      { value: '2026-07-20', trustTier: 'B', sourceKey: 'listing' },
      { value: '2026-07-21', trustTier: 'S', sourceKey: 'official' },
    ])).toMatchObject({ value: '2026-07-21', conflict: false });

    expect(resolveAuthoritativeField('activityStart', [
      { value: '2026-07-20', trustTier: 'S', sourceKey: 'official-a' },
      { value: '2026-07-21', trustTier: 'S', sourceKey: 'official-b' },
    ])).toMatchObject({ conflict: true });
  });

  it('rejects stale, incomplete, hard-condition and critical-conflict candidates', () => {
    const parsed = parseExploreIntent({ city: '上海', budgetMax: 100, experienceKeys: ['museum'] }, now);
    expect(getCandidateRejection(candidate({ freshUntil: '2026-07-17T03:59:59.000Z' }), parsed, now, 8)).toBe('stale');
    expect(getCandidateRejection(candidate({ imageUrl: '' }), parsed, now, 8)).toBe('incomplete');
    expect(getCandidateRejection(candidate({ city: '北京' }), parsed, now, 8)).toBe('city');
    expect(getCandidateRejection(candidate({ priceAmount: 120 }), parsed, now, 8)).toBe('budget');
    expect(getCandidateRejection(candidate({ ageMin: 10 }), parsed, now, 8)).toBe('age');
    expect(getCandidateRejection(candidate({ criticalConflict: true }), parsed, now, 8)).toBe('conflict');
    expect(getCandidateRejection(candidate({ priceAmount: 80 }), parsed, now, 8)).toBeNull();
  });

  it('calculates the locked integer score and keeps place/activity diversity', () => {
    const parsed = parseExploreIntent({
      city: '上海', districtScope: ['静安区'], datePreset: 'weekend', budgetMax: 100,
      objective: 'knowledge', experienceKeys: ['museum'],
    }, now);
    expect(scoreExploreCandidate(candidate({ priceAmount: 80 }), parsed, now)).toBe(85);

    const place = candidate({ id: 'place', priceAmount: 80 });
    const activity = candidate({
      id: 'activity', type: 'activity', title: '周末博物馆讲解活动', venue: '上海自然博物馆',
      activityStart: '2026-07-18', activityEnd: '2026-07-18', trustTier: 'S', sourceKey: 'official',
    });
    const secondPlace = candidate({ id: 'place-2', title: '上海科技馆', externalId: 'amap-2' });
    const ranked = rankExploreCandidates([place, secondPlace, activity], parsed, now);
    expect(ranked).toHaveLength(3);
    expect(ranked.map(item => item.type)).toContain('activity');
    expect(ranked[0].recommendationRole).toBe('primary');
  });

  it('deduplicates by provider id and nearby normalized place identity', () => {
    const rows = deduplicateExploreCandidates([
      candidate({ id: 'a', externalId: 'poi-1' }),
      candidate({ id: 'b', externalId: 'poi-1', title: '重复名称' }),
      candidate({ id: 'c', externalId: 'poi-2', latitude: 31.2362, longitude: 121.4621 }),
    ]);
    expect(rows.map(item => item.id)).toEqual(['a']);
  });
});
