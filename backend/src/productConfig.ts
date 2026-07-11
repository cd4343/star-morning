import { randomUUID } from 'crypto';
import type { Database } from 'sqlite';

export const FOCUS_AREAS = ['morning', 'homework', 'self_care', 'housework', 'outdoor'] as const;
export type FocusArea = typeof FOCUS_AREAS[number];
export type ChildAgeBand = '6-8' | '9-10' | '11-12';

export interface QuickSetupInput {
  childAgeBand: ChildAgeBand;
  focusAreas: FocusArea[];
  dailyCoreActions: 1 | 2 | 3;
  weeklyRewardBudgetRmb: number;
  screenTimeCapMinutes: number;
}

export interface QuickStartTask {
  templateKey: string;
  focusArea: FocusArea;
  title: string;
  category: string;
  coinReward: number;
  xpReward: number;
  durationMinutes: number;
  icon: string;
}

export interface QuickStartWish {
  templateKey: string;
  type: 'shop' | 'savings';
  title: string;
  cost: number;
  icon: string;
  category: string;
}

export interface QuickStartPrivilege {
  templateKey: string;
  title: string;
  description: string;
  cost: number;
  icon: string;
  category: string;
}

export interface QuickStartPlan {
  tasks: QuickStartTask[];
  wishes: QuickStartWish[];
  privileges: QuickStartPrivilege[];
  screenTimeCapMinutes: number;
}

export class QuickSetupValidationError extends Error {}

export const DEFAULT_QUICK_SETUP_INPUT: QuickSetupInput = {
  childAgeBand: '9-10',
  focusAreas: ['morning', 'homework'],
  dailyCoreActions: 2,
  weeklyRewardBudgetRmb: 30,
  screenTimeCapMinutes: 45,
};

const TASK_TEMPLATES: Record<FocusArea, QuickStartTask> = {
  morning: {
    templateKey: 'quick-start-morning',
    focusArea: 'morning',
    title: '选一个晨间小行动',
    category: '早晨启动',
    coinReward: 4,
    xpReward: 8,
    durationMinutes: 5,
    icon: '🌤️',
  },
  homework: {
    templateKey: 'quick-start-homework',
    focusArea: 'homework',
    title: '先专注完成一小段作业',
    category: '学习',
    coinReward: 15,
    xpReward: 22,
    durationMinutes: 20,
    icon: '📚',
  },
  self_care: {
    templateKey: 'quick-start-self-care',
    focusArea: 'self_care',
    title: '整理好自己的随身物品',
    category: '生活',
    coinReward: 8,
    xpReward: 8,
    durationMinutes: 8,
    icon: '🎒',
  },
  housework: {
    templateKey: 'quick-start-housework',
    focusArea: 'housework',
    title: '主动完成一件小家务',
    category: '生活',
    coinReward: 10,
    xpReward: 10,
    durationMinutes: 10,
    icon: '🧹',
  },
  outdoor: {
    templateKey: 'quick-start-outdoor',
    focusArea: 'outdoor',
    title: '到户外活动20分钟',
    category: '活动',
    coinReward: 12,
    xpReward: 12,
    durationMinutes: 20,
    icon: '🌳',
  },
};

const assertIntegerInRange = (value: unknown, field: string, min: number, max: number): number => {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw new QuickSetupValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return numberValue;
};

export const normalizeQuickSetupInput = (input: unknown): QuickSetupInput => {
  if (!input || typeof input !== 'object') throw new QuickSetupValidationError('input must be an object');
  const raw = input as Record<string, unknown>;
  const childAgeBand = raw.childAgeBand;
  if (!['6-8', '9-10', '11-12'].includes(String(childAgeBand))) {
    throw new QuickSetupValidationError('childAgeBand is invalid');
  }

  if (!Array.isArray(raw.focusAreas) || raw.focusAreas.length < 1 || raw.focusAreas.length > 2) {
    throw new QuickSetupValidationError('focusAreas must contain one or two items');
  }
  const focusAreas = raw.focusAreas.map(String);
  if (new Set(focusAreas).size !== focusAreas.length || focusAreas.some(area => !FOCUS_AREAS.includes(area as FocusArea))) {
    throw new QuickSetupValidationError('focusAreas contains an invalid or duplicate item');
  }

  const screenTimeCapMinutes = assertIntegerInRange(raw.screenTimeCapMinutes, 'screenTimeCapMinutes', 0, 180);
  if (screenTimeCapMinutes > 0 && screenTimeCapMinutes < 15) {
    throw new QuickSetupValidationError('screenTimeCapMinutes must be 0 or at least 15');
  }

  return {
    childAgeBand: childAgeBand as ChildAgeBand,
    focusAreas: focusAreas as FocusArea[],
    dailyCoreActions: assertIntegerInRange(raw.dailyCoreActions, 'dailyCoreActions', 1, 3) as 1 | 2 | 3,
    weeklyRewardBudgetRmb: assertIntegerInRange(raw.weeklyRewardBudgetRmb, 'weeklyRewardBudgetRmb', 0, 500),
    screenTimeCapMinutes,
  };
};

