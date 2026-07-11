import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyQuickSetup,
  buildQuickStartPlan,
  ensureProductConfigTables,
  getProductSetup,
  normalizeQuickSetupInput,
  type QuickSetupInput,
} from './productConfig';

const validInput: QuickSetupInput = {
  childAgeBand: '9-10',
  focusAreas: ['morning', 'homework'],
  dailyCoreActions: 2,
  weeklyRewardBudgetRmb: 30,
  screenTimeCapMinutes: 45,
};

describe('家庭快速配置输入', () => {
  it('接受边界内配置并保持整数口径', () => {
    expect(normalizeQuickSetupInput(validInput)).toEqual(validInput);
  });

  it.each([
    [{ ...validInput, focusAreas: ['morning', 'homework', 'outdoor'] }, 'focusAreas'],
    [{ ...validInput, dailyCoreActions: 4 }, 'dailyCoreActions'],
    [{ ...validInput, weeklyRewardBudgetRmb: 501 }, 'weeklyRewardBudgetRmb'],
    [{ ...validInput, screenTimeCapMinutes: 10 }, 'screenTimeCapMinutes'],
    [{ ...validInput, screenTimeCapMinutes: 181 }, 'screenTimeCapMinutes'],
  ])('拒绝会增加维护或奖励风险的非法配置 %#', (input, field) => {
    expect(() => normalizeQuickSetupInput(input)).toThrow(field);
  });
});

describe('家庭快速配置推荐计划', () => {
  it('只生成每日上限数量的核心行动，并覆盖所选目标', () => {
    const plan = buildQuickStartPlan(validInput);

    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks.map(task => task.focusArea)).toEqual(['morning', 'homework']);
    expect(plan.tasks.every(task => Number.isInteger(task.coinReward) && task.coinReward > 0)).toBe(true);
    expect(plan.tasks.every(task => Number.isInteger(task.xpReward) && task.xpReward > 0)).toBe(true);
  });

  it('生成少量可理解的奖励和特权，不把探索变成金币任务', () => {
    const plan = buildQuickStartPlan({ ...validInput, focusAreas: ['outdoor'] });

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].category).toBe('活动');
    expect(plan.tasks[0].title).not.toContain('探索打卡');
    expect(plan.wishes).toHaveLength(3);
    expect(plan.privileges).toHaveLength(2);
  });

  it('相同输入生成稳定结果，支持接口重复提交时去重', () => {
    expect(buildQuickStartPlan(validInput)).toEqual(buildQuickStartPlan(validInput));
  });
});

describe('家庭快速配置持久化', () => {
  let db: Awaited<ReturnType<typeof open>>;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE families (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL,
        coinReward INTEGER NOT NULL, xpReward INTEGER NOT NULL,
        durationMinutes INTEGER NOT NULL, category TEXT NOT NULL,
        icon TEXT, isEnabled INTEGER DEFAULT 1, taskType TEXT DEFAULT 'daily'
      );
      CREATE TABLE wishes (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, type TEXT NOT NULL,
        title TEXT NOT NULL, cost INTEGER DEFAULT 0, targetAmount INTEGER DEFAULT 0,
        currentAmount INTEGER DEFAULT 0, icon TEXT, stock INTEGER DEFAULT -1,
        isActive INTEGER DEFAULT 0, category TEXT
      );
      CREATE TABLE privileges (
        id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT, cost INTEGER NOT NULL, icon TEXT, level TEXT, category TEXT
      );
      CREATE TABLE screen_time_rules (
        familyId TEXT PRIMARY KEY, isEnabled INTEGER DEFAULT 1,
        dailyBaseMinutes INTEGER DEFAULT 15,
        dailyMaxMinutes INTEGER DEFAULT 45
      );
      INSERT INTO families (id, name) VALUES ('family-1', '测试家庭');
    `);
    await ensureProductConfigTables(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('事务内保存设置并创建推荐内容', async () => {
    const result = await applyQuickSetup(db, 'family-1', validInput);

    expect(result.setupStatus).toBe('completed');
    expect((await db.get('SELECT COUNT(*) AS count FROM tasks')).count).toBe(2);
    expect((await db.get('SELECT COUNT(*) AS count FROM wishes')).count).toBe(3);
    expect((await db.get('SELECT COUNT(*) AS count FROM privileges')).count).toBe(2);
    expect((await db.get('SELECT dailyMaxMinutes FROM screen_time_rules WHERE familyId = ?', 'family-1')).dailyMaxMinutes).toBe(45);
  });

  it('相同配置重复提交不会重复创建任务、奖励或特权', async () => {
    await applyQuickSetup(db, 'family-1', validInput);
    await applyQuickSetup(db, 'family-1', validInput);

    expect((await db.get('SELECT COUNT(*) AS count FROM tasks')).count).toBe(2);
    expect((await db.get('SELECT COUNT(*) AS count FROM wishes')).count).toBe(3);
    expect((await db.get('SELECT COUNT(*) AS count FROM privileges')).count).toBe(2);
    expect((await db.get('SELECT COUNT(*) AS count FROM family_setup_items')).count).toBe(7);
  });

  it('旧家庭没有设置记录时返回安全的未开始状态', async () => {
    expect(await getProductSetup(db, 'family-1')).toMatchObject({
      setupStatus: 'not_started',
      settings: null,
    });
  });

  it('游戏上限为0时关闭游戏时间，而不是被默认15分钟覆盖', async () => {
    await applyQuickSetup(db, 'family-1', { ...validInput, screenTimeCapMinutes: 0 });

    expect(await db.get('SELECT isEnabled, dailyMaxMinutes FROM screen_time_rules WHERE familyId = ?', 'family-1')).toMatchObject({
      isEnabled: 0,
      dailyMaxMinutes: 0,
    });
  });
});
