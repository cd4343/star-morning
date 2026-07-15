import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { describe, expect, it, vi } from 'vitest';
import { ensureParentDailyWelcomeSchema } from './parentDailyWelcome';
import { createClaimParentDailyWelcomeHandler } from './parentWorkspaceRoutes';

const createResponse = () => {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response;
};

const openTestDb = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL);
    INSERT INTO users (id, familyId, name, role) VALUES
      ('parent-1', 'family-1', '家长', 'parent'),
      ('child-1', 'family-1', '孩子', 'child');
  `);
  await ensureParentDailyWelcomeSchema(db);
  return db;
};

describe('家长工作台接口', () => {
  it('每日欢迎接口返回稳定日期，并让同日第二次请求停止自动弹出', async () => {
    const db = await openTestDb();
    const handler = createClaimParentDailyWelcomeHandler(() => db, () => '2026-07-16');
    const request: any = { user: { id: 'parent-1', familyId: 'family-1', role: 'parent' } };
    const first = createResponse();
    const second = createResponse();
    await handler(request, first, vi.fn());
    await handler(request, second, vi.fn());
    expect(first.body).toEqual({ shouldShow: true, date: '2026-07-16' });
    expect(second.body).toEqual({ shouldShow: false, date: '2026-07-16' });
    await db.close();
  });

  it('孩子角色不能调用家长欢迎接口', async () => {
    const db = await openTestDb();
    const handler = createClaimParentDailyWelcomeHandler(() => db, () => '2026-07-16');
    const response = createResponse();
    await handler(
      { user: { id: 'child-1', familyId: 'family-1', role: 'child' } } as any,
      response,
      vi.fn(),
    );
    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ message: '权限不足' });
    await db.close();
  });

  it('已删除的家长账号返回 404，不把失效 token 当成服务器故障', async () => {
    const db = await openTestDb();
    const handler = createClaimParentDailyWelcomeHandler(() => db, () => '2026-07-16');
    const response = createResponse();
    await handler(
      { user: { id: 'missing', familyId: 'family-1', role: 'parent' } } as any,
      response,
      vi.fn(),
    );
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ message: 'Parent account not found' });
    await db.close();
  });
});
