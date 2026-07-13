import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { ensureGrowthIdentitySchema } from './growthIdentitySchema';

const openLegacyDatabase = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE families (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT NOT NULL);
    CREATE TABLE achievement_defs (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      conditionType TEXT NOT NULL,
      conditionValue INTEGER DEFAULT 0,
      conditionCategory TEXT,
      category TEXT DEFAULT '成长',
      rewardCoins INTEGER DEFAULT 0,
      rewardXp INTEGER DEFAULT 0,
      rewardPrivilegePoints INTEGER DEFAULT 0
    );
    CREATE TABLE user_achievements (
      id TEXT PRIMARY KEY,
      childId TEXT NOT NULL,
      achievementId TEXT NOT NULL,
      rewardClaimedAt DATETIME,
      rewardInventoryId TEXT,
      FOREIGN KEY (achievementId) REFERENCES achievement_defs(id)
    );
    INSERT INTO families VALUES ('family-1', '测试家庭');
    INSERT INTO users VALUES ('child-1', 'family-1');
    INSERT INTO achievement_defs VALUES
      ('system-life', 'family-1', '三日小当家', '旧说明', '🧹', 'streak_days', 3, '生活', '成长', 10, 10, 0),
      ('system-guide', 'family-1', '小讲解员', '旧说明', '🎙️', 'manual', 0, NULL, '探索', 10, 15, 0),
      ('system-legacy-task', 'family-1', '初来乍到', '最早版本标题', '🌱', 'task_count', 1, NULL, '成长', 5, 5, 0),
      ('custom-renamed', 'family-1', '我们家的三天', '家庭自定义', '⭐', 'streak_days', 3, '生活', '生活', 99, 0, 0),
      ('custom-manual', 'family-1', '我家小达人', '家庭自定义', '⭐', 'manual', 0, NULL, '探索', 99, 0, 0),
      ('duplicate-life', 'family-1', '三日小当家', '重复旧数据', '🧹', 'streak_days', 3, '生活', '生活', 10, 10, 0);
    INSERT INTO user_achievements VALUES ('unlock-1', 'child-1', 'system-life', '2026-07-01T00:00:00.000Z', 'inventory-1');
  `);
  return db;
};

describe('Phase 4 成就身份迁移', () => {
  it('重复执行仍只追加字段和索引，并保留标题、奖励与解锁关系', async () => {
    const db = await openLegacyDatabase();

    await ensureGrowthIdentitySchema(db);
    await ensureGrowthIdentitySchema(db);

    const columns = await db.all('PRAGMA table_info(achievement_defs)');
    expect(columns.filter(column => column.name === 'system_key')).toHaveLength(1);
    expect(columns.filter(column => column.name === 'is_system')).toHaveLength(1);

    expect(await db.get(
      'SELECT title, description, rewardCoins, rewardXp, system_key, is_system FROM achievement_defs WHERE id = ?',
      'system-life',
    )).toEqual({
      title: '三日小当家',
      description: '旧说明',
      rewardCoins: 10,
      rewardXp: 10,
      system_key: 'life.streak.3',
      is_system: 1,
    });
    expect(await db.get('SELECT system_key, is_system FROM achievement_defs WHERE id = ?', 'system-guide'))
      .toEqual({ system_key: 'explore.highlight.family-guide', is_system: 1 });
    expect(await db.get('SELECT system_key, is_system FROM achievement_defs WHERE id = ?', 'system-legacy-task'))
      .toEqual({ system_key: 'task.count.1', is_system: 1 });
    expect(await db.get('SELECT achievementId, rewardClaimedAt, rewardInventoryId FROM user_achievements WHERE id = ?', 'unlock-1'))
      .toEqual({ achievementId: 'system-life', rewardClaimedAt: '2026-07-01T00:00:00.000Z', rewardInventoryId: 'inventory-1' });

    const indexes = await db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_achievement_defs_family_system_key'");
    expect(indexes).toHaveLength(1);
    await db.close();
  });

  it('改名、自定义和重复冲突记录保持非系统，避免错误接管家庭内容', async () => {
    const db = await openLegacyDatabase();
    const result = await ensureGrowthIdentitySchema(db);

    expect(result).toEqual({ classified: 3, conflicts: 1 });
    for (const id of ['custom-renamed', 'custom-manual', 'duplicate-life']) {
      expect(await db.get('SELECT system_key, is_system FROM achievement_defs WHERE id = ?', id))
        .toEqual({ system_key: null, is_system: 0 });
    }
    await db.close();
  });

  it('基础表缺失时大声失败且不创建半成品索引', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await expect(ensureGrowthIdentitySchema(db)).rejects.toThrow(/achievement_defs/);
    expect(await db.all("SELECT name FROM sqlite_master WHERE name = 'idx_achievement_defs_family_system_key'"))
      .toHaveLength(0);
    await db.close();
  });
});