export const buildQuickStartPlan = (input: QuickSetupInput): QuickStartPlan => {
  const normalized = normalizeQuickSetupInput(input);
  const taskCount = Math.min(normalized.dailyCoreActions, normalized.focusAreas.length);
  const weeklyCoinBudget = normalized.weeklyRewardBudgetRmb * 10;
  const smallRewardCost = Math.max(20, Math.round(weeklyCoinBudget * 0.15));
  const mediumRewardCost = Math.max(50, Math.round(weeklyCoinBudget * 0.35));
  const savingsRewardCost = Math.max(100, Math.round(weeklyCoinBudget * 0.8));

  return {
    tasks: normalized.focusAreas.slice(0, taskCount).map(area => ({ ...TASK_TEMPLATES[area] })),
    wishes: [
      { templateKey: 'quick-start-small-choice', type: 'shop', title: '选择一次家庭小活动', cost: smallRewardCost, icon: '🎲', category: '玩乐' },
      { templateKey: 'quick-start-favorite-snack', type: 'shop', title: '选择一份喜欢的小点心', cost: mediumRewardCost, icon: '🍪', category: '零食' },
      { templateKey: 'quick-start-savings-goal', type: 'savings', title: '我的第一个储蓄目标', cost: savingsRewardCost, icon: '🎯', category: '其他' },
    ],
    privileges: [
      { templateKey: 'quick-start-family-movie', title: '决定一次家庭电影', description: '从家长允许的范围中选择', cost: 2, icon: '🎬', category: '娱乐' },
      { templateKey: 'quick-start-weekend-choice', title: '决定一次周末活动', description: '和家长一起确定时间与范围', cost: 4, icon: '🧭', category: '外出' },
    ],
    screenTimeCapMinutes: normalized.screenTimeCapMinutes,
  };
};

export interface ProductSetupState {
  setupStatus: 'not_started' | 'completed';
  settings: QuickSetupInput | null;
  setupCompletedAt?: string;
}

