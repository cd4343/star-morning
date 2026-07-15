import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { describe, expect, it } from 'vitest';
import { getLocalDateString } from './beijingTime';
import { getTasksForDate, shouldTaskAppearOnDate } from './taskSchedule';

describe('任务日期规则', () => {
  const monday = new Date('2026-07-13T04:00:00.000Z');

  it('每日、单次和自定义星期严格按同一北京日期判断', () => {
    expect(shouldTaskAppearOnDate({ taskType: 'daily' }, monday)).toBe(true);
    expect(shouldTaskAppearOnDate({ taskType: 'once', validDate: '2026-07-13' }, monday)).toBe(true);
    expect(shouldTaskAppearOnDate({ taskType: 'once', validDate: '2026-07-14' }, monday)).toBe(false);
    expect(shouldTaskAppearOnDate({ taskType: 'custom', customDays: '[1,3]' }, monday)).toBe(true);
    expect(shouldTaskAppearOnDate({ taskType: 'custom', customDays: '[2,4]' }, monday)).toBe(false);
    expect(shouldTaskAppearOnDate({ taskType: 'custom', customDays: 'invalid' }, monday)).toBe(false);
  });

  it('旧周期字段继续兼容工作日、周末和普通任务', () => {
    expect(shouldTaskAppearOnDate({ isRecurring: 1, recurringSchedule: 'weekday' }, monday)).toBe(true);
    expect(shouldTaskAppearOnDate({ isRecurring: 1, recurringSchedule: 'weekend' }, monday)).toBe(false);
    expect(shouldTaskAppearOnDate({ isRecurring: 1, recurringSchedule: 'daily' }, monday)).toBe(true);
    expect(shouldTaskAppearOnDate({}, monday)).toBe(true);
  });

  it('今日任务合并现有记录并隐藏停用任务，保持孩子端状态口径', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
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
    `);
    const today = new Date();
    const todayString = getLocalDateString(today);
    const currentDay = today.getDay();
    await db.run(
      `INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'daily', 'family-1', '每日任务', '📋', 10, 10, 10, '生活', 'daily', null, null,
      0, 'timer', 10, '分钟', '认真完成', 1, null, 0, null,
    );
    await db.run(
      `INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'custom', 'family-1', '今天的自定义任务', '📚', 8, 8, 8, '学习', 'custom', JSON.stringify([currentDay]), null,
      0, 'timer', 8, '分钟', '专注', 1, null, 0, null,
    );
    await db.run(
      `INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'disabled', 'family-1', '停用任务', '📋', 1, 1, 1, '生活', 'daily', null, null,
      0, 'timer', 1, '分钟', '', 0, null, 0, null,
    );
    await db.run(
      'INSERT INTO task_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'entry-1', 'daily', 'child-1', 'rejected', `${todayString} 08:00:00`, 0, 0, 10, 0, null, null,
    );

    const result = await getTasksForDate(db, 'family-1', 'child-1', today);
    expect(result.map(task => task.id)).toEqual(['daily', 'custom']);
    expect(result[0]).toMatchObject({ status: 'todo', entryId: 'entry-1', canOperate: true });
    await db.close();
  });
});
