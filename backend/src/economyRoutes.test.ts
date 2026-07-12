import { describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { ensureEconomySchema } from './economySchema';
import { calculateSmartPricing } from './rewardSystem';
import {
  applyShopRecalibration,
  getEconomyAudit,
  getEconomySettings,
  getLegacyPriceSuggestion,
  previewShopRecalibration,
  rollbackEconomyBatch,
  registerEconomyRoutes,
  updateEconomySettings,
} from './economyRoutes';

const createEconomyDatabase = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ecoTasksPerDay INTEGER DEFAULT 10,
      ecoCoinPerRmb INTEGER DEFAULT 10,
      ecoMidPrizeDays INTEGER DEFAULT 10,
      ecoGamePrivilegePoints INTEGER DEFAULT 2
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE task_entries (
      id TEXT PRIMARY KEY,
      childId TEXT NOT NULL,
      status TEXT NOT NULL,
      earnedCoins INTEGER DEFAULT 0,
      submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE wishes (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      cost INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    );
    INSERT INTO families (id, name) VALUES
      ('family-1', '一号家庭'), ('family-2', '二号家庭'), ('family-3', '新家庭');
    INSERT INTO users VALUES
      ('child-1', 'family-1', 'child'), ('child-2', 'family-2', 'child');
    INSERT INTO task_entries (id, childId, status, earnedCoins) VALUES
      ('entry-1', 'child-1', 'approved', 140),
      ('entry-2', 'child-1', 'approved', 140),
      ('entry-private', 'child-2', 'approved', 1400);
  `);
  await ensureEconomySchema(db);
  await db.exec(`
    INSERT INTO wishes (id, familyId, type, title, cost, reference_rmb) VALUES
      ('wish-aligned', 'family-1', 'shop', '一本书', 250, 25),
      ('wish-under', 'family-1', 'shop', '小零食', 20, 5),
      ('wish-over', 'family-1', 'shop', '小玩具', 150, 10),
      ('wish-missing', 'family-1', 'shop', '自定义礼物', 100, NULL),
      ('wish-private', 'family-2', 'shop', '其他家庭商品', 1, 100);
  `);
  return db;
};

describe('家长经济设置', () => {
  it('保留旧字段兼容，同时提供10金币/元和每日30金币的统一设置', async () => {
    const db = await createEconomyDatabase();
    const before = await getEconomySettings(db, 'family-1');
    expect(before).toMatchObject({
      ecoTasksPerDay: 10,
      ecoCoinPerRmb: 10,
      ecoMidPrizeDays: 10,
      ecoGamePrivilegePoints: 2,
      dailyCoinTarget: 30,
      settings: { preset: 'standard', coinPerRmb: 10, dailyCoinTarget: 30 },
    });

    const updated = await updateEconomySettings(db, 'family-1', {
      coinPerRmb: 20,
      dailyCoinTarget: 50,
    });
    expect(updated.settings).toEqual({ preset: 'longTerm', coinPerRmb: 20, dailyCoinTarget: 50 });
    expect((await getEconomySettings(db, 'family-2')).settings)
      .toEqual({ preset: 'standard', coinPerRmb: 10, dailyCoinTarget: 30 });
    await db.close();
  });

  it('拒绝越界、冲突或非整数设置，不静默夹取错误值', async () => {
    const db = await createEconomyDatabase();
    await expect(updateEconomySettings(db, 'family-1', { coinPerRmb: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateEconomySettings(db, 'family-1', { dailyCoinTarget: 30.5 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateEconomySettings(db, 'family-1', { coinPerRmb: 10, ecoCoinPerRmb: 20 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect((await getEconomySettings(db, 'family-1')).settings)
      .toEqual({ preset: 'standard', coinPerRmb: 10, dailyCoinTarget: 30 });
    await db.close();
  });
});

describe('经济审计与稳定定价', () => {
  it('按家庭隔离统计近14天产出和商品偏差', async () => {
    const db = await createEconomyDatabase();
    const audit = await getEconomyAudit(db, 'family-1');
    expect(audit.production).toEqual({ measuredDailyCoins: 20, targetDailyCoins: 30, sampleDays: 14 });
    expect(audit.catalog).toMatchObject({
      total: 4,
      aligned: 1,
      underpriced: 1,
      overpriced: 1,
      missingReference: 1,
      invalidReference: 0,
    });
    expect(audit.catalog.items.map(item => item.id)).not.toContain('wish-private');
    expect(audit.warnings.map(warning => warning.code)).toContain('catalog_missing_reference');
    await db.close();
  });

  it('异常现实参考价会成为审计警告，不会让整个审计接口白屏', async () => {
    const db = await createEconomyDatabase();
    await db.run('UPDATE wishes SET reference_rmb = -5 WHERE id = ?', 'wish-aligned');
    const audit = await getEconomyAudit(db, 'family-1');
    expect(audit.catalog.invalidReference).toBe(1);
    expect(audit.warnings).toContainEqual({ code: 'catalog_invalid_reference', count: 1 });
    await expect(previewShopRecalibration(db, 'family-1', ['wish-aligned']))
      .rejects.toMatchObject({ statusCode: 400 });
    await db.close();
  });

  it('旧定价接口使用家庭实测或目标日产，不再根据孩子表现涨价', async () => {
    const db = await createEconomyDatabase();
    expect(await getLegacyPriceSuggestion(db, 'family-1', 'shop', 7)).toMatchObject({
      dailyIncome: 20,
      suggestedCoins: 140,
      days: 7,
      estimated: false,
    });
    expect(await getLegacyPriceSuggestion(db, 'family-3', 'shop', 7)).toMatchObject({
      dailyIncome: 30,
      suggestedCoins: 210,
      estimated: true,
    });
    await db.close();
  });

  it('旧特权定价接口保持响应结构，但不再按完成率或惩罚率改变价格', async () => {
    const db = await createEconomyDatabase();
    expect(await calculateSmartPricing(db, 'child-1')).toEqual({
      basePrice: 2,
      suggestedPrice: 2,
      discountFactor: 1,
      factors: {
        completionRate: 0,
        recentPunishmentRate: 0,
        weeklyCoinEarned: 0,
        avgTaskCoins: 0,
      },
      message: '按家庭固定成长权益锚点定价，不根据孩子表现涨价或降价。',
    });
    await db.close();
  });
});

describe('商品校准：先预览，再事务应用，可冲突安全回滚', () => {
  it('服务端重新计算价格、记录旧值，并能完整回滚', async () => {
    const db = await createEconomyDatabase();
    const preview = await previewShopRecalibration(db, 'family-1', ['wish-under', 'wish-over']);
    expect(preview.changes).toEqual([
      expect.objectContaining({ id: 'wish-under', oldValue: 20, newValue: 50 }),
      expect.objectContaining({ id: 'wish-over', oldValue: 150, newValue: 100 }),
    ]);

    const applied = await applyShopRecalibration(db, 'family-1', 'parent-1', ['wish-under', 'wish-over']);
    expect(applied.changes).toHaveLength(2);
    expect((await db.get('SELECT cost FROM wishes WHERE id = ?', 'wish-under')).cost).toBe(50);
    expect((await db.get('SELECT COUNT(*) AS count FROM economy_change_items WHERE batch_id = ?', applied.batchId)).count).toBe(2);

    const rolledBack = await rollbackEconomyBatch(db, 'family-1', applied.batchId);
    expect(rolledBack.restoredCount).toBe(2);
    expect((await db.get('SELECT cost FROM wishes WHERE id = ?', 'wish-under')).cost).toBe(20);
    expect((await db.get('SELECT status FROM economy_change_batches WHERE id = ?', applied.batchId)).status).toBe('rolled_back');
    await expect(rollbackEconomyBatch(db, 'family-1', applied.batchId)).rejects.toMatchObject({ statusCode: 409 });
    await db.close();
  });

  it('拒绝其他家庭商品，并在后续手工改价后拒绝整批回滚', async () => {
    const db = await createEconomyDatabase();
    await expect(previewShopRecalibration(db, 'family-1', ['wish-private']))
      .rejects.toMatchObject({ statusCode: 404 });

    const applied = await applyShopRecalibration(db, 'family-1', 'parent-1', ['wish-under', 'wish-over']);
    await db.run('UPDATE wishes SET cost = 999 WHERE id = ?', 'wish-under');
    await expect(rollbackEconomyBatch(db, 'family-1', applied.batchId))
      .rejects.toMatchObject({ statusCode: 409 });

    expect((await db.get('SELECT cost FROM wishes WHERE id = ?', 'wish-over')).cost).toBe(100);
    expect((await db.get('SELECT status FROM economy_change_batches WHERE id = ?', applied.batchId)).status).toBe('applied');
    await db.close();
  });
});

describe('经济 HTTP 路由权限与错误契约', () => {
  it('拒绝孩子角色，家长只读取自己家庭，非法设置返回稳定400错误码', async () => {
    const db = await createEconomyDatabase();
    const app = express();
    app.use(express.json());
    const protect = (req: any, _res: any, next: any) => {
      req.user = {
        id: 'parent-1',
        familyId: String(req.headers['x-family-id'] || 'family-1'),
        role: String(req.headers['x-role'] || 'parent'),
      };
      next();
    };
    const requireParent = (req: any, res: any, next: any) => {
      if (req.user?.role !== 'parent') return res.status(403).json({ code: 'parent_required' });
      next();
    };
    registerEconomyRoutes(app, protect, requireParent, () => db);
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const childResponse = await fetch(`${baseUrl}/api/parent/economy-audit`, {
        headers: { 'x-role': 'child' },
      });
      expect(childResponse.status).toBe(403);

      const parentResponse = await fetch(`${baseUrl}/api/parent/economy-audit`, {
        headers: { 'x-family-id': 'family-1' },
      });
      expect(parentResponse.status).toBe(200);
      const audit = await parentResponse.json() as any;
      expect(audit.catalog.items.map((item: any) => item.id)).not.toContain('wish-private');

      const invalidResponse = await fetch(`${baseUrl}/api/parent/economy-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-family-id': 'family-1' },
        body: JSON.stringify({ coinPerRmb: 0 }),
      });
      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toMatchObject({ code: 'invalid_economy_setting' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await db.close();
    }
  });
});