export const ensureProductConfigTables = async (db: Database): Promise<void> => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS family_product_settings (
      family_id TEXT PRIMARY KEY,
      setup_mode TEXT NOT NULL DEFAULT 'quick',
      child_age_band TEXT NOT NULL,
      focus_areas_json TEXT NOT NULL,
      daily_core_actions INTEGER NOT NULL,
      weekly_reward_budget_rmb INTEGER NOT NULL,
      screen_time_cap_minutes INTEGER NOT NULL,
      setup_completed_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS family_setup_items (
      family_id TEXT NOT NULL,
      template_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (family_id, template_key),
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_family_setup_items_family_type
      ON family_setup_items(family_id, entity_type);
  `);
};

export const getProductSetup = async (db: Database, familyId: string): Promise<ProductSetupState> => {
  await ensureProductConfigTables(db);
  const row = await db.get('SELECT * FROM family_product_settings WHERE family_id = ?', familyId);
  if (!row) return { setupStatus: 'not_started', settings: null };

  let focusAreas: FocusArea[] = [];
  try {
    focusAreas = JSON.parse(row.focus_areas_json || '[]');
  } catch {
    focusAreas = [];
  }

  try {
    const settings = normalizeQuickSetupInput({
      childAgeBand: row.child_age_band,
      focusAreas,
      dailyCoreActions: row.daily_core_actions,
      weeklyRewardBudgetRmb: row.weekly_reward_budget_rmb,
      screenTimeCapMinutes: row.screen_time_cap_minutes,
    });
    return { setupStatus: 'completed', settings, setupCompletedAt: row.setup_completed_at };
  } catch {
    return { setupStatus: 'not_started', settings: null };
  }
};

const hasSetupItem = async (db: Database, familyId: string, templateKey: string): Promise<boolean> => {
  const row = await db.get(
    'SELECT 1 AS found FROM family_setup_items WHERE family_id = ? AND template_key = ?',
    familyId,
    templateKey
  );
  return Boolean(row?.found);
};

const recordSetupItem = async (
  db: Database,
  familyId: string,
  templateKey: string,
  entityType: string,
  entityId: string
): Promise<void> => {
  await db.run(
    'INSERT INTO family_setup_items (family_id, template_key, entity_type, entity_id) VALUES (?, ?, ?, ?)',
    familyId,
    templateKey,
    entityType,
    entityId
  );
};

export const applyQuickSetup = async (
  db: Database,
  familyId: string,
  input: QuickSetupInput
): Promise<ProductSetupState> => {
  const normalized = normalizeQuickSetupInput(input);
  const plan = buildQuickStartPlan(normalized);
  await ensureProductConfigTables(db);

  await db.exec('BEGIN IMMEDIATE');
  try {
    const family = await db.get('SELECT id FROM families WHERE id = ?', familyId);
    if (!family) throw new Error('family not found');

    await db.run(
      `INSERT INTO family_product_settings (
         family_id, setup_mode, child_age_band, focus_areas_json,
         daily_core_actions, weekly_reward_budget_rmb, screen_time_cap_minutes,
         setup_completed_at, updated_at
       ) VALUES (?, 'quick', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(family_id) DO UPDATE SET
         setup_mode = 'quick',
         child_age_band = excluded.child_age_band,
         focus_areas_json = excluded.focus_areas_json,
         daily_core_actions = excluded.daily_core_actions,
         weekly_reward_budget_rmb = excluded.weekly_reward_budget_rmb,
         screen_time_cap_minutes = excluded.screen_time_cap_minutes,
         setup_completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      familyId,
      normalized.childAgeBand,
      JSON.stringify(normalized.focusAreas),
      normalized.dailyCoreActions,
      normalized.weeklyRewardBudgetRmb,
      normalized.screenTimeCapMinutes
    );

    await db.run(
      `INSERT INTO screen_time_rules (familyId, isEnabled, dailyBaseMinutes, dailyMaxMinutes)
       VALUES (?, ?, 15, ?)
       ON CONFLICT(familyId) DO UPDATE SET
         isEnabled = excluded.isEnabled,
         dailyMaxMinutes = excluded.dailyMaxMinutes`,
      familyId,
      plan.screenTimeCapMinutes > 0 ? 1 : 0,
      plan.screenTimeCapMinutes
    );

    for (const task of plan.tasks) {
      if (await hasSetupItem(db, familyId, task.templateKey)) continue;
      const id = randomUUID();
      await db.run(
        `INSERT INTO tasks (
           id, familyId, title, coinReward, xpReward, durationMinutes,
           category, icon, isEnabled, taskType
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'daily')`,
        id,
        familyId,
        task.title,
        task.coinReward,
        task.xpReward,
        task.durationMinutes,
        task.category,
        task.icon
      );
      await recordSetupItem(db, familyId, task.templateKey, 'task', id);
    }

    for (const wish of plan.wishes) {
      if (await hasSetupItem(db, familyId, wish.templateKey)) continue;
      const id = randomUUID();
      await db.run(
        `INSERT INTO wishes (
           id, familyId, type, title, cost, targetAmount, currentAmount,
           icon, stock, isActive, category
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, -1, 1, ?)`,
        id,
        familyId,
        wish.type,
        wish.title,
        wish.type === 'shop' ? wish.cost : 0,
        wish.type === 'savings' ? wish.cost : 0,
        wish.icon,
        wish.category
      );
      await recordSetupItem(db, familyId, wish.templateKey, 'wish', id);
    }

    for (const privilege of plan.privileges) {
      if (await hasSetupItem(db, familyId, privilege.templateKey)) continue;
      const id = randomUUID();
      await db.run(
        `INSERT INTO privileges (
           id, familyId, title, description, cost, icon, level, category
         ) VALUES (?, ?, ?, ?, ?, ?, 'bronze', ?)`,
        id,
        familyId,
        privilege.title,
        privilege.description,
        privilege.cost,
        privilege.icon,
        privilege.category
      );
      await recordSetupItem(db, familyId, privilege.templateKey, 'privilege', id);
    }

    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  return getProductSetup(db, familyId);
};
