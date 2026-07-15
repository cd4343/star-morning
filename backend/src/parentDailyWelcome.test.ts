import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { describe, expect, it } from 'vitest';
import { claimParentDailyWelcome, ensureParentDailyWelcomeSchema } from './parentDailyWelcome';

const openLegacyDb = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL
    );
    INSERT INTO users (id, familyId, name, role) VALUES
      ('parent-1', 'family-1', '家长一', 'parent'),
      ('parent-2', 'family-1', '家长二', 'parent'),
      ('child-1', 'family-1', '孩子', 'child');
  `);
  return db;
};

describe('家长每日欢迎领取规则', () => {
  it('迁移只追加字段且可重复执行，不改动现有账号', async () => {
    const db = await openLegacyDb();
    const before = await db.all('SELECT id, familyId, name, role FROM users ORDER BY id');
    await ensureParentDailyWelcomeSchema(db);
    await ensureParentDailyWelcomeSchema(db);
    expect(await db.all('SELECT id, familyId, name, role FROM users ORDER BY id')).toEqual(before);
    const columns = await db.all('PRAGMA table_info(users)');
    expect(columns.filter((column: any) => column.name === 'parent_welcome_last_shown_date')).toHaveLength(1);
    await db.close();
  });

  it('同一账号同一北京日期只允许一个并发请求取得自动展示权', async () => {
    const db = await openLegacyDb();
    await ensureParentDailyWelcomeSchema(db);
    const claims = await Promise.all([
      claimParentDailyWelcome(db, 'parent-1', '2026-07-16'),
      claimParentDailyWelcome(db, 'parent-1', '2026-07-16'),
    ]);
    expect(claims.filter(claim => claim.shouldShow)).toHaveLength(1);
    expect(claims.every(claim => claim.date === '2026-07-16')).toBe(true);
    await db.close();
  });

  it('不同家长互不影响，跨北京日期后可以再次展示', async () => {
    const db = await openLegacyDb();
    await ensureParentDailyWelcomeSchema(db);
    expect((await claimParentDailyWelcome(db, 'parent-1', '2026-07-16')).shouldShow).toBe(true);
    expect((await claimParentDailyWelcome(db, 'parent-2', '2026-07-16')).shouldShow).toBe(true);
    expect((await claimParentDailyWelcome(db, 'parent-1', '2026-07-17')).shouldShow).toBe(true);
    await db.close();
  });

  it('孩子账号和不存在的账号必须明确失败，不能占用展示记录', async () => {
    const db = await openLegacyDb();
    await ensureParentDailyWelcomeSchema(db);
    await expect(claimParentDailyWelcome(db, 'child-1', '2026-07-16')).rejects.toThrow('only available to parent');
    await expect(claimParentDailyWelcome(db, 'missing', '2026-07-16')).rejects.toThrow('not found');
    await db.close();
  });

  it('基础 users 表缺失时迁移大声失败', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await expect(ensureParentDailyWelcomeSchema(db)).rejects.toThrow('Required table users is missing');
    await db.close();
  });
});
