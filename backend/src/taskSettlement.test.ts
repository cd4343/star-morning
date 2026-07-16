import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureTaskSettlementSchema, settleTaskEntry, syncTaskSettlementCoinAdjustment } from './taskSettlement';

describe('task settlement', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE families (id TEXT PRIMARY KEY);
      CREATE TABLE users (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, coins INTEGER DEFAULT 0,
        xp INTEGER DEFAULT 0, rewardXpTotal INTEGER DEFAULT 0,
        privilegePoints INTEGER DEFAULT 0
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL,
        coinReward INTEGER NOT NULL, xpReward INTEGER NOT NULL,
        durationMinutes INTEGER NOT NULL, category TEXT NOT NULL,
        taskType TEXT
      );
      CREATE TABLE task_entries (
        id TEXT PRIMARY KEY, taskId TEXT NOT NULL, childId TEXT NOT NULL,
        status TEXT DEFAULT 'pending', reviewedAt TEXT,
        actualDurationMinutes INTEGER, earnedCoins INTEGER DEFAULT 0,
        earnedXp INTEGER DEFAULT 0, rewardXp INTEGER DEFAULT 0
      );
      INSERT INTO families (id) VALUES ('family-1');
      INSERT INTO users (id, familyId, rewardXpTotal) VALUES ('child-1', 'family-1', 95);
    `);
    await ensureTaskSettlementSchema(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const insertTask = async (category = '学习') => {
    await db.run(
      `INSERT INTO tasks (id, familyId, title, coinReward, xpReward, durationMinutes, category, taskType)
       VALUES ('task-1', 'family-1', '完成一小步', 12, 10, 20, ?, 'daily')`,
      category,
    );
    await db.run(
      `INSERT INTO task_entries (id, taskId, childId, actualDurationMinutes)
       VALUES ('entry-1', 'task-1', 'child-1', 15)`,
    );
  };

  it('同一任务重复审核只到账一次，并返回第一次结算的完整结果', async () => {
    await insertTask();
    const grantGameMinutes = vi.fn().mockResolvedValue({
      gameMinutesAwarded: 5,
      reasons: ['比预计时间节省5分钟，获得5分钟游戏时间'],
    });

    const first = await settleTaskEntry(db, {
      entryId: 'entry-1',
      familyId: 'family-1',
      grantGameMinutes,
    });
    const second = await settleTaskEntry(db, {
      entryId: 'entry-1',
      familyId: 'family-1',
      grantGameMinutes,
    });

    expect(first.result).toMatchObject({
      coinsAwarded: 12,
      growthXpAwarded: 10,
      privilegePointsAwarded: 1,
      gameMinutesAwarded: 5,
      balanceAfter: { coins: 12, privilegePoints: 1 },
    });
    expect(second).toEqual({ ...first, alreadySettled: true, result: { ...first.result, alreadySettled: true } });
    expect(grantGameMinutes).toHaveBeenCalledTimes(1);
    expect(await db.get('SELECT coins, xp, rewardXpTotal, privilegePoints FROM users WHERE id = ?', 'child-1'))
      .toEqual({ coins: 12, xp: 10, rewardXpTotal: 105, privilegePoints: 1 });
    expect((await db.get('SELECT COUNT(*) AS count FROM task_reward_settlements')).count).toBe(1);
  });

  it('非学习任务不会触发游戏时间发放', async () => {
    await insertTask('生活');
    const grantGameMinutes = vi.fn();

    const outcome = await settleTaskEntry(db, {
      entryId: 'entry-1',
      familyId: 'family-1',
      grantGameMinutes,
    });

    expect(outcome.result.gameMinutesAwarded).toBe(0);
    expect(grantGameMinutes).not.toHaveBeenCalled();
    expect(outcome.result.reasons).toContain('只有学习省时任务可在家长确认后获得游戏时间');
  });

  it('旧晨间任务按生活类兼容，不能继续产生游戏时间', async () => {
    await insertTask('早晨启动');
    const grantGameMinutes = vi.fn();

    const outcome = await settleTaskEntry(db, {
      entryId: 'entry-1',
      familyId: 'family-1',
      grantGameMinutes,
    });

    expect(outcome.result.gameMinutesAwarded).toBe(0);
    expect(grantGameMinutes).not.toHaveBeenCalled();
  });

  it('游戏时间发放失败时回滚任务状态与所有余额', async () => {
    await insertTask();

    await expect(settleTaskEntry(db, {
      entryId: 'entry-1',
      familyId: 'family-1',
      grantGameMinutes: async () => { throw new Error('ledger unavailable'); },
    })).rejects.toThrow('ledger unavailable');

    expect(await db.get('SELECT status, earnedCoins, earnedXp FROM task_entries WHERE id = ?', 'entry-1'))
      .toEqual({ status: 'pending', earnedCoins: 0, earnedXp: 0 });
    expect(await db.get('SELECT coins, xp, rewardXpTotal, privilegePoints FROM users WHERE id = ?', 'child-1'))
      .toEqual({ coins: 0, xp: 0, rewardXpTotal: 95, privilegePoints: 0 });
    expect((await db.get('SELECT COUNT(*) AS count FROM task_reward_settlements')).count).toBe(0);
  });

  it('审核后家长明确调整金币时同步账本与重复查询结果', async () => {
    await insertTask('生活');
    await settleTaskEntry(db, { entryId: 'entry-1', familyId: 'family-1' });
    await db.run('UPDATE users SET coins = 20 WHERE id = ?', 'child-1');
    await db.run('UPDATE task_entries SET earnedCoins = 20 WHERE id = ?', 'entry-1');
    await syncTaskSettlementCoinAdjustment(db, 'entry-1', 20, 20);

    const repeated = await settleTaskEntry(db, { entryId: 'entry-1', familyId: 'family-1' });
    expect(repeated.result.coinsAwarded).toBe(20);
    expect(repeated.result.balanceAfter.coins).toBe(20);
    expect(repeated.result.reasons).toContain('家长在审核后将任务金币调整为20');
  });
});
