import { Express } from 'express';
import { getDb } from './database';
import { randomUUID } from 'crypto';
import { normalizeLotteryOutcome, normalizeLotteryPrize, resolveLotteryRewardAmount } from './lotteryRules';

const isDev = process.env.NODE_ENV !== 'production';
const logger = {
  info: (...args: any[]) => { if (isDev) console.log(...args); },
  error: (...args: any[]) => console.error(...args),
};

// JWT 类型定义（与 server.ts 保持一致）
interface AuthRequest {
  user?: {
    id: string;
    role: string;
    familyId: string;
  };
}

// 初始化 reward_pools 表
export const initRewardTables = async () => {
  const db = getDb();
  await db.run(`
    CREATE TABLE IF NOT EXISTS reward_pools (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('coins', 'xp', 'privilegePoints', 'lotteryTicket', 'shopDiscount')) NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      weight INTEGER DEFAULT 10,
      rarity TEXT DEFAULT 'common',
      icon TEXT,
      description TEXT,
      isActive INTEGER DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.run('CREATE INDEX IF NOT EXISTS idx_reward_pools_familyId ON reward_pools(familyId)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_reward_pools_isActive ON reward_pools(isActive)');
  logger.info('✅ reward_pools 表已初始化');

  // 初始化 chest_settings 表
  await db.run(`
    CREATE TABLE IF NOT EXISTS chest_settings (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL UNIQUE,
      isEnabled INTEGER DEFAULT 1,
      triggerMode TEXT DEFAULT 'random',
      easyChance REAL DEFAULT 0.25,
      mediumChance REAL DEFAULT 0.50,
      hardChance REAL DEFAULT 0.75,
      guaranteeCount INTEGER DEFAULT 5,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  try { await db.run('ALTER TABLE chest_settings ADD COLUMN updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP'); } catch (e) {}
  logger.info('✅ chest_settings 表已初始化');

  // 初始化 inventory_transfers 表（特权转让）
  await db.run(`
    CREATE TABLE IF NOT EXISTS inventory_transfers (
      id TEXT PRIMARY KEY,
      itemId TEXT NOT NULL,
      fromChildId TEXT NOT NULL,
      toChildId TEXT NOT NULL,
      familyId TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      scheduledAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (itemId) REFERENCES user_inventory(id) ON DELETE CASCADE,
      FOREIGN KEY (fromChildId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (toChildId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_transfers_familyId ON inventory_transfers(familyId)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_inventory_transfers_toChildId ON inventory_transfers(toChildId)');
  logger.info('✅ inventory_transfers 表已初始化');
};

// ==================== 审批建议计算 ====================
export interface ReviewSuggestion {
  completionRate: number;
  suggestedCoins: number;
  suggestedXp: number;
  rating: string;
  ratingColor: string;
  message: string;
}

export const calculateReviewSuggestion = (
  baseCoins: number,
  baseXp: number,
  actualDuration: number | null,
  expectedDuration: number | null,
  qualityScore?: number,
  isOverdue?: boolean
): ReviewSuggestion => {
  let completionRate = 1.0;
  if (actualDuration && expectedDuration && expectedDuration > 0) {
    completionRate = Math.min(actualDuration / expectedDuration, 1.5);
  }

  let rateFactor = 1.0;
  if (completionRate >= 1.0) rateFactor = 1.0;
  else if (completionRate >= 0.8) rateFactor = 0.9;
  else if (completionRate >= 0.5) rateFactor = 0.7;
  else if (completionRate >= 0.3) rateFactor = 0.5;
  else rateFactor = 0.3;

  let qualityFactor = 1.0;
  if (qualityScore) {
    qualityFactor = 0.5 + (qualityScore * 0.2);
  }

  const finalFactor = Math.min(rateFactor * qualityFactor, 1.5);
  const suggestedCoins = Math.round(baseCoins * finalFactor);
  const suggestedXp = Math.round(baseXp * finalFactor);

  let rating = '合格';
  let ratingColor = 'blue';
  let message = '任务已完成，建议按基础奖励发放';

  if (finalFactor >= 1.3) {
    rating = '卓越'; ratingColor = 'gold'; message = '完成质量出色，建议给予高额奖励！';
  } else if (finalFactor >= 1.0) {
    rating = '优秀'; ratingColor = 'green'; message = '任务完成良好，建议给予全额奖励';
  } else if (finalFactor >= 0.7) {
    rating = '良好'; ratingColor = 'blue'; message = '任务基本完成，建议给予大部分奖励';
  } else if (finalFactor >= 0.5) {
    rating = '一般'; ratingColor = 'orange'; message = '完成度偏低，建议给予部分奖励并鼓励';
  } else {
    rating = '需改进'; ratingColor = 'red'; message = '这次完成度比较低，建议先聊聊卡在哪里，再给少量鼓励性奖励';
  }

  if (isOverdue) {
    message = `【超时】${message}`;
    if (ratingColor === 'green' || ratingColor === 'gold') {
        ratingColor = 'blue'; // 如果超时，颜色调低一级，即使完成度高
    }
  }

  return {
    completionRate: Math.round(completionRate * 100),
    suggestedCoins, suggestedXp, rating, ratingColor, message
  };
};

// ==================== 宝箱系统 ====================
export interface ChestReward {
  id: string;
  name: string;
  type: string;
  value: number;
  rarity: string;
  icon: string;
}

export interface ChestSettings {
  familyId: string;
  isEnabled: number;
  triggerMode: 'random' | 'always';
  easyChance: number;
  mediumChance: number;
  hardChance: number;
  guaranteeCount: number;
}

export interface ChestTriggerResult {
  triggered: boolean;
  chance: number;
  reason: 'disabled' | 'always' | 'guarantee' | 'random-hit' | 'random-miss';
  difficulty: 'easy' | 'medium' | 'hard';
  submissionsSinceLastChest: number;
  settings: ChestSettings;
}

const DEFAULT_CHEST_SETTINGS = {
  isEnabled: 1,
  triggerMode: 'always' as const,
  easyChance: 1,
  mediumChance: 1,
  hardChance: 1,
  guaranteeCount: 0,
};

const DEFAULT_REWARD_POOL_ITEMS = [
  { name: '小星币', type: 'coins', value: 2, weight: 45, rarity: 'common', icon: '🪙', description: '完成任务后的即时金币反馈。' },
  { name: '能量金币', type: 'coins', value: 5, weight: 25, rarity: 'uncommon', icon: '⚡', description: '一份更亮眼的小金币惊喜。' },
  { name: '幸运拼图', type: 'lotteryTicket', value: 1, weight: 25, rarity: 'uncommon', icon: '🧩', description: '集齐2片自动合成1次幸运转盘机会。' },
  { name: '权益点', type: 'privilegePoints', value: 1, weight: 5, rarity: 'rare', icon: '💎', description: '低频奖励，用于兑换家庭约定权益。' },
];

const SUPPORTED_CHEST_REWARD_TYPES = ['coins', 'privilegePoints', 'lotteryTicket'] as const;

export const ensureDefaultRewardPools = async (db: any, familyId: string) => {
  const existing = await db.get('SELECT COUNT(*) as count FROM reward_pools WHERE familyId = ?', familyId);
  if ((existing?.count || 0) > 0) return;

  for (const item of DEFAULT_REWARD_POOL_ITEMS) {
    await db.run(
      `INSERT INTO reward_pools (id, familyId, name, type, value, weight, rarity, icon, description, isActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      randomUUID(),
      familyId,
      item.name,
      item.type,
      item.value,
      item.weight,
      item.rarity,
      item.icon,
      item.description
    );
  }
};

const clampChance = (value: any, fallback: number) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
};

const clampNonNegativeInt = (value: any, fallback: number) => {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num) || num < 0) return fallback;
  return num;
};

const getChestSettingsColumns = async (db: any) => {
  const columns = await db.all('PRAGMA table_info(chest_settings)');
  return new Set(columns.map((col: any) => col.name));
};

