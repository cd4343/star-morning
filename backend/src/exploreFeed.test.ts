import { afterEach, describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { getParentExploreFeedSettings } from './exploreFeed';

const databases: Database[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map(db => db.close()));
});

const createExploreFeedDatabase = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  databases.push(db);
  await db.exec(`
    CREATE TABLE families (
      id TEXT PRIMARY KEY,
      exploreCity TEXT,
      exploreFeedDailyLimit INTEGER,
      exploreFeedCategories TEXT
    );
    CREATE TABLE explore_feed_sources (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      url TEXT NOT NULL,
      label TEXT,
      lastFetchedAt TEXT,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE explore_feed_items (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      type TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      imageUrl TEXT,
      sourceUrl TEXT,
      category TEXT,
      venue TEXT,
      district TEXT,
      feedCategory TEXT,
      ageMin INTEGER,
      ageMax INTEGER,
      activityStart TEXT,
      activityEnd TEXT,
      signupDeadline TEXT,
      price TEXT,
      bookingMethod TEXT,
      officialUrl TEXT,
      recommendReason TEXT,
      notes TEXT,
      verifyStatus TEXT,
      recommendScore INTEGER,
      city TEXT,
      status TEXT,
      recommendDate TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO families VALUES
      ('family-a', '上海', 3, '["文博","户外"]'),
      ('family-b', '北京', 5, NULL);
    INSERT INTO explore_feed_sources (id, familyId, url, label) VALUES
      ('source-a', 'family-a', 'https://museum.example.com', '本地博物馆'),
      ('source-private', 'family-b', 'https://private.example.com', '其他家庭来源');
    INSERT INTO explore_feed_items (
      id, familyId, type, title, summary, imageUrl, sourceUrl, category, venue, district,
      feedCategory, ageMin, ageMax, activityStart, activityEnd, signupDeadline, price,
      bookingMethod, officialUrl, recommendReason, notes, verifyStatus, recommendScore, city, status
    ) VALUES
      (
        'item-a', 'family-a', 'source', '周末自然观察', '两小时亲子观察', 'https://img.example.com/a.jpg',
        'https://museum.example.com/a', '自然', '城市公园', '浦东', '户外', 7, 12,
        '2026-07-18', '2026-07-19', '2026-07-17', '免费', '无需预约',
        'https://museum.example.com/a', '适合第一次自然记录', '带水和帽子', '已核验', 5, '上海', 'pending_review'
      ),
      ('item-visible', 'family-a', 'poi', '已经通过的地点', NULL, NULL, NULL, '文博', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '上海', 'new'),
      ('item-private', 'family-b', 'source', '其他家庭的秘密活动', NULL, NULL, NULL, '活动', NULL, NULL, NULL, 5, 9, NULL, NULL, NULL, '100元', NULL, NULL, NULL, NULL, '未核验', 2, '北京', 'pending_review');
  `);
  return db;
};

describe('家长探索发现设置', () => {
  it('只返回当前家庭的来源和待审核活动，并保留个性化筛选需要的结构化字段', async () => {
    const db = await createExploreFeedDatabase();

    const settings = await getParentExploreFeedSettings(db, 'family-a', true);

    expect(settings).toMatchObject({
      exploreCity: '上海',
      exploreFeedDailyLimit: 3,
      exploreFeedCategories: ['文博', '户外'],
      poiEnabled: true,
    });
    expect(settings.sources.map(source => source.id)).toEqual(['source-a']);
    expect(settings.pendingReview).toHaveLength(1);
    expect(settings.pendingReview[0]).toMatchObject({
      id: 'item-a',
      title: '周末自然观察',
      feedCategory: '户外',
      ageMin: 7,
      ageMax: 12,
      activityStart: '2026-07-18',
      activityEnd: '2026-07-19',
      price: '免费',
      bookingMethod: '无需预约',
      recommendReason: '适合第一次自然记录',
      verifyStatus: '已核验',
      recommendScore: 5,
      city: '上海',
    });
    expect(JSON.stringify(settings)).not.toContain('item-private');
    expect(JSON.stringify(settings)).not.toContain('private.example.com');
  });
});
