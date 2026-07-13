import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { describe, expect, it } from 'vitest';
import { GROWTH_COSMETIC_CATALOG } from './growthCosmeticCatalog';
import { ensureGrowthCosmeticSchema } from './growthCosmeticSchema';

const openLegacyDb = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.run('PRAGMA foreign_keys = ON');
  await db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, xp INTEGER DEFAULT 0);
    INSERT INTO users (id, familyId, name, role, xp) VALUES
      ('parent-1', 'family-1', '家长', 'parent', 0),
      ('child-1', 'family-1', '孩子', 'child', 750);
  `);
  return db;
};

describe('Phase 4 轻量装扮存储', () => {
  it('重复迁移保持幂等且不改动既有用户', async () => {
    const db = await openLegacyDb();
    const before = await db.all('SELECT * FROM users ORDER BY id');
    await ensureGrowthCosmeticSchema(db);
    await ensureGrowthCosmeticSchema(db);
    expect(await db.all('SELECT * FROM users ORDER BY id')).toEqual(before);
    expect(await db.get("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='user_cosmetic_unlocks'"))
      .toEqual({ ok: 1 });
    expect(await db.get("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='user_profile_customization'"))
      .toEqual({ ok: 1 });
    await db.close();
  });

  it('每个孩子的装扮解锁和当前选择都保持唯一', async () => {
    const db = await openLegacyDb();
    await ensureGrowthCosmeticSchema(db);
    await db.run("INSERT INTO user_cosmetic_unlocks VALUES ('child-1', 'frame.morning', 'level', 'steady', '2026-07-13 22:00:00')");
    await expect(db.run("INSERT INTO user_cosmetic_unlocks VALUES ('child-1', 'frame.morning', 'level', 'steady', '2026-07-13 22:01:00')"))
      .rejects.toThrow();
    await db.run("INSERT INTO user_profile_customization (child_id, updated_at) VALUES ('child-1', '2026-07-13 22:00:00')");
    await expect(db.run("INSERT INTO user_profile_customization (child_id, updated_at) VALUES ('child-1', '2026-07-13 22:01:00')"))
      .rejects.toThrow();
    await db.close();
  });

  it('删除孩子时级联清理装扮记录，不留下孤儿数据', async () => {
    const db = await openLegacyDb();
    await ensureGrowthCosmeticSchema(db);
    await db.run("INSERT INTO user_cosmetic_unlocks VALUES ('child-1', 'frame.seed', 'level', 'seed', '2026-07-13 22:00:00')");
    await db.run("INSERT INTO user_profile_customization (child_id, updated_at) VALUES ('child-1', '2026-07-13 22:00:00')");
    await db.run("DELETE FROM users WHERE id = 'child-1'");
    expect(await db.get('SELECT COUNT(*) AS count FROM user_cosmetic_unlocks')).toEqual({ count: 0 });
    expect(await db.get('SELECT COUNT(*) AS count FROM user_profile_customization')).toEqual({ count: 0 });
    await db.close();
  });

  it('目录不包含金币、概率、抽奖来源或功能权限字段', () => {
    expect(new Set(GROWTH_COSMETIC_CATALOG.map(item => item.key)).size).toBe(GROWTH_COSMETIC_CATALOG.length);
    expect(GROWTH_COSMETIC_CATALOG.some(item => item.sourceType === ('lottery' as never))).toBe(false);
    for (const item of GROWTH_COSMETIC_CATALOG) {
      expect(Object.keys(item)).not.toEqual(expect.arrayContaining(['coinCost', 'price', 'probability', 'permission']));
    }
  });

  it('缺失 users 表时明确失败', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await expect(ensureGrowthCosmeticSchema(db)).rejects.toThrow('Required table users is missing');
    await db.close();
  });
});