const normalizeChestSettings = (row: any, familyId: string): ChestSettings => ({
  familyId,
  isEnabled: row?.isEnabled === 0 ? 0 : 1,
  triggerMode: 'always',
  easyChance: 1,
  mediumChance: 1,
  hardChance: 1,
  guaranteeCount: 0,
});

export const getOrCreateChestSettings = async (db: any, familyId: string): Promise<ChestSettings> => {
  let settings = await db.get('SELECT * FROM chest_settings WHERE familyId = ?', familyId);
  if (settings) return normalizeChestSettings(settings, familyId);

  const columns = await getChestSettingsColumns(db);
  const fields: string[] = [];
  const values: any[] = [];

  if (columns.has('id')) {
    fields.push('id');
    values.push(randomUUID());
  }

  fields.push('familyId', 'isEnabled', 'triggerMode', 'easyChance', 'mediumChance', 'hardChance', 'guaranteeCount');
  values.push(
    familyId,
    DEFAULT_CHEST_SETTINGS.isEnabled,
    DEFAULT_CHEST_SETTINGS.triggerMode,
    DEFAULT_CHEST_SETTINGS.easyChance,
    DEFAULT_CHEST_SETTINGS.mediumChance,
    DEFAULT_CHEST_SETTINGS.hardChance,
    DEFAULT_CHEST_SETTINGS.guaranteeCount
  );

  if (columns.has('updatedAt')) {
    fields.push('updatedAt');
    values.push(new Date().toISOString());
  }

  const placeholders = fields.map(() => '?').join(', ');
  await db.run(`INSERT INTO chest_settings (${fields.join(', ')}) VALUES (${placeholders})`, ...values);
  settings = await db.get('SELECT * FROM chest_settings WHERE familyId = ?', familyId);
  return normalizeChestSettings(settings, familyId);
};

export const updateChestSettings = async (db: any, familyId: string, input: any): Promise<ChestSettings> => {
  await getOrCreateChestSettings(db, familyId);

  const current = await db.get('SELECT * FROM chest_settings WHERE familyId = ?', familyId);
  const next = normalizeChestSettings({
    ...current,
    ...input,
    isEnabled: input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : current?.isEnabled,
    triggerMode: 'always',
    easyChance: 1,
    mediumChance: 1,
    hardChance: 1,
    guaranteeCount: 0,
  }, familyId);

  const columns = await getChestSettingsColumns(db);
  const assignments = [
    'isEnabled = ?',
    'triggerMode = ?',
    'easyChance = ?',
    'mediumChance = ?',
    'hardChance = ?',
    'guaranteeCount = ?',
  ];
  const values: any[] = [
    next.isEnabled,
    next.triggerMode,
    next.easyChance,
    next.mediumChance,
    next.hardChance,
    next.guaranteeCount,
  ];

  if (columns.has('updatedAt')) {
    assignments.push('updatedAt = CURRENT_TIMESTAMP');
  }

  values.push(familyId);
  await db.run(`UPDATE chest_settings SET ${assignments.join(', ')} WHERE familyId = ?`, ...values);
  return getOrCreateChestSettings(db, familyId);
};

export const drawChestReward = async (
  db: any,
  familyId: string,
  _difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): Promise<ChestReward | null> => {
  await ensureDefaultRewardPools(db, familyId);
  const items = await db.all(
    "SELECT * FROM reward_pools WHERE familyId = ? AND isActive = 1",
    familyId
  );
  if (items.length === 0) return null;

  const candidates = items.filter((item: any) => SUPPORTED_CHEST_REWARD_TYPES.includes(item.type));
  if (candidates.length === 0) return null;
  const weightedItems = candidates.map((item: any) => ({
    ...item,
    adjustedWeight: Math.max(1, Math.round(Number(item.weight || 10))),
  }));
  const totalWeight = weightedItems.reduce((sum: number, p: any) => sum + p.adjustedWeight, 0);
  let random = Math.random() * totalWeight;
  let selected = weightedItems[0];
  for (const item of weightedItems) {
    random -= item.adjustedWeight;
    if (random <= 0) { selected = item; break; }
  }
  return {
    id: selected.id,
    name: selected.name,
    type: selected.type,
    value: selected.value,
    rarity: selected.rarity || 'common',
    icon: selected.icon || '🎁'
  };
};

export const calculateChestChance = (consecutiveCount: number, taskDifficulty: string, settings?: ChestSettings): number => {
  if (settings) {
    if (taskDifficulty === 'hard') return settings.hardChance;
    if (taskDifficulty === 'medium') return settings.mediumChance;
    return settings.easyChance;
  }

  let baseChance = 0.15;
  if (consecutiveCount >= 7) baseChance += 0.35;
  else if (consecutiveCount >= 5) baseChance += 0.25;
  else if (consecutiveCount >= 3) baseChance += 0.15;
  if (taskDifficulty === 'hard') baseChance += 0.15;
  else if (taskDifficulty === 'medium') baseChance += 0.05;
  return Math.min(baseChance, 0.85);
};

export const getChestTriggerResult = async (
  db: any,
  familyId: string,
  childId: string,
  taskDifficulty: 'easy' | 'medium' | 'hard'
): Promise<ChestTriggerResult> => {
  const settings = await getOrCreateChestSettings(db, familyId);
  const lastChest = await db.get(
    `SELECT createdAt FROM chest_records WHERE childId = ? AND familyId = ? ORDER BY datetime(createdAt) DESC LIMIT 1`,
    childId,
    familyId
  );

  const params: any[] = [childId, familyId];
  let sinceClause = '';
  if (lastChest?.createdAt) {
    sinceClause = 'AND datetime(te.submittedAt) > datetime(?)';
    params.push(lastChest.createdAt);
  }

  const submissionsRow = await db.get(
    `
      SELECT COUNT(te.id) as count
      FROM task_entries te
      JOIN tasks t ON te.taskId = t.id
      WHERE te.childId = ?
        AND t.familyId = ?
        AND te.status IN ('pending', 'approved')
        ${sinceClause}
    `,
    ...params
  );
  const submissionsSinceLastChest = submissionsRow?.count || 0;
  const chance = settings.isEnabled ? 1 : 0;

  if (!settings.isEnabled) {
    return { triggered: false, chance: 0, reason: 'disabled', difficulty: taskDifficulty, submissionsSinceLastChest, settings };
  }

  return { triggered: true, chance, reason: 'always', difficulty: taskDifficulty, submissionsSinceLastChest, settings };
};

