import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureChestRewardGrantSchema, grantTaskChestReward } from './chestRewardGrant';

describe('instant chest grant', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_versions (version TEXT PRIMARY KEY, description TEXT);
      CREATE TABLE families (id TEXT PRIMARY KEY);
      CREATE TABLE users (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, role TEXT NOT NULL,
        coins INTEGER DEFAULT 0, privilegePoints INTEGER DEFAULT 0
      );
      CREATE TABLE tasks (id TEXT PRIMARY KEY);
      CREATE TABLE task_entries (id TEXT PRIMARY KEY, submission_key TEXT);
      CREATE TABLE reward_pools (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
        value INTEGER NOT NULL, weight INTEGER NOT NULL, rarity TEXT, icon TEXT,
        description TEXT, isActive INTEGER DEFAULT 1
      );
      CREATE TABLE chest_settings (
        id TEXT PRIMARY KEY, familyId TEXT UNIQUE, isEnabled INTEGER DEFAULT 1,
        triggerMode TEXT, easyChance REAL, mediumChance REAL, hardChance REAL,
        guaranteeCount INTEGER, updatedAt TEXT
      );
      CREATE TABLE chest_records (
        id TEXT PRIMARY KEY, childId TEXT NOT NULL, familyId TEXT NOT NULL,
        taskEntryId TEXT, rewardId TEXT, rewardName TEXT NOT NULL, rewardType TEXT NOT NULL,
        rewardValue INTEGER NOT NULL, rewardRarity TEXT, rewardIcon TEXT, status TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE user_inventory (
        id TEXT PRIMARY KEY, childId TEXT NOT NULL, title TEXT, icon TEXT, cost INTEGER,
        costType TEXT, source TEXT, status TEXT
      );
      INSERT INTO families VALUES ('family-1');
      INSERT INTO users VALUES ('child-1', 'family-1', 'child', 0, 0);
      INSERT INTO tasks VALUES ('task-1');
      INSERT INTO task_entries (id) VALUES ('entry-1'), ('entry-2');
      INSERT INTO chest_settings VALUES ('settings-1', 'family-1', 1, 'always', 1, 1, 1, 0, NULL);
      INSERT INTO reward_pools VALUES (
        'puzzle-1', 'family-1', '幸运拼图', 'lotteryTicket', 1, 25,
        'uncommon', '🧩', '集齐2片自动合成1次幸运转盘机会。', 1
      );
    `);
    await ensureChestRewardGrantSchema(db);
  });

  afterEach(async () => { await db.close(); });

  it('同一任务重复请求只发一片，两片只合成一张免费抽奖券', async () => {
    const first = await grantTaskChestReward(db, {
      familyId: 'family-1', childId: 'child-1', taskEntryId: 'entry-1', difficulty: 'easy',
    });
    const duplicate = await grantTaskChestReward(db, {
      familyId: 'family-1', childId: 'child-1', taskEntryId: 'entry-1', difficulty: 'easy',
    });
    const second = await grantTaskChestReward(db, {
      familyId: 'family-1', childId: 'child-1', taskEntryId: 'entry-2', difficulty: 'easy',
    });

    expect(first).toMatchObject({ type: 'lotteryPuzzle', puzzleProgress: { pieces: 1, required: 2 }, lotteryTicketsCreated: 0 });
    expect(duplicate).toMatchObject({ alreadyGranted: true, puzzleProgress: { pieces: 1, required: 2 } });
    expect(second).toMatchObject({ type: 'lotteryPuzzle', puzzleProgress: { pieces: 0, required: 2 }, lotteryTicketsCreated: 1 });
    expect((await db.get('SELECT COUNT(*) AS count FROM chest_records')).count).toBe(2);
    expect(await db.get('SELECT pieces, tickets_generated FROM lottery_puzzle_progress WHERE child_id = ?', 'child-1'))
      .toEqual({ pieces: 0, tickets_generated: 1 });
    expect(await db.get('SELECT COUNT(*) AS count FROM user_inventory WHERE source = ?', 'lottery_ticket'))
      .toEqual({ count: 1 });
  });

  it('抽奖券写入失败时，拼图和宝箱记录一起回滚', async () => {
    await grantTaskChestReward(db, {
      familyId: 'family-1', childId: 'child-1', taskEntryId: 'entry-1', difficulty: 'easy',
    });
    await db.exec(`
      CREATE TRIGGER fail_ticket_insert BEFORE INSERT ON user_inventory
      BEGIN SELECT RAISE(ABORT, 'inventory unavailable'); END;
    `);

    await expect(grantTaskChestReward(db, {
      familyId: 'family-1', childId: 'child-1', taskEntryId: 'entry-2', difficulty: 'easy',
    })).rejects.toThrow('inventory unavailable');

    expect((await db.get('SELECT COUNT(*) AS count FROM chest_records')).count).toBe(1);
    expect(await db.get('SELECT pieces, tickets_generated FROM lottery_puzzle_progress WHERE child_id = ?', 'child-1'))
      .toEqual({ pieces: 1, tickets_generated: 0 });
  });

  it('旧宝箱奖池只迁移一次，并停用不再面向孩子的经验奖励', async () => {
    await db.run("DELETE FROM schema_versions WHERE version = 'phase9b-chest-puzzle-pool'");
    await db.run('DELETE FROM reward_pools');
    await db.run("INSERT INTO reward_pools VALUES ('coin-old', 'family-1', '小星币', 'coins', 3, 60, 'common', '🪙', '', 1)");
    await db.run("INSERT INTO reward_pools VALUES ('xp-old', 'family-1', '经验火花', 'xp', 8, 30, 'common', '✨', '', 1)");

    await ensureChestRewardGrantSchema(db);
    await ensureChestRewardGrantSchema(db);

    expect(await db.get("SELECT value, weight FROM reward_pools WHERE id = 'coin-old'"))
      .toEqual({ value: 2, weight: 45 });
    expect((await db.get("SELECT isActive FROM reward_pools WHERE id = 'xp-old'")).isActive).toBe(0);
    expect(await db.get("SELECT name, value, weight FROM reward_pools WHERE type = 'lotteryTicket'"))
      .toEqual({ name: '幸运拼图', value: 1, weight: 25 });
    expect((await db.get("SELECT COUNT(*) AS count FROM reward_pools WHERE type = 'lotteryTicket'")).count).toBe(1);
  });
});
