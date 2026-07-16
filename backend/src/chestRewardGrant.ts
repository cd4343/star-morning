import type { Database } from 'sqlite';
import { randomUUID } from 'crypto';
import { drawChestReward, getOrCreateChestSettings, type ChestReward } from './rewardSystem';

export type ChestGrantResult = ChestReward & {
  type: string;
  puzzleProgress: { pieces: number; required: 2 };
  lotteryTicketsCreated: number;
  alreadyGranted: boolean;
};

const hasColumn = async (db: Database, table: string, column: string) => {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  return columns.some((item: any) => item.name === column);
};

export const ensureChestRewardGrantSchema = async (db: Database) => {
  if (!(await hasColumn(db, 'chest_records', 'delivery_key'))) {
    await db.run('ALTER TABLE chest_records ADD COLUMN delivery_key TEXT');
  }
  if (!(await hasColumn(db, 'task_entries', 'submission_key'))) {
    await db.run('ALTER TABLE task_entries ADD COLUMN submission_key TEXT');
  }
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chest_records_delivery_key
      ON chest_records(delivery_key) WHERE delivery_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_entries_submission_key
      ON task_entries(submission_key) WHERE submission_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS lottery_puzzle_progress (
      child_id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      pieces INTEGER NOT NULL DEFAULT 0 CHECK(pieces BETWEEN 0 AND 1),
      tickets_generated INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lottery_puzzle_family
      ON lottery_puzzle_progress(family_id);
  `);

  const migrationVersion = 'phase9b-chest-puzzle-pool';
  const migrated = await db.get('SELECT version FROM schema_versions WHERE version = ?', migrationVersion);
  if (!migrated) {
    await db.exec('BEGIN IMMEDIATE');
    try {
      await db.run("UPDATE reward_pools SET isActive = 0 WHERE type IN ('xp', 'shopDiscount')");
      await db.run("UPDATE reward_pools SET value = 2, weight = 45 WHERE name = '小星币' AND type = 'coins'");
      await db.run("UPDATE reward_pools SET value = 5, weight = 25 WHERE name = '能量金币' AND type = 'coins'");
      await db.run("UPDATE reward_pools SET value = 1, weight = 5 WHERE name IN ('特权点', '权益点') AND type = 'privilegePoints'");
      await db.run(
        `UPDATE reward_pools
            SET name = '幸运拼图', icon = '🧩', description = '集齐2片自动合成1次幸运转盘机会。'
          WHERE type = 'lotteryTicket'`
      );
      const families = await db.all('SELECT DISTINCT familyId FROM reward_pools');
      for (const family of families) {
        const puzzle = await db.get("SELECT id FROM reward_pools WHERE familyId = ? AND type = 'lotteryTicket' LIMIT 1", family.familyId);
        if (!puzzle) {
          await db.run(
            `INSERT INTO reward_pools (id, familyId, name, type, value, weight, rarity, icon, description, isActive)
             VALUES (?, ?, '幸运拼图', 'lotteryTicket', 1, 25, 'uncommon', '🧩', '集齐2片自动合成1次幸运转盘机会。', 1)`,
            randomUUID(), family.familyId
          );
        }
      }
      await db.run(
        'INSERT INTO schema_versions (version, description) VALUES (?, ?)',
        migrationVersion,
        '宝箱停用经验和折扣奖品，并补齐幸运拼图默认奖品'
      );
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  }
};

const getProgress = async (db: Database, childId: string) => {
  const row = await db.get('SELECT pieces FROM lottery_puzzle_progress WHERE child_id = ?', childId);
  return { pieces: Number(row?.pieces || 0), required: 2 as const };
};

const readExistingGrant = async (db: Database, deliveryKey: string, childId: string): Promise<ChestGrantResult | null> => {
  const row = await db.get('SELECT * FROM chest_records WHERE delivery_key = ?', deliveryKey);
  if (!row) return null;
  return {
    id: row.rewardId || row.id,
    name: row.rewardName,
    type: row.rewardType,
    value: Number(row.rewardValue || 0),
    rarity: row.rewardRarity || 'common',
    icon: row.rewardIcon || '🎁',
    puzzleProgress: await getProgress(db, childId),
    lotteryTicketsCreated: 0,
    alreadyGranted: true,
  };
};

export const grantTaskChestReward = async (
  db: Database,
  input: {
    familyId: string;
    childId: string;
    taskEntryId: string;
    difficulty: 'easy' | 'medium' | 'hard';
  }
): Promise<ChestGrantResult | null> => {
  const deliveryKey = `task-entry:${input.taskEntryId}`;
  const existing = await readExistingGrant(db, deliveryKey, input.childId);
  if (existing) return existing;
  const settings = await getOrCreateChestSettings(db, input.familyId);
  if (!settings.isEnabled) return null;

  await db.exec('BEGIN IMMEDIATE');
  try {
    const concurrent = await readExistingGrant(db, deliveryKey, input.childId);
    if (concurrent) {
      await db.exec('COMMIT');
      return concurrent;
    }

    const child = await db.get(
      "SELECT id FROM users WHERE id = ? AND familyId = ? AND role = 'child'",
      input.childId, input.familyId
    );
    if (!child) throw new Error('孩子不存在或不属于当前家庭');

    const reward = await drawChestReward(db, input.familyId, input.difficulty);
    if (!reward) throw new Error('宝箱奖池没有可发放的有效奖品');
    let rewardType = reward.type;
    let lotteryTicketsCreated = 0;

    if (reward.type === 'coins') {
      const update = await db.run('UPDATE users SET coins = coins + ? WHERE id = ? AND familyId = ?', reward.value, input.childId, input.familyId);
      if ((update.changes || 0) !== 1) throw new Error('金币奖励入账失败');
    } else if (reward.type === 'privilegePoints') {
      const update = await db.run('UPDATE users SET privilegePoints = privilegePoints + ? WHERE id = ? AND familyId = ?', reward.value, input.childId, input.familyId);
      if ((update.changes || 0) !== 1) throw new Error('权益点奖励入账失败');
    } else if (reward.type === 'lotteryTicket') {
      rewardType = 'lotteryPuzzle';
      const progress = await getProgress(db, input.childId);
      const totalPieces = progress.pieces + Math.max(1, Math.trunc(Number(reward.value || 1)));
      lotteryTicketsCreated = Math.floor(totalPieces / 2);
      const pieces = totalPieces % 2;
      await db.run(
        `INSERT INTO lottery_puzzle_progress (child_id, family_id, pieces, tickets_generated, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(child_id) DO UPDATE SET
           family_id = excluded.family_id,
           pieces = excluded.pieces,
           tickets_generated = lottery_puzzle_progress.tickets_generated + excluded.tickets_generated,
           updated_at = CURRENT_TIMESTAMP`,
        input.childId, input.familyId, pieces, lotteryTicketsCreated
      );
      for (let index = 0; index < lotteryTicketsCreated; index += 1) {
        await db.run(
          `INSERT INTO user_inventory (id, childId, title, icon, cost, costType, source, status)
           VALUES (?, ?, '幸运拼图合成抽奖券', '🎟️', 1, 'coins', 'lottery_ticket', 'pending')`,
          randomUUID(), input.childId
        );
      }
    } else {
      throw new Error(`宝箱奖品类型不受支持：${reward.type}`);
    }

    await db.run(
      `INSERT INTO chest_records (
         id, childId, familyId, taskEntryId, rewardId, rewardName,
         rewardType, rewardValue, rewardRarity, rewardIcon, status, delivery_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'granted', ?)`,
      randomUUID(), input.childId, input.familyId, input.taskEntryId, reward.id,
      rewardType === 'lotteryPuzzle' ? '幸运拼图' : reward.name,
      rewardType, reward.value, reward.rarity || 'common',
      rewardType === 'lotteryPuzzle' ? '🧩' : reward.icon || '🎁', deliveryKey
    );
    await db.exec('COMMIT');

    return {
      ...reward,
      name: rewardType === 'lotteryPuzzle' ? '幸运拼图' : reward.name,
      type: rewardType,
      icon: rewardType === 'lotteryPuzzle' ? '🧩' : reward.icon,
      puzzleProgress: await getProgress(db, input.childId),
      lotteryTicketsCreated,
      alreadyGranted: false,
    };
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
};

export const getLotteryPuzzleProgress = getProgress;
