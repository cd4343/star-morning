import { randomUUID } from 'crypto';
import type { Database } from 'sqlite';
import { normalizeRewardCategory } from './taskRewards';

export interface TaskGameAward {
  gameMinutesAwarded: number;
  reasons?: string[];
  [key: string]: unknown;
}

export interface TaskSettlementResult {
  coinsAwarded: number;
  growthXpAwarded: number;
  rewardXpAwarded: number;
  privilegePointsAwarded: number;
  gameMinutesAwarded: number;
  reasons: string[];
  balanceAfter: { coins: number; privilegePoints: number };
  alreadySettled: boolean;
  xpAwarded: number;
  gameTicketMinutesAwarded: number;
  [key: string]: unknown;
}

interface TaskSettlementEntry {
  id: string;
  childId: string;
  status: string;
  earnedCoins: number;
  earnedXp: number;
  rewardXp: number;
  taskTitle: string;
  coinReward: number;
  xpReward: number;
  expectedDuration: number;
  actualDurationMinutes: number | null;
  category: string;
  taskType: string | null;
  familyId: string;
}

export interface SettleTaskEntryInput {
  entryId: string;
  familyId: string;
  reviewedAt?: string;
  grantGameMinutes?: (entry: TaskSettlementEntry) => Promise<TaskGameAward>;
}

export interface TaskSettlementOutcome {
  childId: string;
  alreadySettled: boolean;
  result: TaskSettlementResult;
}

type TransactionRunner = <T>(fn: () => Promise<T>) => Promise<T>;

export class TaskSettlementError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

export const ensureTaskSettlementSchema = async (db: Database): Promise<void> => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_reward_settlements (
      id TEXT PRIMARY KEY,
      task_entry_id TEXT NOT NULL UNIQUE,
      family_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      coins_awarded INTEGER NOT NULL,
      growth_xp_awarded INTEGER NOT NULL,
      reward_xp_awarded INTEGER NOT NULL,
      privilege_points_awarded INTEGER NOT NULL,
      game_minutes_awarded INTEGER NOT NULL,
      reasons_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      settlement_version TEXT NOT NULL DEFAULT 'p2-e5-v1',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_entry_id) REFERENCES task_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_reward_settlements_family_child
      ON task_reward_settlements(family_id, child_id);
  `);
};

const readEntry = (db: Database, entryId: string) => db.get<TaskSettlementEntry>(`
  SELECT te.id, te.childId, te.status, te.earnedCoins, te.earnedXp, te.rewardXp,
         te.actualDurationMinutes, t.title AS taskTitle, t.coinReward, t.xpReward,
         t.durationMinutes AS expectedDuration, t.category, t.taskType, t.familyId
    FROM task_entries te
    JOIN tasks t ON t.id = te.taskId
   WHERE te.id = ?
