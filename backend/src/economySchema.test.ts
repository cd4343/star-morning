import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { ensureEconomySchema } from './economySchema';

const openLegacyDatabase = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ecoCoinPerRmb INTEGER DEFAULT 10
    );
    CREATE TABLE wishes (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      cost INTEGER DEFAULT 0,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    );
    INSERT INTO families (id, name, ecoCoinPerRmb) VALUES ('family-1', '测试家庭', 10);
    INSERT INTO wishes (id, familyId, type, title, cost)
      VALUES ('wish-1', 'family-1', 'shop', '一本书', 250);
  `);
  return db;
};

describe('Phase 2 经济结构迁移', () => {
  it('可重复执行，只追加字段、表和索引，并保留存量数据', async () => {
    const db = await openLegacyDatabase();

    await ensureEconomySchema(db);
    await ensureEconomySchema(db);

    const familyColumns = await db.all('PRAGMA table_info(families)');
    const wishColumns = await db.all('PRAGMA table_info(wishes)');
    expect(familyColumns.filter(column => column.name === 'eco_daily_coin_target')).toHaveLength(1);
    expect(wishColumns.filter(column => column.name === 'reference_rmb')).toHaveLength(1);

    expect(await db.get('SELECT name, ecoCoinPerRmb, eco_daily_coin_target FROM families WHERE id = ?', 'family-1'))
      .toEqual({ name: '测试家庭', ecoCoinPerRmb: 10, eco_daily_coin_target: 30 });
    expect(await db.get('SELECT title, cost, reference_rmb FROM wishes WHERE id = ?', 'wish-1'))
      .toEqual({ title: '一本书', cost: 250, reference_rmb: null });

    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'economy_change_%' ORDER BY name",
    );
    expect(tables.map(table => table.name)).toEqual(['economy_change_batches', 'economy_change_items']);

    const indexes = await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_economy_%' ORDER BY name",
    );
    expect(indexes.map(index => index.name)).toEqual([
      'idx_economy_batches_family_created',
      'idx_economy_items_batch',
      'idx_economy_items_unique_change',
    ]);

    await db.close();
  });

  it('同一批次不能重复记录同一对象字段，保证回滚值唯一', async () => {
    const db = await openLegacyDatabase();
    await ensureEconomySchema(db);
    await db.run(
      `INSERT INTO economy_change_batches
       (id, family_id, actor_id, change_type, status)
       VALUES ('batch-1', 'family-1', 'parent-1', 'shop', 'applied')`,
    );
    await db.run(
      `INSERT INTO economy_change_items
       (id, batch_id, entity_type, entity_id, field_name, old_value, new_value)
       VALUES ('item-1', 'batch-1', 'wish', 'wish-1', 'cost', 250, 300)`,
    );

    await expect(db.run(
      `INSERT INTO economy_change_items
       (id, batch_id, entity_type, entity_id, field_name, old_value, new_value)
       VALUES ('item-2', 'batch-1', 'wish', 'wish-1', 'cost', 250, 300)`,
    )).rejects.toThrow(/UNIQUE/);

    await db.close();
  });

  it('基础表缺失时大声失败，并回滚已经开始的字段变更', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec("CREATE TABLE families (id TEXT PRIMARY KEY, name TEXT); INSERT INTO families VALUES ('family-1', '测试家庭');");

    await expect(ensureEconomySchema(db)).rejects.toThrow(/wishes/);

    const familyColumns = await db.all('PRAGMA table_info(families)');
    expect(familyColumns.some(column => column.name === 'eco_daily_coin_target')).toBe(false);
    await db.close();
  });
});
