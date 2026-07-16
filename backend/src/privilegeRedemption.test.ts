import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensurePhase9CRewardSchema } from './wishRequestRoutes';
import { listPendingGameTimePrivileges, resolveGameTimePrivilege } from './privilegeRedemption';

describe('game time privilege confirmation', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE families (id TEXT PRIMARY KEY);
      CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT, role TEXT, name TEXT, coins INTEGER DEFAULT 0, privilegePoints INTEGER DEFAULT 0);
      CREATE TABLE privileges (id TEXT PRIMARY KEY, familyId TEXT, title TEXT, description TEXT, cost INTEGER, icon TEXT);
      CREATE TABLE user_inventory (
        id TEXT PRIMARY KEY, childId TEXT, wishId TEXT, privilegeId TEXT, title TEXT, icon TEXT,
        status TEXT DEFAULT 'pending', cost INTEGER, costType TEXT, acquiredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        redeemedAt DATETIME, source TEXT
      );
      CREATE TABLE screen_time_rules (
        familyId TEXT PRIMARY KEY, isEnabled INTEGER DEFAULT 1, dailyBaseMinutes INTEGER DEFAULT 15,
        dailyMaxMinutes INTEGER DEFAULT 45
      );
      CREATE TABLE screen_time_ledger (
        id TEXT PRIMARY KEY, familyId TEXT, childId TEXT, deltaMinutes INTEGER, reason TEXT,
        source TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO families VALUES ('family-1'), ('family-2');
      INSERT INTO users VALUES ('child-1', 'family-1', 'child', '小星', 0, 2);
      INSERT INTO privileges VALUES ('game-1', 'family-1', '家庭约定游戏加场', '', 2, '🎮');
      INSERT INTO user_inventory VALUES ('inventory-1', 'child-1', NULL, 'game-1', '家庭约定游戏加场', '🎮', 'pending', 2, 'privilegePoints', CURRENT_TIMESTAMP, NULL, 'privilege');
      INSERT INTO screen_time_rules VALUES ('family-1', 1, 15, 45);
    `);
    await ensurePhase9CRewardSchema(db);
    await db.run("UPDATE privileges SET game_minutes = 15 WHERE id = 'game-1'");
  });

  afterEach(async () => { await db.close(); });

  it('只有家长确认后才以独立来源增加游戏时间，重复确认不重复到账', async () => {
    expect(await listPendingGameTimePrivileges(db, 'family-1')).toHaveLength(1);
    const first = await resolveGameTimePrivilege(db, { familyId: 'family-1', inventoryId: 'inventory-1', action: 'approve' });
    const duplicate = await resolveGameTimePrivilege(db, { familyId: 'family-1', inventoryId: 'inventory-1', action: 'approve' });

    expect(first).toMatchObject({ grantedMinutes: 15, status: 'redeemed' });
    expect(duplicate).toMatchObject({ alreadyResolved: true, grantedMinutes: 15 });
    expect(await db.get("SELECT deltaMinutes, source FROM screen_time_ledger WHERE privilege_redemption_id = 'inventory-1'"))
      .toEqual({ deltaMinutes: 15, source: 'privilege_redemption' });
  });

  it('每日上限不足时保持待确认，不损失孩子已兑换的权益', async () => {
    await db.run("INSERT INTO screen_time_ledger (id, familyId, childId, deltaMinutes, source) VALUES ('earned', 'family-1', 'child-1', 25, 'study_saved_time')");

    await expect(resolveGameTimePrivilege(db, {
      familyId: 'family-1', inventoryId: 'inventory-1', action: 'approve',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect((await db.get("SELECT status FROM user_inventory WHERE id = 'inventory-1'")).status).toBe('pending');
  });

  it('其他家庭不能确认，拒绝时退还权益点且必须填写原因', async () => {
    await expect(resolveGameTimePrivilege(db, {
      familyId: 'family-2', inventoryId: 'inventory-1', action: 'approve',
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(resolveGameTimePrivilege(db, {
      familyId: 'family-1', inventoryId: 'inventory-1', action: 'reject', reason: '',
    })).rejects.toThrow('拒绝时请填写原因');
    await resolveGameTimePrivilege(db, {
      familyId: 'family-1', inventoryId: 'inventory-1', action: 'reject', reason: '今天已有家庭安排',
    });
    expect((await db.get("SELECT status FROM user_inventory WHERE id = 'inventory-1'")).status).toBe('cancelled');
    expect((await db.get("SELECT privilegePoints FROM users WHERE id = 'child-1'")).privilegePoints).toBe(4);
  });
});
