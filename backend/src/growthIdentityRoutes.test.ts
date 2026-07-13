import express from 'express';
import type { AddressInfo } from 'net';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { describe, expect, it } from 'vitest';
import { ensureGrowthCosmeticSchema } from './growthCosmeticSchema';
import { registerGrowthIdentityRoutes } from './growthIdentityRoutes';

describe('成长身份 HTTP 路由权限', () => {
  it('仅允许孩子读取和修改本人身份，并返回稳定错误码', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.run('PRAGMA foreign_keys = ON');
    await db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT, name TEXT, role TEXT, avatar TEXT, xp INTEGER DEFAULT 0);
      CREATE TABLE achievement_defs (id TEXT PRIMARY KEY, familyId TEXT, title TEXT, description TEXT, icon TEXT, category TEXT, system_key TEXT, is_system INTEGER DEFAULT 0);
      CREATE TABLE user_achievements (id TEXT PRIMARY KEY, childId TEXT, achievementId TEXT, unlockedAt TEXT);
      INSERT INTO users VALUES ('child-1', 'family-1', '孩子', 'child', '⭐', 300);
    `);
    await ensureGrowthCosmeticSchema(db);
    const app = express();
    app.use(express.json());
    const protect = (req: any, _res: any, next: any) => {
      req.user = { id: 'child-1', familyId: 'family-1', role: String(req.headers['x-role'] || 'child') };
      next();
    };
    const requireChild = (req: any, res: any, next: any) => req.user.role === 'child'
      ? next() : res.status(403).json({ code: 'child_required' });
    registerGrowthIdentityRoutes(app, protect, requireChild, () => db);
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${baseUrl}/api/child/growth-identity`, { headers: { 'x-role': 'parent' } })).status).toBe(403);
      const readResponse = await fetch(`${baseUrl}/api/child/growth-identity`);
      expect(readResponse.status).toBe(200);
      expect(await readResponse.json()).toMatchObject({ child: { id: 'child-1' }, levelIdentity: { level: 4 } });
      const crossChild = await fetch(`${baseUrl}/api/child/profile-customization`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ childId: 'child-2' }),
      });
      expect(crossChild.status).toBe(403);
      expect(await crossChild.json()).toMatchObject({ code: 'cosmetic_child_forbidden' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await db.close();
    }
  });
});
