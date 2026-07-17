import { afterEach, describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { ensureExploreSourceSchema, syncExploreSourceCatalog } from './exploreSourceCatalog';
import {
  addVerifiedExploreResultToPlan,
  getChildAgeForFamily,
  searchExploreDiscovery,
} from './exploreDiscoveryRoutes';
import type { ExploreDiscoveryCandidate } from './exploreDiscoveryRules';

const databases: Database[] = [];
const now = new Date('2026-07-17T04:00:00.000Z');

afterEach(async () => {
  await Promise.all(databases.splice(0).map(database => database.close()));
});

const createDatabase = async () => {
  const database = await open({ filename: ':memory:', driver: sqlite3.Database });
  databases.push(database);
  await database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT NOT NULL, role TEXT NOT NULL, birthdate TEXT);
    CREATE TABLE explore_feed_items (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, type TEXT, title TEXT NOT NULL, summary TEXT,
      imageUrl TEXT, category TEXT, latitude REAL, longitude REAL, amapPoiId TEXT, sourceUrl TEXT,
      status TEXT DEFAULT 'pending_review', recommendDate TEXT, createdAt TEXT, venue TEXT, district TEXT,
      feedCategory TEXT, ageMin INTEGER, ageMax INTEGER, activityStart TEXT, activityEnd TEXT,
      signupDeadline TEXT, price TEXT, bookingMethod TEXT, officialUrl TEXT, recommendReason TEXT,
      notes TEXT, verifyStatus TEXT, recommendScore INTEGER, city TEXT, validFrom TEXT, validUntil TEXT,
      enrichmentStatus TEXT, enrichmentAttempts INTEGER DEFAULT 0, nextEnrichmentAt TEXT,
      lastEnrichmentError TEXT, imageSourceUrl TEXT, contentSourceType TEXT, experienceTags TEXT
    );
    CREATE TABLE explore_places (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, category TEXT, city TEXT,
      address TEXT, latitude REAL, longitude REAL, source TEXT, externalId TEXT, summary TEXT,
      whyGo TEXT, observeTips TEXT, questionPrompts TEXT, tags TEXT, status TEXT, createdBy TEXT,
      sourceFeedId TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT, deletedAt TEXT
    );
    INSERT INTO users VALUES
      ('child-a', 'family-a', 'child', '2016-07-18'),
      ('child-b', 'family-b', 'child', '2015-01-01');
  `);
  await ensureExploreSourceSchema(database);
  await syncExploreSourceCatalog(database, now);
  return database;
};

const candidate = (overrides: Partial<ExploreDiscoveryCandidate> = {}): ExploreDiscoveryCandidate => ({
  externalId: 'amap-1',
  sourceKey: 'amap-poi',
  sourceUrl: 'https://restapi.amap.com/v3/place/text',
  trustTier: 'A',
  type: 'poi',
  title: '上海科技馆',
  summary: '高德地点信息：上海市浦东新区世纪大道2000号',
  imageUrl: 'https://images.example.com/museum.jpg',
  imageSourceUrl: 'https://images.example.com/museum.jpg',
  category: '博物馆',
  city: '上海',
  district: '浦东新区',
  address: '上海市浦东新区世纪大道2000号',
  latitude: 31.219,
  longitude: 121.536,
  priceAmount: 50,
  experienceKeys: ['science_museum'],
  objectiveKeys: ['knowledge'],
  verifiedAt: now.toISOString(),
  freshUntil: '2026-08-16T04:00:00.000Z',
  authorityFields: ['title', 'address', 'latitude', 'longitude', 'category', 'imageUrl'],
  ...overrides,
});

describe('trusted parent Explore discovery', () => {
  it('derives age from a child in the same family and rejects cross-family access', async () => {
    const database = await createDatabase();
    expect(await getChildAgeForFamily(database, 'family-a', 'child-a', now)).toBe(9);
    await expect(getChildAgeForFamily(database, 'family-a', 'child-b', now)).rejects.toThrow('child_not_found');
  });

  it('returns only complete reliable results, caps provider queries, and stores evidence without raw text', async () => {
    const database = await createDatabase();
    const queries: string[] = [];
    const result = await searchExploreDiscovery(database, 'family-a', {
      childId: 'child-a', city: '上海', districtScope: ['浦东新区'],
      experienceKeys: ['science_museum'], customText: '想去科技馆，最好人少，预算100元', budgetMax: 100,
    }, {
      now: () => now,
      searchProvider: async query => {
        queries.push(query);
        return [candidate(), candidate({ externalId: 'amap-duplicate' }), candidate({ externalId: 'wrong-city', city: '杭州' })];
      },
      cacheImage: async () => '/uploads/explore/family-a/feed/verified.jpg',
    });

    expect(queries.length).toBeLessThanOrEqual(4);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      title: '上海科技馆', imageUrl: '/uploads/explore/family-a/feed/verified.jpg', recommendationRole: 'primary',
    });
    expect(result.intent.unsupported).toContain('crowd');
    const evidence = await database.get('SELECT * FROM explore_feed_item_evidence');
    expect(evidence).toMatchObject({ source_key: 'amap-poi', evidence_status: 'active' });
    const run = await database.get('SELECT * FROM explore_discovery_runs');
    expect(JSON.stringify(run)).not.toContain('想去科技馆');
  });

  it('uses still-fresh local evidence when the live provider temporarily fails', async () => {
    const database = await createDatabase();
    const first = await searchExploreDiscovery(database, 'family-a', {
      city: '上海', experienceKeys: ['science_museum'],
    }, {
      now: () => now,
      searchProvider: async () => [candidate()],
      cacheImage: async () => '/uploads/explore/family-a/feed/verified.jpg',
    });
    expect(first.results).toHaveLength(1);

    const second = await searchExploreDiscovery(database, 'family-a', {
      city: '上海', experienceKeys: ['science_museum'],
    }, {
      now: () => new Date('2026-07-17T05:00:00.000Z'),
      searchProvider: async () => { throw new Error('provider unavailable'); },
      cacheImage: async url => url,
    });
    expect(second.partial).toBe(true);
    expect(second.results).toHaveLength(1);
  });

  it('merges an official activity with a place and reports a failed secondary source as partial', async () => {
    const database = await createDatabase();
    const activity = candidate({
      externalId: 'museum-event-1',
      sourceKey: 'shanghai-museum-events',
      sourceUrl: 'https://events.shanghaimuseum.net/activity',
      trustTier: 'S',
      type: 'activity',
      title: '古代文明亲子工坊',
      summary: '地点：上海博物馆人民广场馆观众活动中心',
      address: undefined,
      venue: '上海博物馆人民广场馆观众活动中心',
      latitude: undefined,
      longitude: undefined,
      activityStart: '2026-07-19',
      activityEnd: '2026-07-19',
      priceAmount: undefined,
      authorityFields: ['title', 'imageUrl', 'venue', 'activityStart', 'activityEnd'],
    });
    const result = await searchExploreDiscovery(database, 'family-a', { city: '上海' }, {
      now: () => now,
      searchProvider: async () => [candidate()],
      officialSearch: async () => ({ candidates: [activity], failedSourceKeys: ['national-public-culture-cloud'] }),
      cacheImage: async url => `/uploads/explore/family-a/feed/${url.includes('museum') ? 'activity' : 'place'}.jpg`,
    });

    expect(result.partial).toBe(true);
    expect(result.results.map(item => item.type).sort()).toEqual(['activity', 'poi']);
  });

  it('adds a verified result to the family plan exactly once', async () => {
    const database = await createDatabase();
    const found = await searchExploreDiscovery(database, 'family-a', { city: '上海' }, {
      now: () => now,
      searchProvider: async () => [candidate()],
      cacheImage: async () => '/uploads/explore/family-a/feed/verified.jpg',
    });
    const first = await addVerifiedExploreResultToPlan(database, 'family-a', 'parent-a', found.results[0].id!, now);
    const second = await addVerifiedExploreResultToPlan(database, 'family-a', 'parent-a', found.results[0].id!, now);
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect((await database.get('SELECT COUNT(*) AS count FROM explore_places')).count).toBe(1);
    expect((await database.get('SELECT status FROM explore_feed_items WHERE id = ?', found.results[0].id)).status).toBe('pending_review');
  });
});