export const recordChestReward = async (
  db: any,
  args: {
    childId: string;
    familyId: string;
    taskEntryId: string;
    reward: ChestReward;
    status?: 'pending' | 'granted';
  }
) => {
  await db.run(
    `
      INSERT INTO chest_records (
        id, childId, familyId, taskEntryId, rewardId,
        rewardName, rewardType, rewardValue, rewardRarity, rewardIcon, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    randomUUID(),
    args.childId,
    args.familyId,
    args.taskEntryId,
    args.reward.id,
    args.reward.name,
    args.reward.type,
    args.reward.value,
    args.reward.rarity || 'common',
    args.reward.icon || '🎁',
    args.status || 'granted'
  );
};

// ==================== 动态惩罚调整 ====================
export interface PunishmentAdjustment {
  originalDeduction: number;
  adjustedDeduction: number;
  adjustmentFactor: number;
  messages: string[];
  suggestTaskReview: boolean;
  suggestTalk: boolean;
}

export const calculateAdjustedPunishment = async (
  db: any,
  baseDeduction: number,
  taskId: string,
  childId: string
): Promise<PunishmentAdjustment> => {
  let factor = 1.0;
  const messages: string[] = [];
  let suggestTaskReview = false;
  let suggestTalk = false;

  try {
    const taskStats = await db.get(`
      SELECT COUNT(te.id) as totalSubmissions, COUNT(pr.id) as punishmentCount
      FROM tasks t
      LEFT JOIN task_entries te ON t.id = te.taskId
      LEFT JOIN punishment_records pr ON te.id = pr.taskEntryId
      WHERE t.id = ? AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', '-30 days')
    `, taskId);

    if (taskStats && taskStats.totalSubmissions > 0) {
      const taskRate = taskStats.punishmentCount / taskStats.totalSubmissions;
      if (taskRate > 0.5) {
        factor *= 0.7;
        messages.push('该任务近期惩罚率较高，建议检查任务难度是否合适');
        suggestTaskReview = true;
      } else if (taskRate > 0.3) {
        factor *= 0.85;
        messages.push('该任务惩罚率偏高，已适度减轻惩罚');
      }
    }

    const childRecent = await db.get(
      'SELECT COUNT(*) as count FROM punishment_records WHERE childId = ? AND date(createdAt, "+8 hours") >= date("now", "+8 hours", "-7 days")',
      childId
    );
    const recentCount = childRecent?.count || 0;
    if (recentCount >= 3) {
      factor *= 0.8;
      messages.push('孩子近期已有多次惩罚，建议关注而非加重');
      suggestTalk = true;
    } else if (recentCount >= 2) {
      factor *= 0.9;
      messages.push('孩子近期惩罚频率较高，已适度减轻');
    }

    const todayEarned = (await db.get(`
      SELECT COALESCE(SUM(earnedCoins), 0) as s FROM task_entries
      WHERE childId = ? AND status = 'approved' AND date(datetime(submittedAt, '+8 hours')) = date(datetime('now', '+8 hours'))
    `, childId))?.s || 0;

    const maxDailyDeduction = Math.max(todayEarned * 0.5, 5);
    const rawAdjusted = Math.round(baseDeduction * factor);
    if (rawAdjusted > maxDailyDeduction) {
      factor = maxDailyDeduction / baseDeduction;
      messages.push('已触发当日上限保护（不超过今日已获金币的50%）');
    }
  } catch (err) {
    logger.error('动态惩罚调整计算失败:', err);
  }

  const adjustedDeduction = Math.max(1, Math.round(baseDeduction * factor));
  return { originalDeduction: baseDeduction, adjustedDeduction, adjustmentFactor: Math.round(factor * 100) / 100, messages, suggestTaskReview, suggestTalk };
};

// ==================== 惩罚分级建议与 Tips ====================
export const PUNISHMENT_TIPS: Record<string, string> = {
  mild: "轻度提醒：建议配合'5分钟倒计时'法。与其责备，不如让他和计时器赛跑，完成任务后给予额外的口头夸奖。",
  moderate: "中度警示：建议暂时收回一项非必要特权（如今日游戏时间）。明确告诉孩子：由于规则未达成，特权将顺延至下次任务完成。",
  severe: "重度惩戒：除了扣分，建议进行一次深度的家庭会议。不要在愤怒时交流，等双方冷静后，共同探讨如何改进流程，而非仅仅惩罚结果。",
  custom: "自定义处理：请家长保持奖惩一致性。过度的惩罚可能引起逆反，建议结合积分翻盘机会，给孩子改过自新的出口。"
};

// ==================== 注册路由 ====================
export function registerRewardSystemRoutes(app: Express, protect: any) {
  // --- 宝箱奖励池管理 ---
  app.get('/api/parent/reward-pools', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    await ensureDefaultRewardPools(db, request.user!.familyId);
    const rows = await db.all('SELECT * FROM reward_pools WHERE familyId = ? ORDER BY rarity DESC, weight DESC', request.user!.familyId);
    res.json(rows);
  });

  app.post('/api/parent/reward-pools', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { name, type, value, weight, rarity, icon, description } = req.body;
    if (!name || !type || value === undefined) return res.status(400).json({ message: '名称、类型、数值不能为空' });
    if (!SUPPORTED_CHEST_REWARD_TYPES.includes(type)) return res.status(400).json({ message: '宝箱只支持金币、幸运拼图和权益点' });
    // P2：启用中的宝箱奖品总数上限 9（够随机又不稀释稀有奖）；新增默认即启用，故先校验
    const activeCount = await getDb().get('SELECT COUNT(*) as c FROM reward_pools WHERE familyId = ? AND isActive = 1', request.user!.familyId);
    if ((activeCount?.c || 0) >= 9) return res.status(400).json({ message: '启用中的宝箱奖品已达上限（9 个），请先停用或删除其他奖品' });
    await getDb().run(
      `INSERT INTO reward_pools (id, familyId, name, type, value, weight, rarity, icon, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), request.user!.familyId, name, type, value, weight || 10, rarity || 'common', icon || '🎁', description || ''
    );
    res.json({ message: '添加成功' });
  });

  app.put('/api/parent/reward-pools/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const { name, type, value, weight, rarity, icon, description, isActive } = req.body;
    // 部分更新：未传字段回填原值，防止把其他字段写成 NULL；type 走白名单防 CHECK 约束 500
    const existing = await getDb().get('SELECT * FROM reward_pools WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    if (!existing) return res.status(404).json({ message: '奖励不存在' });
    const nextType = type !== undefined ? type : existing.type;
    if (!SUPPORTED_CHEST_REWARD_TYPES.includes(nextType)) return res.status(400).json({ message: '宝箱只支持金币、幸运拼图和权益点' });
    const nextName = name !== undefined ? name : existing.name;
    if (!nextName) return res.status(400).json({ message: '名称不能为空' });
    // P2：若本次是"停用→启用"，需保证启用总数不超过上限 9（防止绕过添加校验）
    if (isActive !== undefined && isActive && !existing.isActive) {
      const activeCount = await getDb().get('SELECT COUNT(*) as c FROM reward_pools WHERE familyId = ? AND isActive = 1', request.user!.familyId);
      if ((activeCount?.c || 0) >= 9) return res.status(400).json({ message: '启用中的宝箱奖品已达上限（9 个），请先停用其他奖品' });
    }
    await getDb().run(
      `UPDATE reward_pools SET name = ?, type = ?, value = ?, weight = ?, rarity = ?, icon = ?, description = ?, isActive = ? WHERE id = ? AND familyId = ?`,
      nextName, nextType,
      value !== undefined ? value : existing.value,
      weight !== undefined ? weight : existing.weight,
      rarity !== undefined ? rarity : existing.rarity,
      icon !== undefined ? icon : existing.icon,
      description !== undefined ? description : existing.description,
      isActive !== undefined ? (isActive ? 1 : 0) : existing.isActive,
      req.params.id, request.user!.familyId
    );
    res.json({ message: '更新成功' });
  });

  app.delete('/api/parent/reward-pools/:id', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    await getDb().run('DELETE FROM reward_pools WHERE id = ? AND familyId = ?', req.params.id, request.user!.familyId);
    res.json({ message: '删除成功' });
  });

  app.get('/api/child/chest-prizes', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const settings = await getOrCreateChestSettings(db, request.user!.familyId);
    await ensureDefaultRewardPools(db, request.user!.familyId);
    const rows = await db.all(
      `SELECT id, name, type, value, rarity, icon, description
       FROM reward_pools
       WHERE familyId = ? AND isActive = 1 AND type IN ('coins', 'privilegePoints', 'lotteryTicket')
       ORDER BY
         CASE rarity
           WHEN 'legendary' THEN 1
           WHEN 'epic' THEN 2
           WHEN 'rare' THEN 3
           WHEN 'uncommon' THEN 4
           ELSE 5
         END,
         name ASC`,
      request.user!.familyId
    );
    const puzzle = await db.get(
      'SELECT pieces, tickets_generated FROM lottery_puzzle_progress WHERE child_id = ? AND family_id = ?',
      request.user!.id, request.user!.familyId
    );
    res.json({
      settings,
      prizes: rows,
      puzzleProgress: {
        pieces: Number(puzzle?.pieces || 0),
        required: 2,
        ticketsGenerated: Number(puzzle?.tickets_generated || 0),
      },
      note: '完成任务就会打开惊喜宝箱；幸运拼图集齐2片会自动合成1次幸运转盘机会。'
    });
  });

  // --- 审批建议 ---
  app.get('/api/parent/review/:entryId/suggestion', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const entry = await db.get(`
      SELECT te.*, t.title, t.category, t.taskType, t.completionMode, t.targetValue, t.targetUnit, t.reviewFocus,
             t.coinReward, t.xpReward, t.durationMinutes as expectedDuration, t.familyId
      FROM task_entries te JOIN tasks t ON te.taskId = t.id WHERE te.id = ?
    `, req.params.entryId);
    if (!entry) return res.status(404).json({ message: '不存在' });
    if (entry.familyId !== request.user!.familyId) return res.status(403).json({ message: '无权操作' });
    const baseSuggestion = calculateReviewSuggestion(entry.coinReward, entry.xpReward, entry.actualDurationMinutes, entry.expectedDuration, undefined, entry.isOverdue === 1);
    const expected = Math.max(1, Number(entry.expectedDuration || 0));
    const actual = Number(entry.actualDurationMinutes || 0);
    const ratio = expected > 0 && actual > 0 ? actual / expected : 1;
    const rawCategory = String(entry.category || '');
    const category = ['劳动', '生活习惯', '日常', '家务'].includes(rawCategory) ? '生活' : rawCategory;
    const completionMode = String(entry.completionMode || (category === '运动' || category === '活动' ? 'participation' : 'timer'));
    const targetValue = Number(entry.targetValue || 0);
    const targetUnit = String(entry.targetUnit || (completionMode === 'timer' ? '分钟' : ''));
    const isSportTask = category === '运动';
    const isActivityTask = category === '活动';
    const isStudyTask = category === '学习';
    const isLifeTask = category === '生活';
    const isAutoCompleted = Number(entry.autoCompleted || 0) === 1;
    const isOverdue = Number(entry.isOverdue || 0) === 1;
    const reasons: string[] = [];
    if (completionMode !== 'timer') {
      const targetText = targetValue > 0 ? `${targetValue}${targetUnit}` : '家长设置的目标';
      reasons.push(`本任务按“${completionMode === 'participation' ? '参与完成' : completionMode === 'count' ? '数量完成' : '清单完成'}”审核，目标为${targetText}。`);
    }

    let timeScore = 0;
    if (isAutoCompleted) {
      timeScore = -10;
      reasons.push('孩子开始后忘记结束，建议保留奖励但降低时间加成。');
    } else if (isSportTask) {
      if (ratio >= 1) {
        timeScore = 10;
        reasons.push('运动类看参与完整度，达到预计参与量可给参与加成。');
      } else if (ratio >= 0.7) {
        timeScore = 0;
        reasons.push('运动类不按效率快慢评判，接近预计参与量按基础奖励处理。');
      } else if (ratio >= 0.4) {
        timeScore = -10;
        reasons.push('这次动得不太够，可轻微下调参与分。');
      } else {
        timeScore = -20;
        reasons.push('运动参与明显不足，建议先了解体力、抗拒或安全原因。');
      }
    } else if (isActivityTask) {
      if (ratio >= 0.85) {
        timeScore = 10;
        reasons.push('活动类看投入和过程完整，不按完成快慢加分。');
      } else if (ratio >= 0.6) {
        timeScore = 0;
        reasons.push('活动参与基本到位，按基础参与分处理。');
      } else if (ratio >= 0.35) {
        timeScore = -10;
        reasons.push('活动投入偏少，建议轻微下调参与分。');
      } else {
        timeScore = -20;
        reasons.push('活动很难参与或中断较多，建议先降低活动门槛。');
      }
    } else if (completionMode !== 'timer') {
      if (ratio >= 0.8) {
        timeScore = 10;
        reasons.push('本任务按目标/清单完成度审核，时间只作为是否完整参与的参考。');
      } else if (ratio >= 0.5) {
        timeScore = 0;
        reasons.push('本任务不按效率快慢加分，建议按目标完成度给基础分。');
      } else {
        timeScore = -10;
        reasons.push('参与或完成量偏少，建议轻微下调目标完成分。');
      }
    } else if (isStudyTask) {
      if (ratio < 0.45) {
        timeScore = -10;
        reasons.push('比预计快了不少，可能跳过了步骤，建议先翻看完成质量再给分。');
      } else if (ratio <= 1.4) {
        timeScore = 0;
        reasons.push('学习类不按速度加分，用时在合理范围内即可，重点看质量和坚持。');
      } else if (ratio <= 2) {
        timeScore = -5;
        reasons.push('比预计多用了一些时间，可能中途卡住或分心了，先不急着扣分。');
      } else {
        timeScore = -10;
        reasons.push('用时比预计长很多，孩子可能一直卡着，建议把任务拆小一点，并提醒他可以求助。');
      }
    } else if (isLifeTask) {
      if (ratio <= 1.3) {
        timeScore = 0;
        reasons.push('生活类看结果可用和少提醒，不因为做得快额外加分。');
      } else if (ratio <= 2) {
        timeScore = -10;
        reasons.push('这次开始得有点慢，可轻微下调节奏分，先了解一下原因。');
      } else {
        timeScore = -20;
        reasons.push('这次磨蹭得比较久，建议把任务拆小一点或改成清单完成。');
      }
    } else if (ratio <= 0.8) {
      timeScore = 20;
      reasons.push('用时明显少于预计，适合给时间加成。');
    } else if (ratio <= 1.15) {
      timeScore = 0;
      reasons.push('用时接近预计，建议按基础时间分处理。');
    } else if (ratio <= 1.5) {
      timeScore = -10;
      reasons.push('比预计稍微多用了一点时间，可以小幅下调时间分。');
    } else {
      timeScore = -20;
      reasons.push('比预计多用了一些时间，可能中途分心了，建议下调时间分并和孩子聊聊原因。');
    }

    let qualityScore = 0;
    if (isAutoCompleted) {
      qualityScore = -30;
      reasons.push('自动收尾缺少完成确认，质量分建议由家长复核。');
    } else if (entry.proof && String(entry.proof).trim().length >= 4) {
      qualityScore = 10;
      if (isSportTask) {
        reasons.push('有运动说明或凭证，默认给动作完成/安全确认加成。');
      } else if (isActivityTask) {
        reasons.push('有活动说明或成果记录，默认给过程/成果加成。');
      } else {
        reasons.push('有提交说明或凭证，默认给认真完成加成。');
      }
    } else {
      reasons.push(isSportTask
        ? '动作完成和安全性仍建议家长确认。'
        : isActivityTask
          ? '活动过程、成果和合作表现仍建议家长确认。'
          : '质量仍建议家长根据实际完成情况确认。');
    }

    let initiativeScore = 0;
    if (isAutoCompleted) {
      initiativeScore = -20;
      reasons.push('孩子忘了点结束，不代表没认真做，主动性轻微下调即可。');
    } else if (isSportTask && !isOverdue && ratio >= 0.7) {
      initiativeScore = 10;
      reasons.push('运动参与到位，主动性可给轻微鼓励。');
    } else if (isActivityTask && !isOverdue && ratio >= 0.6) {
      initiativeScore = 10;
      reasons.push('活动投入基本到位，合作/表达可给轻微鼓励。');
    } else if (!isOverdue && ratio <= 1.15) {
      initiativeScore = 0;
      reasons.push('正常提交，主动性按无需提醒处理。');
    } else {
      initiativeScore = -10;
      reasons.push('这次提交得慢了一些，可能需要多提醒，主动性可轻微下调。');
    }

    const totalBonus = timeScore + qualityScore + initiativeScore;
    const suggestedCoins = Math.max(0, Math.round(Number(entry.coinReward || 0) * (100 + totalBonus) / 100));
    const suggestedXp = Math.max(0, Math.round(Number(entry.xpReward || 0) * (100 + totalBonus) / 100));
    const rating = totalBonus >= 40 ? '卓越' : totalBonus >= 15 ? '优秀' : totalBonus >= -10 ? '良好' : totalBonus >= -35 ? '一般' : '需改进';
      const ratingColor = rating === '卓越' ? 'gold' : rating === '优秀' ? 'green' : rating === '良好' ? 'blue' : rating === '一般' ? 'orange' : 'red';
    const message = isAutoCompleted
      ? '任务已自动收尾，建议先确认实际完成情况，再按建议分审核。'
      : isSportTask
        ? '运动任务更看重参与、动作完成和安全，时间只作为参与完整度参考。'
        : isActivityTask
          ? '活动任务更看重投入、过程成果和合作表达，时间只作为参与完整度参考。'
        : isStudyTask
          ? '学习任务更看重启动、质量和坚持，不建议因为做得快而加大奖励。'
        : isLifeTask
          ? '生活任务更看重稳定、结果可用和少提醒，单次奖励不宜过高。'
        : completionMode !== 'timer'
          ? '这个任务按目标或清单审核，时间只作为记录参考，不按效率快慢奖励。'
        : baseSuggestion.message;

    res.json({
      entryId: entry.id,
      title: entry.title,
      category,
      completionMode,
      targetValue,
      targetUnit,
      reviewFocus: entry.reviewFocus || '',
      baseCoins: entry.coinReward,
      baseXp: entry.xpReward,
      actualDuration: entry.actualDurationMinutes,
      expectedDuration: entry.expectedDuration,
      isOverdue,
      autoCompleted: isAutoCompleted,
      completionRate: baseSuggestion.completionRate,
      suggestedCoins,
      suggestedXp,
      rating,
      ratingColor,
      message,
      scores: { timeScore, qualityScore, initiativeScore, totalBonus },
      reasons,
    });
  });

  // --- 惩罚统计（增强版）---
  app.get('/api/parent/punishment-stats', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const familyId = request.user!.familyId;

    const totalCount = (await db.get('SELECT COUNT(*) as count FROM punishment_records WHERE familyId = ?', familyId))?.count || 0;
    const weekCount = (await db.get('SELECT COUNT(*) as count FROM punishment_records WHERE familyId = ? AND date(createdAt, "+8 hours") >= date("now", "+8 hours", "-7 days")', familyId))?.count || 0;
    const prevWeekCount = (await db.get('SELECT COUNT(*) as count FROM punishment_records WHERE familyId = ? AND date(createdAt, "+8 hours") >= date("now", "+8 hours", "-14 days") AND date(createdAt, "+8 hours") < date("now", "+8 hours", "-7 days")', familyId))?.count || 0;

    const byLevel = await db.all(`SELECT level, COUNT(*) as count, SUM(deductedCoins) as totalDeducted FROM punishment_records WHERE familyId = ? GROUP BY level`, familyId);
    const byChild = await db.all(`SELECT pr.childId, u.name as childName, COUNT(*) as count, SUM(pr.deductedCoins) as totalDeducted, COUNT(CASE WHEN date(pr.createdAt, '+8 hours') >= date('now', '+8 hours', '-7 days') THEN 1 END) as weekCount, COUNT(CASE WHEN date(pr.createdAt, '+8 hours') >= date('now', '+8 hours', '-14 days') AND date(pr.createdAt, '+8 hours') < date('now', '+8 hours', '-7 days') THEN 1 END) as prevWeekCount FROM punishment_records pr JOIN users u ON pr.childId = u.id WHERE pr.familyId = ? GROUP BY pr.childId`, familyId);

    const taskStats = await db.all(`SELECT t.id as taskId, t.title, COUNT(te.id) as totalSubmissions, COUNT(pr.id) as punishmentCount, ROUND(CAST(COUNT(pr.id) AS REAL) * 100.0 / NULLIF(COUNT(te.id), 0), 1) as punishmentRate, ROUND(AVG(pr.deductedCoins), 1) as avgDeduction, MAX(pr.createdAt) as lastPunishmentAt FROM tasks t LEFT JOIN task_entries te ON t.id = te.taskId LEFT JOIN punishment_records pr ON te.id = pr.taskEntryId WHERE t.familyId = ? AND t.isEnabled = 1 GROUP BY t.id HAVING COUNT(te.id) > 0 ORDER BY punishmentRate DESC`, familyId);

    const highRiskTasks = taskStats.filter((t: any) => (t.punishmentRate || 0) > 40);
    const topViolationTasks = taskStats
      .filter((t: any) => Number(t.punishmentCount || 0) > 0)
      .sort((a: any, b: any) => Number(b.punishmentCount || 0) - Number(a.punishmentCount || 0))
      .slice(0, 5)
      .map((t: any) => ({ taskId: t.taskId, title: t.title, count: t.punishmentCount }));
    const activeDaysWithPunishment = (await db.get(
      `SELECT COUNT(DISTINCT date(createdAt, '+8 hours')) as count
         FROM punishment_records
        WHERE familyId = ? AND date(createdAt, '+8 hours') >= date('now', '+8 hours', '-30 days')`,
      familyId
    ))?.count || 0;
    const perfectDays = Math.max(0, 30 - Number(activeDaysWithPunishment || 0));
    const topReasons = await db.all(`SELECT reason, COUNT(*) as count FROM punishment_records WHERE familyId = ? GROUP BY reason ORDER BY count DESC LIMIT 5`, familyId);

    res.json({ totalCount, weekCount, prevWeekCount, perfectDays, trend: weekCount > prevWeekCount ? '上升' : weekCount < prevWeekCount ? '下降' : '持平', byLevel, byChild, taskStats, highRiskTasks, topViolationTasks, topReasons });
  });

  // ==================== 宝箱设置管理 ====================
  app.get('/api/parent/chest-settings', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const settings = await getOrCreateChestSettings(db, request.user!.familyId);
    res.json(settings);
  });

  app.put('/api/parent/chest-settings', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const settings = await updateChestSettings(db, request.user!.familyId, req.body || {});
    res.json({ message: '设置已更新', settings });
  });

  // ==================== 物品转让（一键转赠）====================
  app.post('/api/child/inventory/:id/transfer', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const { toChildId, scheduledAt } = req.body;
    
    if (!toChildId) return res.status(400).json({ message: '请选择接收人' });
    
    const item = await db.get('SELECT * FROM user_inventory WHERE id = ? AND childId = ?', req.params.id, request.user!.id);
    if (!item) return res.status(404).json({ message: '物品不存在' });
    if (item.status !== 'pending' && item.status !== 'unused') return res.status(400).json({ message: '该物品无法转让' });
    
    // 验证接收人是否在同一家庭
    const toChild = await db.get('SELECT id, name FROM users WHERE id = ? AND familyId = ? AND role = "child"', toChildId, request.user!.familyId);
    if (!toChild) return res.status(400).json({ message: '接收人无效' });
    
    // 创建转让记录
    const transferId = randomUUID();
    await db.run(
      `INSERT INTO inventory_transfers (id, itemId, fromChildId, toChildId, familyId, status, scheduledAt) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      transferId, item.id, request.user!.id, toChildId, request.user!.familyId, scheduledAt || null
    );
    
    // 标记物品为转让中
    await db.run("UPDATE user_inventory SET status = 'transferring' WHERE id = ?", item.id);
    
    res.json({ message: `转让请求已发送给 ${toChild.name}`, transferId });
  });

  app.get('/api/child/transfers', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    
    // 查询我发出的和收到的转让
    const sent = await db.all(`
      SELECT it.*, ui.title, ui.icon, u.name as toChildName
      FROM inventory_transfers it
      JOIN user_inventory ui ON it.itemId = ui.id
      JOIN users u ON it.toChildId = u.id
      WHERE it.fromChildId = ? ORDER BY it.createdAt DESC
    `, request.user!.id);
    
    const received = await db.all(`
      SELECT it.*, ui.title, ui.icon, u.name as fromChildName
      FROM inventory_transfers it
      JOIN user_inventory ui ON it.itemId = ui.id
      JOIN users u ON it.fromChildId = u.id
      WHERE it.toChildId = ? AND it.status = 'pending' ORDER BY it.createdAt DESC
    `, request.user!.id);
    
    res.json({ sent, received });
  });

  app.post('/api/child/transfers/:id/accept', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    
    const transfer = await db.get('SELECT * FROM inventory_transfers WHERE id = ? AND toChildId = ? AND status = "pending"', req.params.id, request.user!.id);
    if (!transfer) return res.status(404).json({ message: '转让不存在或已处理' });
    
    try {
      await db.run('BEGIN');
      // 状态守卫：防止并发重复接受
      const upd = await db.run("UPDATE inventory_transfers SET status = 'accepted' WHERE id = ? AND status = 'pending'", transfer.id);
      if ((upd.changes || 0) !== 1) throw new Error('TRANSFER_ALREADY_PROCESSED');
      await db.run('UPDATE user_inventory SET childId = ?, status = "pending" WHERE id = ?', request.user!.id, transfer.itemId);
      await db.run('COMMIT');
    } catch (err: any) {
      try { await db.run('ROLLBACK'); } catch {}
      if (err.message === 'TRANSFER_ALREADY_PROCESSED') return res.status(409).json({ message: '转让已被处理' });
      console.error('接受转让失败:', err);
      return res.status(500).json({ message: '操作失败，请重试' });
    }

    res.json({ message: '已接受转让，物品已放入你的背包' });
  });

  app.post('/api/child/transfers/:id/reject', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    
    const transfer = await db.get('SELECT * FROM inventory_transfers WHERE id = ? AND toChildId = ? AND status = "pending"', req.params.id, request.user!.id);
    if (!transfer) return res.status(404).json({ message: '转让不存在或已处理' });
    
    try {
      await db.run('BEGIN');
      const upd = await db.run("UPDATE inventory_transfers SET status = 'rejected' WHERE id = ? AND status = 'pending'", transfer.id);
      if ((upd.changes || 0) !== 1) throw new Error('TRANSFER_ALREADY_PROCESSED');
      await db.run('UPDATE user_inventory SET status = "pending" WHERE id = ?', transfer.itemId);
      await db.run('COMMIT');
    } catch (err: any) {
      try { await db.run('ROLLBACK'); } catch {}
      if (err.message === 'TRANSFER_ALREADY_PROCESSED') return res.status(409).json({ message: '转让已被处理' });
      console.error('拒绝转让失败:', err);
      return res.status(500).json({ message: '操作失败，请重试' });
    }

    res.json({ message: '已拒绝转让，物品已退回对方背包' });
  });

  // ==================== 积分智能定价公式 ====================
  app.get('/api/parent/privilege-pricing/:childId', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const childId = req.params.childId;
    
    // 验证孩子在同一家庭
    const child = await db.get('SELECT id, name FROM users WHERE id = ? AND familyId = ? AND role = "child"', childId, request.user!.familyId);
    if (!child) return res.status(404).json({ message: '孩子不存在' });
    
    const pricing = await calculateSmartPricing(db, childId);
    res.json({ childId, childName: child.name, ...pricing });
  });

  // --- 惩罚提醒相关 ---
  app.get('/api/child/punishments/unread', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    const rows = await db.all(`
      SELECT pr.*, u.name as parentName, t.title as taskTitle
      FROM punishment_records pr
      JOIN users u ON pr.parentId = u.id
      JOIN tasks t ON pr.taskId = t.id
      WHERE pr.childId = ? AND pr.isRead = 0
      ORDER BY pr.createdAt DESC
    `, request.user!.id);
    res.json(rows);
  });

  app.post('/api/child/punishments/:id/read', protect, async (req: any, res) => {
    const request = req as AuthRequest;
    const db = getDb();
    await db.run('UPDATE punishment_records SET isRead = 1 WHERE id = ? AND childId = ?', req.params.id, request.user!.id);
    res.json({ message: '已阅' });
  });

  app.get('/api/parent/punishment-tips', protect, async (req: any, res) => {
    res.json(PUNISHMENT_TIPS);
  });
}


// ==================== 积分智能定价公式 ====================
export interface SmartPricingResult {
  basePrice: number;
  suggestedPrice: number;
  discountFactor: number;
  factors: {
    completionRate: number;
    recentPunishmentRate: number;
    weeklyCoinEarned: number;
    avgTaskCoins: number;
  };
  message: string;
}

export const calculateSmartPricing = async (db: any, childId: string): Promise<SmartPricingResult> => {
  const row = await db.get(
    `SELECT f.ecoGamePrivilegePoints AS points
       FROM users u JOIN families f ON u.familyId = f.id
      WHERE u.id = ?`,
    childId
  );
  const stablePrice = Math.max(1, Math.min(10, Math.round(Number(row?.points || 2))));
  return {
    basePrice: stablePrice,
    suggestedPrice: stablePrice,
    discountFactor: 1,
    factors: {
      completionRate: 0,
      recentPunishmentRate: 0,
      weeklyCoinEarned: 0,
      avgTaskCoins: 0
    },
    message: '按家庭固定成长权益锚点定价，不根据孩子表现涨价或降价。'
  };
};

// ==================== 抽奖系统优化（Version 2）====================

// 初始化抽奖统计表
export const initLotteryTables = async () => {
  const db = getDb();
  await db.run(`
    CREATE TABLE IF NOT EXISTS lottery_stats (
      childId TEXT PRIMARY KEY,
      totalDraws INTEGER DEFAULT 0,
      rareStreak INTEGER DEFAULT 0,
      epicStreak INTEGER DEFAULT 0,
      legendaryStreak INTEGER DEFAULT 0,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  logger.info('✅ lottery_stats 表已初始化');
};

// 新的费用曲线（更平滑）
const LOTTERY_COSTS = [5, 8, 12, 18, 25, 35, 48, 65, 85, 108];
export const getLotteryCostV2 = (drawCount: number): number => {
  if (drawCount < LOTTERY_COSTS.length) return LOTTERY_COSTS[drawCount];
  return LOTTERY_COSTS[LOTTERY_COSTS.length - 1] + (drawCount - LOTTERY_COSTS.length + 1) * 25;
};

// 稀有度等级排序（用于保底判断）
const RARITY_RANK: Record<string, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5
};

const LOTTERY_RARITY_WEIGHT_FACTOR: Record<string, number> = {
  common: 1,
  uncommon: 0.55,
  rare: 0.18,
  epic: 0.06,
  legendary: 0.02
};

const LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT = 2;

const getRarityRank = (rarity?: string | null) => RARITY_RANK[rarity || 'common'] || 1;
const isEpicOrAbove = (rarity?: string | null) => getRarityRank(rarity) >= RARITY_RANK.epic;

const getLotteryEffectiveWeight = (prize: any) => {
  const rawWeight = Math.max(1, Number(prize.weight || 10) || 10);
  const factor = LOTTERY_RARITY_WEIGHT_FACTOR[prize.rarity || 'common'] || 1;
  return Math.max(1, Math.round(rawWeight * factor));
};

const getMonthlyEpicOrAboveCount = async (db: any, childId: string) => {
  const row = await db.get(
    `SELECT COUNT(*) as count
     FROM user_inventory ui
     JOIN wishes w ON ui.wishId = w.id
     WHERE ui.childId = ?
       AND ui.source IN ('lottery', 'free_draw')
       AND CASE COALESCE(w.rarity, 'common')
         WHEN 'legendary' THEN 5
         WHEN 'epic' THEN 4
         WHEN 'rare' THEN 3
         WHEN 'uncommon' THEN 2
         ELSE 1
       END >= 4
       AND date(ui.acquiredAt, '+8 hours') >= date('now', '+8 hours', 'start of month')
       AND date(ui.acquiredAt, '+8 hours') < date('now', '+8 hours', 'start of month', '+1 month')`,
    childId
  );
  return Number(row?.count || 0);
};

const LOTTERY_POOL_RECOMMENDATION = {
  activePrizeCount: 8,
  counts: {
    common: 3,
    uncommon: 2,
    rare: 2,
    epic: 1,
    legendary: 0
  },
  note: '建议上架8个奖品：普通3、优秀2、稀有2、史诗1；传说只在特殊阶段替换史诗位。史诗/传说不设固定次数保底，合计每月最多2次。'
};

const createEmptyLotteryOdds = (monthlyEpicOrAboveCount: number) => ({
  activePrizeCount: 0,
  rarityCounts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
  epicOrAboveProbabilityPercent: 0,
  expectedDrawsForOneEpicOrAbove: null as number | null,
  expectedDrawsToMonthlyEpicOrAboveLimit: null as number | null,
  remainingEpicOrAboveThisMonth: Math.max(0, LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT - monthlyEpicOrAboveCount),
  monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT,
  recommendation: LOTTERY_POOL_RECOMMENDATION
});

const getLotteryOddsInfo = async (db: any, familyId: string | undefined, monthlyEpicOrAboveCount: number) => {
  if (!familyId) return createEmptyLotteryOdds(monthlyEpicOrAboveCount);

  const prizes = await db.all(
    "SELECT rarity, weight FROM wishes WHERE familyId = ? AND type = 'lottery' AND isActive = 1 AND (stock IS NULL OR stock = -1 OR stock > 0)",
    familyId
  );
  if (!prizes.length) return createEmptyLotteryOdds(monthlyEpicOrAboveCount);

  const rarityCounts = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
  let totalWeight = 0;
  let epicOrAboveWeight = 0;

  prizes.forEach((prize: any) => {
    const rarity = (prize.rarity || 'common') as keyof typeof rarityCounts;
    const normalizedRarity = rarityCounts[rarity] === undefined ? 'common' : rarity;
    const effectiveWeight = getLotteryEffectiveWeight(prize);
    rarityCounts[normalizedRarity] += 1;
    totalWeight += effectiveWeight;
    if (isEpicOrAbove(normalizedRarity)) {
      epicOrAboveWeight += effectiveWeight;
    }
  });

  const probability = totalWeight > 0 ? epicOrAboveWeight / totalWeight : 0;
  const remainingEpicOrAboveThisMonth = Math.max(0, LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT - monthlyEpicOrAboveCount);

  return {
    activePrizeCount: prizes.length,
    rarityCounts,
    epicOrAboveProbabilityPercent: Math.round(probability * 1000) / 10,
    expectedDrawsForOneEpicOrAbove: probability > 0 ? Math.ceil(1 / probability) : null,
    expectedDrawsToMonthlyEpicOrAboveLimit: probability > 0 && remainingEpicOrAboveThisMonth > 0
      ? Math.ceil(remainingEpicOrAboveThisMonth / probability)
      : null,
    remainingEpicOrAboveThisMonth,
    monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT,
    recommendation: LOTTERY_POOL_RECOMMENDATION
  };
};

// 抽奖核心逻辑 V2（稀有保底 + 月度大奖上限）
export interface DrawResultV2 {
  prize: any;
  newInventoryId: string | null;
  isDrawAgain: boolean;
  isBonusCoins: boolean;
  bonusCoins: number;
  isBonusXp: boolean;
  bonusXp: number;
  isBonusPrivilegePoints: boolean;
  bonusPrivilegePoints: number;
  isFreeSpin: boolean;
  isDoubleNext: boolean;
  pityTriggered: {
    rare: boolean;
    epic: boolean;
    legendary: boolean;
  };
  monthlyEpicOrAboveCount: number;
  monthlyEpicOrAboveLimit: number;
}

export const drawPrizeCoreV2 = async (
  db: any,
  familyId: string,
  childId: string,
  cost: number,
  source: 'lottery' | 'free_draw'
): Promise<DrawResultV2> => {
  // 获取或初始化抽奖统计
  let stats = await db.get('SELECT * FROM lottery_stats WHERE childId = ?', childId);
  if (!stats) {
    await db.run('INSERT INTO lottery_stats (childId, totalDraws, rareStreak, epicStreak, legendaryStreak) VALUES (?, 0, 0, 0, 0)', childId);
    stats = { totalDraws: 0, rareStreak: 0, epicStreak: 0, legendaryStreak: 0 };
  }

  // 获取可抽取的奖品
  let prizes = await db.all(
    "SELECT * FROM wishes WHERE familyId = ? AND type = 'lottery' AND isActive = 1 AND (stock IS NULL OR stock = -1 OR stock > 0)",
    familyId
  );
  if (prizes.length === 0) {
    throw new Error('奖池为空或奖品已抽完');
  }

  const monthlyEpicOrAboveCount = await getMonthlyEpicOrAboveCount(db, childId);
  const canDrawEpicOrAbove = monthlyEpicOrAboveCount < LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT;
  if (!canDrawEpicOrAbove) {
    const lowerTierPrizes = prizes.filter((p: any) => !isEpicOrAbove(p.rarity));
    if (lowerTierPrizes.length === 0) {
      throw new Error('本月史诗及以上奖励已达上限，请家长上架稀有及以下奖品');
    }
    prizes = lowerTierPrizes;
  }

  // 保底检查：只保留稀有保底。史诗/传说按奖池概率出现，并受月度上限约束。
  let pityTriggered = { rare: false, epic: false, legendary: false };
  let forcedRarity: string | null = null;

  if (stats.rareStreak >= 9) {
    forcedRarity = 'rare';
    pityTriggered.rare = true;
  }

  // 如果触发稀有保底，过滤出稀有度及以上的奖品；若月度大奖已达上限，则自动排除史诗/传说。
  if (forcedRarity) {
    const minRank = RARITY_RANK[forcedRarity] || 1;
    const eligiblePrizes = prizes.filter((p: any) => getRarityRank(p.rarity) >= minRank && (canDrawEpicOrAbove || !isEpicOrAbove(p.rarity)));
    if (eligiblePrizes.length > 0) {
      prizes = eligiblePrizes;
    }
  }

  // 加权随机算法
  const totalWeight = prizes.reduce((sum: number, p: any) => sum + getLotteryEffectiveWeight(p), 0);
  let random = Math.random() * totalWeight;
  let prize = prizes[0];
  for (const p of prizes) {
    random -= getLotteryEffectiveWeight(p);
    if (random <= 0) { prize = p; break; }
  }

  const prizeRarity = prize.rarity || 'common';
  const prizeRank = getRarityRank(prizeRarity);

  // 更新保底计数
  const newRareStreak = prizeRank >= 3 ? 0 : stats.rareStreak + 1;
  const newEpicStreak = prizeRank >= 4 ? 0 : stats.epicStreak + 1;
  const newLegendaryStreak = prizeRank >= 5 ? 0 : stats.legendaryStreak + 1;

  await db.run(
    'UPDATE lottery_stats SET totalDraws = totalDraws + 1, rareStreak = ?, epicStreak = ?, legendaryStreak = ?, updatedAt = CURRENT_TIMESTAMP WHERE childId = ?',
    newRareStreak, newEpicStreak, newLegendaryStreak, childId
  );

  // 扣减库存
  if (prize.stock !== null && prize.stock !== -1 && prize.stock > 0) {
    await db.run('UPDATE wishes SET stock = stock - 1 WHERE id = ?', prize.id);
  }

  const newInventoryId = randomUUID();
  prize = normalizeLotteryOutcome(prize);
  const effectType = prize.effectType;
  const normalizedPrize = prize;

  // 处理特殊效果
  // draw_again: 再抽一次
  // bonus_coins: 直接获得金币
  // bonus_xp: 直接获得等级经验，不计入特权进度
  // bonus_privilege: 直接获得特权点
  // free_spin: 免费抽奖券（抽奖时自动消费，见 /child/lottery/play）
  // double_next: 下次双倍（抽中数值型奖励时自动消费并翻倍，见下方各 bonus 分支）

  const consumeDoubleNextItem = async (): Promise<boolean> => {
    const item = await db.get(
      `SELECT ui.id FROM user_inventory ui JOIN wishes w ON ui.wishId = w.id
       WHERE ui.childId = ? AND ui.status = 'pending' AND w.effectType = 'double_next'
       ORDER BY ui.acquiredAt ASC LIMIT 1`, childId);
    if (!item) return false;
    const upd = await db.run("UPDATE user_inventory SET status = 'redeemed', redeemedAt = ? WHERE id = ? AND status = 'pending'",
      new Date().toISOString(), item.id);
    return (upd.changes || 0) === 1;
  };

  if (effectType === 'draw_again') {
    await db.run(
      `INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status, redeemedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'coins', ?, 'used', ?)`,
      newInventoryId, childId, prize.id, normalizedPrize.title, prize.icon, cost, source, new Date().toISOString()
    );
    return { prize: normalizedPrize, newInventoryId, isDrawAgain: true, isBonusCoins: false, bonusCoins: 0, isBonusXp: false, bonusXp: 0, isBonusPrivilegePoints: false, bonusPrivilegePoints: 0, isFreeSpin: false, isDoubleNext: false, pityTriggered, monthlyEpicOrAboveCount, monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT };
  }

  if (effectType === 'bonus_coins') {
    let bonusAmount = resolveLotteryRewardAmount(prize);
    if (await consumeDoubleNextItem()) bonusAmount = bonusAmount * 2; // 双倍卡自动兑现
    const awardedPrize = normalizeLotteryPrize({ ...prize, cost: bonusAmount });
    await db.run('UPDATE users SET coins = coins + ? WHERE id = ?', bonusAmount, childId);
    await db.run(
      `INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status, redeemedAt, rewardCoins)
       VALUES (?, ?, ?, ?, ?, ?, 'coins', ?, 'used', ?, ?)`,
      newInventoryId, childId, prize.id, awardedPrize.title, prize.icon, cost, source, new Date().toISOString(), bonusAmount
    );
    return { prize: awardedPrize, newInventoryId, isDrawAgain: false, isBonusCoins: true, bonusCoins: bonusAmount, isBonusXp: false, bonusXp: 0, isBonusPrivilegePoints: false, bonusPrivilegePoints: 0, isFreeSpin: false, isDoubleNext: false, pityTriggered, monthlyEpicOrAboveCount, monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT };
  }

  if (effectType === 'bonus_xp') {
    let bonusAmount = resolveLotteryRewardAmount(prize);
    if (await consumeDoubleNextItem()) bonusAmount = bonusAmount * 2; // 双倍卡自动兑现
    const awardedPrize = normalizeLotteryPrize({ ...prize, cost: bonusAmount });
    await db.run('UPDATE users SET xp = xp + ? WHERE id = ?', bonusAmount, childId);
    await db.run(
      `INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status, redeemedAt, rewardXp)
       VALUES (?, ?, ?, ?, ?, ?, 'coins', ?, 'used', ?, ?)`,
      newInventoryId, childId, prize.id, awardedPrize.title, prize.icon, cost, source, new Date().toISOString(), bonusAmount
    );
    return { prize: awardedPrize, newInventoryId, isDrawAgain: false, isBonusCoins: false, bonusCoins: 0, isBonusXp: true, bonusXp: bonusAmount, isBonusPrivilegePoints: false, bonusPrivilegePoints: 0, isFreeSpin: false, isDoubleNext: false, pityTriggered, monthlyEpicOrAboveCount, monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT };
  }

  if (effectType === 'bonus_privilege') {
    let bonusAmount = resolveLotteryRewardAmount(prize);
    if (await consumeDoubleNextItem()) bonusAmount = bonusAmount * 2; // 双倍卡自动兑现
    const awardedPrize = normalizeLotteryPrize({ ...prize, cost: bonusAmount });
    await db.run('UPDATE users SET privilegePoints = privilegePoints + ? WHERE id = ?', bonusAmount, childId);
    await db.run(
      `INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status, redeemedAt, rewardPrivilegePoints)
       VALUES (?, ?, ?, ?, ?, ?, 'coins', ?, 'used', ?, ?)`,
      newInventoryId, childId, prize.id, awardedPrize.title, prize.icon, cost, source, new Date().toISOString(), bonusAmount
    );
    return { prize: awardedPrize, newInventoryId, isDrawAgain: false, isBonusCoins: false, bonusCoins: 0, isBonusXp: false, bonusXp: 0, isBonusPrivilegePoints: true, bonusPrivilegePoints: bonusAmount, isFreeSpin: false, isDoubleNext: false, pityTriggered, monthlyEpicOrAboveCount, monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT };
  }

  if (effectType === 'free_spin') {
    await db.run(
      `INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, 'coins', ?, 'pending')`,
      newInventoryId, childId, prize.id, prize.title, prize.icon, cost, source
    );
    return { prize, newInventoryId, isDrawAgain: false, isBonusCoins: false, bonusCoins: 0, isBonusXp: false, bonusXp: 0, isBonusPrivilegePoints: false, bonusPrivilegePoints: 0, isFreeSpin: true, isDoubleNext: false, pityTriggered, monthlyEpicOrAboveCount, monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT };
  }

  if (effectType === 'double_next') {
    await db.run(
      `INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, 'coins', ?, 'pending')`,
      newInventoryId, childId, prize.id, prize.title, prize.icon, cost, source
    );
    return { prize, newInventoryId, isDrawAgain: false, isBonusCoins: false, bonusCoins: 0, isBonusXp: false, bonusXp: 0, isBonusPrivilegePoints: false, bonusPrivilegePoints: 0, isFreeSpin: false, isDoubleNext: true, pityTriggered, monthlyEpicOrAboveCount, monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT };
  }

  // 普通奖品
  await db.run(
    `INSERT INTO user_inventory (id, childId, wishId, title, icon, cost, costType, source, status) VALUES (?, ?, ?, ?, ?, ?, 'coins', ?, 'pending')`,
    newInventoryId, childId, prize.id, prize.title, prize.icon, cost, source
  );

  return { prize, newInventoryId, isDrawAgain: false, isBonusCoins: false, bonusCoins: 0, isBonusXp: false, bonusXp: 0, isBonusPrivilegePoints: false, bonusPrivilegePoints: 0, isFreeSpin: false, isDoubleNext: false, pityTriggered, monthlyEpicOrAboveCount, monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT };
};

// 获取抽奖保底信息
export const getLotteryPityInfo = async (db: any, childId: string, familyId?: string) => {
  const stats = await db.get('SELECT * FROM lottery_stats WHERE childId = ?', childId);
  const monthlyEpicOrAboveCount = await getMonthlyEpicOrAboveCount(db, childId);
  const odds = await getLotteryOddsInfo(db, familyId, monthlyEpicOrAboveCount);
  const monthlyInfo = {
    monthlyEpicOrAboveCount,
    monthlyEpicOrAboveLimit: LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT,
    epicOrAboveAvailable: monthlyEpicOrAboveCount < LOTTERY_EPIC_OR_ABOVE_MONTHLY_LIMIT,
    odds
  };
  if (!stats) {
    return {
      totalDraws: 0,
      rareStreak: 0,
      epicStreak: 0,
      legendaryStreak: 0,
      rarePityProgress: 0,
      epicPityProgress: 0,
      legendaryPityProgress: 0,
      epicPityDisabled: true,
      legendaryPityDisabled: true,
      epicOrAboveRule: '史诗/传说不按固定次数保底，按奖池权重随机出现，并受每月2次上限控制。',
      ...monthlyInfo
    };
  }
  return {
    totalDraws: stats.totalDraws || 0,
    rareStreak: stats.rareStreak || 0,
    epicStreak: stats.epicStreak || 0,
    legendaryStreak: stats.legendaryStreak || 0,
    rarePityProgress: Math.min(100, Math.round((stats.rareStreak / 10) * 100)),
    epicPityProgress: 0,
    legendaryPityProgress: 0,
    epicPityDisabled: true,
    legendaryPityDisabled: true,
    epicOrAboveRule: '史诗/传说不按固定次数保底，按奖池权重随机出现，并受每月2次上限控制。',
    ...monthlyInfo
  };
};
