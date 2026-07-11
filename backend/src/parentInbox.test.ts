import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getParentInbox } from './parentInbox';

describe('家长待办收件箱', () => {
  let db: Awaited<ReturnType<typeof open>>;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, isEnabled INTEGER DEFAULT 1);
      CREATE TABLE task_entries (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, childId TEXT NOT NULL, status TEXT NOT NULL, submittedAt TEXT);
      CREATE TABLE task_sessions (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, taskId TEXT NOT NULL, childId TEXT NOT NULL,
        status TEXT NOT NULL, taskEntryId TEXT, autoCompletedAt TEXT, parentReminderReadAt TEXT
      );
      CREATE TABLE user_inventory (
        id TEXT PRIMARY KEY, childId TEXT NOT NULL, wishId TEXT, privilegeId TEXT,
        title TEXT NOT NULL, status TEXT NOT NULL, acquiredAt TEXT, source TEXT
      );
      CREATE TABLE family_product_settings (family_id TEXT PRIMARY KEY, setup_completed_at TEXT);
      INSERT INTO users VALUES ('child-a', 'family-a', '小星'), ('child-b', 'family-b', '小月');
      INSERT INTO tasks VALUES ('task-a', 'family-a', '整理书包', 1), ('task-b', 'family-b', '阅读', 1);
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it('空家庭只给出一次配置提示，不制造虚假紧急事项', async () => {
    const result = await getParentInbox(db, 'family-a');

    expect(result.totalActionCount).toBe(0);
    expect(result.items).toEqual([
      expect.objectContaining({ type: 'setup_hint', priority: 'info' }),
    ]);
  });

  it('严格按家庭隔离待办数据', async () => {
    await db.exec(`
      INSERT INTO family_product_settings VALUES ('family-a', '2026-07-12T09:00:00.000Z');
      INSERT INTO task_entries VALUES ('entry-a', 'task-a', 'child-a', 'pending', '2026-07-12T08:00:00.000Z');
      INSERT INTO task_entries VALUES ('entry-b', 'task-b', 'child-b', 'pending', '2026-07-12T09:00:00.000Z');
      INSERT INTO user_inventory VALUES ('item-b', 'child-b', 'wish-b', NULL, '礼物', 'pending', '2026-07-12T10:00:00.000Z', 'shop');
    `);

    const result = await getParentInbox(db, 'family-a');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ type: 'review', count: 1 }));
  });

  it('跨天自动完成任务不再重复计入普通审核，并聚合同类待办', async () => {
    await db.exec(`
      INSERT INTO family_product_settings VALUES ('family-a', '2026-07-12T09:00:00.000Z');
      INSERT INTO task_entries VALUES ('entry-overdue', 'task-a', 'child-a', 'pending', '2026-07-12T08:00:00.000Z');
      INSERT INTO task_sessions VALUES ('session-a', 'family-a', 'task-a', 'child-a', 'auto_completed', 'entry-overdue', '2026-07-12T08:00:00.000Z', NULL);
      INSERT INTO user_inventory VALUES ('item-a1', 'child-a', 'wish-a', NULL, '公园之旅', 'pending', '2026-07-12T09:00:00.000Z', 'shop');
      INSERT INTO user_inventory VALUES ('item-a2', 'child-a', NULL, 'priv-a', '延长阅读', 'pending', '2026-07-12T10:00:00.000Z', 'privilege');
      INSERT INTO user_inventory VALUES ('ticket-a', 'child-a', NULL, NULL, '抽奖券', 'pending', '2026-07-12T11:00:00.000Z', 'lottery_ticket');
    `);

    const result = await getParentInbox(db, 'family-a');

    expect(result.items.map(item => item.type)).toEqual(['overdue_session', 'reward_debt']);
    expect(result.items.find(item => item.type === 'review')).toBeUndefined();
    expect(result.items.find(item => item.type === 'reward_debt')?.count).toBe(2);
    expect(result.totalActionCount).toBe(3);
  });
});
