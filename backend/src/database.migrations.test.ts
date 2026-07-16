import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateRetiredMorningTaskCategories } from './database';

describe('Phase 9A morning category migration', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE schema_versions (version TEXT PRIMARY KEY, description TEXT);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL);
      INSERT INTO tasks VALUES
        ('study-1', '晨读十分钟', '早晨启动'),
        ('study-2', '复习三个知识点', '晨间启动'),
        ('life-1', '穿衣和洗漱', '早晨启动'),
        ('keep-1', '整理书桌', '生活');
    `);
  });

  afterEach(async () => { await db.close(); });

  it('旧晨间任务按标题迁到学习或生活，并且重复启动不会再次改写', async () => {
    await migrateRetiredMorningTaskCategories(db);
    await migrateRetiredMorningTaskCategories(db);

    expect(await db.all('SELECT id, category FROM tasks ORDER BY id')).toEqual([
      { id: 'keep-1', category: '生活' },
      { id: 'life-1', category: '生活' },
      { id: 'study-1', category: '学习' },
      { id: 'study-2', category: '学习' },
    ]);
    expect((await db.get('SELECT COUNT(*) AS count FROM schema_versions')).count).toBe(1);
  });
});
