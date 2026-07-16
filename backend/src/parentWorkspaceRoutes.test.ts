import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { describe, expect, it, vi } from 'vitest';
import { ensureParentDailyWelcomeSchema } from './parentDailyWelcome';
import { getLocalDateString } from './beijingTime';
import {
  createClaimParentDailyWelcomeHandler,
  createGetParentTodayTasksHandler,
} from './parentWorkspaceRoutes';

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
    CREATE TABLE users (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, familyId, name, role) VALUES
      ('parent-1', 'family-1', '家长', 'parent'),
      ('child-1', 'family-1', '孩子', 'child'),
      ('child-2', 'family-2', '其他家庭孩子', 'child');
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, familyId TEXT, title TEXT, icon TEXT, coinReward INTEGER, xpReward INTEGER,
      durationMinutes INTEGER, category TEXT, taskType TEXT, customDays TEXT, validDate TEXT,
      isParallel INTEGER, completionMode TEXT, targetValue INTEGER, targetUnit TEXT, reviewFocus TEXT,
      isEnabled INTEGER, recurringTaskTemplateId TEXT, isRecurring INTEGER, recurringSchedule TEXT
    );
    CREATE TABLE task_entries (
      id TEXT PRIMARY KEY, taskId TEXT, childId TEXT, status TEXT, submittedAt TEXT,
      earnedCoins INTEGER, earnedXp INTEGER, actualDurationMinutes INTEGER, autoCompleted INTEGER,
      autoCompleteReason TEXT, reviewedAt TEXT
    );
    CREATE TABLE punishment_records (id TEXT PRIMARY KEY, taskEntryId TEXT, deductedCoins INTEGER);
    CREATE TABLE task_sessions (id TEXT PRIMARY KEY, familyId TEXT, taskId TEXT, childId TEXT, status TEXT, startedAt TEXT);
    INSERT INTO tasks VALUES (
      'task-1', 'family-1', '整理书桌', '📚', 10, 10, 10, '生活', 'daily', NULL, NULL,
      0, 'timer', 10, '分钟', '完成即可', 1, NULL, 0, NULL
    );
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

  it('今日安排只返回当前家庭孩子的当日任务，并给出配置总数', async () => {
    const db = await openTestDb();
    const today = new Date();
    const handler = createGetParentTodayTasksHandler(
      () => db,
      () => today,
    );
    const response = createResponse();
    await handler(
      { user: { id: 'parent-1', familyId: 'family-1', role: 'parent' }, query: {} } as any,
      response,
      vi.fn(),
    );
    expect(response.body.date).toBe(getLocalDateString(today));
    expect(response.body.configuredTaskCount).toBe(1);
    expect(response.body.schedules).toHaveLength(1);
    expect(response.body.schedules[0]).toMatchObject({ childId: 'child-1', childName: '孩子' });
    expect(response.body.schedules[0].tasks[0]).toMatchObject({ id: 'task-1', status: 'todo' });
    await db.close();
  });

  it('不能用孩子筛选参数读取其他家庭的数据', async () => {
    const db = await openTestDb();
    const handler = createGetParentTodayTasksHandler(() => db);
    const response = createResponse();
    await handler(
      {
        user: { id: 'parent-1', familyId: 'family-1', role: 'parent' },
        query: { childId: 'child-2' },
      } as any,
      response,
      vi.fn(),
    );
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ message: '未找到该孩子' });
    await db.close();
  });
});