`, entryId);

const readStoredResult = async (db: Database, entryId: string): Promise<TaskSettlementResult | null> => {
  const row = await db.get<{ result_json: string }>(
    'SELECT result_json FROM task_reward_settlements WHERE task_entry_id = ?',
    entryId,
  );
  if (!row?.result_json) return null;
  try {
    return { ...(JSON.parse(row.result_json) as TaskSettlementResult), alreadySettled: true };
  } catch {
    throw new TaskSettlementError('任务结算记录损坏，请联系管理员', 500);
  }
};

const defaultTransaction = (db: Database): TransactionRunner => async <T>(fn: () => Promise<T>) => {
  await db.run('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    await db.run('COMMIT');
    return result;
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch { /* transaction already closed */ }
    throw error;
  }
};

export const settleTaskEntry = async (
  db: Database,
  input: SettleTaskEntryInput,
  runInTransaction: TransactionRunner = defaultTransaction(db),
): Promise<TaskSettlementOutcome> => runInTransaction(async () => {
  const entry = await readEntry(db, input.entryId);
  if (!entry) throw new TaskSettlementError('任务不存在', 404);
  if (entry.familyId !== input.familyId) throw new TaskSettlementError('无权操作该任务', 403);

  if (entry.status === 'approved') {
    const stored = await readStoredResult(db, entry.id);
    const user = await db.get<{ coins: number; privilegePoints: number }>(
      'SELECT coins, privilegePoints FROM users WHERE id = ?',
      entry.childId,
    );
    const historical: TaskSettlementResult = stored || {
      coinsAwarded: Number(entry.earnedCoins || 0),
      growthXpAwarded: Number(entry.earnedXp || 0),
      rewardXpAwarded: Number(entry.rewardXp || 0),
      privilegePointsAwarded: 0,
      gameMinutesAwarded: 0,
      reasons: ['这是统一结算上线前的历史记录，无法还原当时的权益与游戏时间明细'],
      balanceAfter: {
        coins: Number(user?.coins || 0),
        privilegePoints: Number(user?.privilegePoints || 0),
      },
      alreadySettled: true,
      xpAwarded: Number(entry.earnedXp || 0),
      gameTicketMinutesAwarded: 0,
    };
    return { childId: entry.childId, alreadySettled: true, result: { ...historical, alreadySettled: true } };
  }
  if (entry.status !== 'pending') throw new TaskSettlementError('该任务已处理，请勿重复审核', 409);

  const familyMultiplier = entry.taskType === 'family';
  const coinsAwarded = Math.max(0, Math.round(Number(entry.coinReward || 0) * (familyMultiplier ? 1.5 : 1)));
  const growthXpAwarded = Math.max(0, Math.round(Number(entry.xpReward || 0) * (familyMultiplier ? 1.3 : 1)));
  const rewardXpAwarded = growthXpAwarded;
  const reviewedAt = input.reviewedAt || new Date().toISOString();

  const update = await db.run(
    `UPDATE task_entries
        SET status = 'approved', reviewedAt = ?, earnedCoins = ?, earnedXp = ?, rewardXp = ?
      WHERE id = ? AND status = 'pending'`,
    reviewedAt, coinsAwarded, growthXpAwarded, rewardXpAwarded, entry.id,
  );
  if ((update.changes || 0) !== 1) throw new TaskSettlementError('该任务已处理，请刷新后重试', 409);

  const before = await db.get<{ rewardXpTotal: number }>(
    'SELECT rewardXpTotal FROM users WHERE id = ?', entry.childId,
  );
  const oldRewardXpTotal = Number(before?.rewardXpTotal || 0);
  const newRewardXpTotal = oldRewardXpTotal + rewardXpAwarded;
  const privilegePointsAwarded = Math.floor(newRewardXpTotal / 100) - Math.floor(oldRewardXpTotal / 100);
  await db.run(
    `UPDATE users
        SET coins = coins + ?, xp = xp + ?, rewardXpTotal = ?, privilegePoints = privilegePoints + ?
      WHERE id = ?`,
    coinsAwarded, growthXpAwarded, newRewardXpTotal, privilegePointsAwarded, entry.childId,
  );

  const category = normalizeRewardCategory(entry.category);
  let gameAward: TaskGameAward = { gameMinutesAwarded: 0, reasons: [] };
  if (category === '学习' && input.grantGameMinutes) {
    gameAward = await input.grantGameMinutes(entry);
  }

  const reasons = [
    `完成“${entry.taskTitle}”，获得${coinsAwarded}金币`,
    `成长经验增加${growthXpAwarded}`,
  ];
  if (familyMultiplier) reasons.push('家庭合作任务已按约定倍率结算');
  if (privilegePointsAwarded > 0) reasons.push(`累计成长进度达到新阶段，获得${privilegePointsAwarded}特权点`);
  if (category !== '学习') reasons.push('只有学习省时任务可在家长确认后获得游戏时间');
  reasons.push(...(gameAward.reasons || []));

  const balance = await db.get<{ coins: number; privilegePoints: number }>(
    'SELECT coins, privilegePoints FROM users WHERE id = ?', entry.childId,
  );
  const gameMinutesAwarded = Math.max(0, Math.round(Number(gameAward.gameMinutesAwarded || 0)));
  const result: TaskSettlementResult = {
    ...gameAward,
    coinsAwarded,
    growthXpAwarded,
    rewardXpAwarded,
    privilegePointsAwarded,
    gameMinutesAwarded,
    reasons,
    balanceAfter: {
      coins: Number(balance?.coins || 0),
      privilegePoints: Number(balance?.privilegePoints || 0),
    },
    alreadySettled: false,
    xpAwarded: growthXpAwarded,
    gameTicketMinutesAwarded: gameMinutesAwarded,
  };

  await db.run(
    `INSERT INTO task_reward_settlements (
       id, task_entry_id, family_id, child_id, coins_awarded, growth_xp_awarded,
       reward_xp_awarded, privilege_points_awarded, game_minutes_awarded,
       reasons_json, result_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), entry.id, entry.familyId, entry.childId, coinsAwarded, growthXpAwarded,
    rewardXpAwarded, privilegePointsAwarded, gameMinutesAwarded,
    JSON.stringify(reasons), JSON.stringify(result),
  );

  return { childId: entry.childId, alreadySettled: false, result };
});

export const syncTaskSettlementCoinAdjustment = async (
  db: Database,
  entryId: string,
  coinsAwarded: number,
  balanceCoinsAfter: number,
): Promise<void> => {
  const row = await db.get<{ result_json: string }>(
    'SELECT result_json FROM task_reward_settlements WHERE task_entry_id = ?', entryId,
  );
  if (!row?.result_json) return;
  const result = JSON.parse(row.result_json) as TaskSettlementResult;
  const adjustmentReason = `家长在审核后将任务金币调整为${coinsAwarded}`;
  const reasons = [...(Array.isArray(result.reasons) ? result.reasons : []), adjustmentReason];
  const next = {
    ...result,
    coinsAwarded,
    reasons,
    balanceAfter: { ...result.balanceAfter, coins: balanceCoinsAfter },
  };
  await db.run(
    `UPDATE task_reward_settlements
        SET coins_awarded = ?, reasons_json = ?, result_json = ?
      WHERE task_entry_id = ?`,
    coinsAwarded, JSON.stringify(reasons), JSON.stringify(next), entryId,
  );
};
