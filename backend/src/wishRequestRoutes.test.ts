import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createChildWishRequest,
  depositToWishRequest,
  ensurePhase9CRewardSchema,
  redeemApprovedWishRequest,
  reviewChildWishRequest,
} from './wishRequestRoutes';

describe('child wish requests', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE families (id TEXT PRIMARY KEY);
      CREATE TABLE users (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, role TEXT NOT NULL, name TEXT,
        coins INTEGER DEFAULT 0, privilegePoints INTEGER DEFAULT 0
      );
      CREATE TABLE privileges (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, cost INTEGER NOT NULL, icon TEXT
      );
      CREATE TABLE screen_time_ledger (
        id TEXT PRIMARY KEY, familyId TEXT, childId TEXT, deltaMinutes INTEGER,
        reason TEXT, source TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE user_inventory (
        id TEXT PRIMARY KEY, childId TEXT NOT NULL, wishId TEXT, privilegeId TEXT,
        title TEXT NOT NULL, icon TEXT, status TEXT DEFAULT 'pending', cost INTEGER DEFAULT 0,
        costType TEXT DEFAULT 'coins', acquiredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        redeemedAt DATETIME, source TEXT DEFAULT 'shop'
      );
      INSERT INTO families VALUES ('family-1'), ('family-2');
      INSERT INTO users VALUES ('child-1', 'family-1', 'child', '小星', 100, 5);
      INSERT INTO users VALUES ('child-2', 'family-2', 'child', '小月', 100, 5);
    `);
    await ensurePhase9CRewardSchema(db);
  });

  afterEach(async () => { await db.close(); });

  it('数据库约束保证同一个孩子并发提交时只有一个进行中愿望', async () => {
    const attempts = await Promise.allSettled([
      createChildWishRequest(db, { familyId: 'family-1', childId: 'child-1', title: '显微镜' }),
      createChildWishRequest(db, { familyId: 'family-1', childId: 'child-1', title: '新画笔' }),
    ]);

    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.get("SELECT COUNT(*) AS count FROM child_wish_requests WHERE child_id = 'child-1'")).count).toBe(1);
  });

  it('家长不能审批其他家庭的愿望，拒绝时必须解释原因', async () => {
    const request = await createChildWishRequest(db, {
      familyId: 'family-1', childId: 'child-1', title: '科学实验盒',
    });

    await expect(reviewChildWishRequest(db, {
      familyId: 'family-2', requestId: request.id, action: 'approve', mode: 'coins_direct', cost: 50,
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(reviewChildWishRequest(db, {
      familyId: 'family-1', requestId: request.id, action: 'reject', reason: '',
    })).rejects.toThrow('拒绝愿望时请告诉孩子原因');
  });

  it('批准为金币储蓄后分次扣款，达标时只生成一个背包物品', async () => {
    const request = await createChildWishRequest(db, {
      familyId: 'family-1', childId: 'child-1', title: '拼图套装',
    });
    await reviewChildWishRequest(db, {
      familyId: 'family-1', requestId: request.id, action: 'approve', mode: 'coins_savings', cost: 30,
    });

    const first = await depositToWishRequest(db, 'family-1', 'child-1', request.id, 10);
    const second = await depositToWishRequest(db, 'family-1', 'child-1', request.id, 20);

    expect(first).toMatchObject({ savedAmount: 10, inventoryId: null });
    expect(second.savedAmount).toBe(30);
    expect(second.inventoryId).toBeTruthy();
    expect((await db.get("SELECT coins FROM users WHERE id = 'child-1'")).coins).toBe(70);
    expect((await db.get("SELECT COUNT(*) AS count FROM user_inventory WHERE wish_request_id = ?", request.id)).count).toBe(1);
    await expect(depositToWishRequest(db, 'family-1', 'child-1', request.id, 1)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('权益点直兑使用守卫扣减，重复兑换不会重复扣款', async () => {
    const request = await createChildWishRequest(db, {
      familyId: 'family-1', childId: 'child-1', title: '决定周末电影',
    });
    await reviewChildWishRequest(db, {
      familyId: 'family-1', requestId: request.id, action: 'approve', mode: 'privilege_points', cost: 3,
    });

    await redeemApprovedWishRequest(db, 'family-1', 'child-1', request.id);
    expect((await db.get("SELECT privilegePoints FROM users WHERE id = 'child-1'")).privilegePoints).toBe(2);
    await expect(redeemApprovedWishRequest(db, 'family-1', 'child-1', request.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await db.get("SELECT privilegePoints FROM users WHERE id = 'child-1'")).privilegePoints).toBe(2);
  });
});
