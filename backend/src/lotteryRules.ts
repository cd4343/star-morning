import type { Database } from 'sqlite';
import { randomUUID } from 'crypto';

export type LotteryAmountEffect = 'bonus_coins' | 'bonus_xp' | 'bonus_privilege';

export const LOTTERY_DAILY_PAID_LIMIT = 2;
export const LOTTERY_MAX_DAILY_PAID_LIMIT = 5;
export const LOTTERY_DEFAULT_DAILY_TICKET_LIMIT = 1;
export const LOTTERY_EMPTY_REWARD_COINS = 5;

export interface LotterySafetySettings {
  enabled: boolean;
  dailyPaidLimit: number;
  dailyTicketLimit: number;
}

export const ensureLotterySafetyTables = async (db: Database): Promise<void> => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS family_lottery_settings (
      family_id TEXT PRIMARY KEY,
      is_enabled INTEGER NOT NULL DEFAULT 1 CHECK(is_enabled IN (0, 1)),
      daily_paid_limit INTEGER NOT NULL DEFAULT 2 CHECK(daily_paid_limit BETWEEN 0 AND 2),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
    );
  `);
  const columns = await db.all('PRAGMA table_info(family_lottery_settings)');
  const columnNames = new Set(columns.map((column: any) => String(column.name)));
  if (!columnNames.has('paid_draw_limit_v2')) {
    await db.exec(`ALTER TABLE family_lottery_settings ADD COLUMN paid_draw_limit_v2 INTEGER DEFAULT ${LOTTERY_DAILY_PAID_LIMIT}`);
  }
  if (!columnNames.has('daily_ticket_limit')) {
    await db.exec(`ALTER TABLE family_lottery_settings ADD COLUMN daily_ticket_limit INTEGER DEFAULT ${LOTTERY_DEFAULT_DAILY_TICKET_LIMIT}`);
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS lottery_ticket_daily_usage (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      inventory_id TEXT NOT NULL,
      used_at TEXT NOT NULL,
      UNIQUE(child_id, usage_date)
    );
    CREATE INDEX IF NOT EXISTS idx_lottery_ticket_usage_family_date
      ON lottery_ticket_daily_usage(family_id, usage_date);
  `);
};

export const getLotterySafetySettings = async (db: Database, familyId: string): Promise<LotterySafetySettings> => {
  await ensureLotterySafetyTables(db);
  const row = await db.get(
    'SELECT is_enabled, daily_paid_limit, paid_draw_limit_v2, daily_ticket_limit FROM family_lottery_settings WHERE family_id = ?',
    familyId,
  );
  if (!row) return { enabled: true, dailyPaidLimit: LOTTERY_DAILY_PAID_LIMIT, dailyTicketLimit: LOTTERY_DEFAULT_DAILY_TICKET_LIMIT };
  const enabled = row.is_enabled === 1;
  return {
    enabled,
    dailyPaidLimit: Math.min(LOTTERY_MAX_DAILY_PAID_LIMIT, Math.max(1, Number(row.paid_draw_limit_v2 ?? row.daily_paid_limit) || LOTTERY_DAILY_PAID_LIMIT)),
    dailyTicketLimit: Number(row.daily_ticket_limit) === 0 ? 0 : LOTTERY_DEFAULT_DAILY_TICKET_LIMIT,
  };
};

export const setLotterySafetySettings = async (
  db: Database,
  familyId: string,
  input: Partial<LotterySafetySettings>,
): Promise<LotterySafetySettings> => {
  await ensureLotterySafetyTables(db);
  const current = await getLotterySafetySettings(db, familyId);
  const enabled = input.enabled ?? current.enabled;
  const dailyPaidLimit = input.dailyPaidLimit ?? current.dailyPaidLimit;
  const dailyTicketLimit = input.dailyTicketLimit ?? current.dailyTicketLimit;
  if (!Number.isInteger(dailyPaidLimit) || dailyPaidLimit < 1 || dailyPaidLimit > LOTTERY_MAX_DAILY_PAID_LIMIT) {
    throw new LotteryConfigurationError('每日付费抽奖次数必须是 1 到 5 的整数');
  }
  if (dailyTicketLimit !== 0 && dailyTicketLimit !== 1) {
    throw new LotteryConfigurationError('每日努力券次数只能是 0 或 1');
  }
  await db.run(
    `INSERT INTO family_lottery_settings
       (family_id, is_enabled, daily_paid_limit, paid_draw_limit_v2, daily_ticket_limit, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(family_id) DO UPDATE SET
       is_enabled = excluded.is_enabled,
       paid_draw_limit_v2 = excluded.paid_draw_limit_v2,
       daily_ticket_limit = excluded.daily_ticket_limit,
       updated_at = CURRENT_TIMESTAMP`,
    familyId, enabled ? 1 : 0, LOTTERY_DAILY_PAID_LIMIT, dailyPaidLimit, dailyTicketLimit,
  );
  return { enabled, dailyPaidLimit, dailyTicketLimit };
};

export const setLotteryEnabled = async (db: Database, familyId: string, enabled: boolean): Promise<LotterySafetySettings> => (
  setLotterySafetySettings(db, familyId, { enabled })
);

export const getTodayLotteryTicketUsageCount = async (db: Database, childId: string, usageDate: string): Promise<number> => {
  await ensureLotterySafetyTables(db);
  const row = await db.get(
    'SELECT COUNT(*) AS count FROM lottery_ticket_daily_usage WHERE child_id = ? AND usage_date = ?',
    childId,
    usageDate,
  );
  return Number(row?.count || 0);
};

export const recordLotteryTicketUsage = async (
  db: Database,
  familyId: string,
  childId: string,
  usageDate: string,
  inventoryId: string,
): Promise<void> => {
  await ensureLotterySafetyTables(db);
  await db.run(
    `INSERT INTO lottery_ticket_daily_usage (id, family_id, child_id, usage_date, inventory_id, used_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    randomUUID(), familyId, childId, usageDate, inventoryId, new Date().toISOString(),
  );
};

type LotteryPrizeLike = {
  title?: unknown;
  cost?: unknown;
  effectType?: unknown;
  [key: string]: unknown;
};

const LOTTERY_AMOUNT_UNITS: Record<LotteryAmountEffect, string> = {
  bonus_coins: '金币',
  bonus_xp: '成长',
  bonus_privilege: '权益点',
};

const LOTTERY_LEGACY_AMOUNT_UNITS: Record<LotteryAmountEffect, string[]> = {
  bonus_coins: ['金币'],
  bonus_xp: ['成长', '经验'],
  bonus_privilege: ['权益点', '特权点'],
};

const HIDDEN_LOTTERY_INVENTORY_EFFECTS = new Set([
  'draw_again',
  'bonus_coins',
  'bonus_xp',
  'bonus_privilege',
  'none',
]);

export class LotteryConfigurationError extends Error {
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'LotteryConfigurationError';
  }
}

export class LotteryLimitError extends Error {
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'LotteryLimitError';
  }
}

export const assertPaidLotteryDrawAllowed = (
  todayPaidDrawCount: number,
  settings: LotterySafetySettings,
): void => {
  if (!settings.enabled) throw new LotteryLimitError('家长已关闭抽奖');
  if (!Number.isInteger(settings.dailyPaidLimit) || settings.dailyPaidLimit < 1 || settings.dailyPaidLimit > LOTTERY_MAX_DAILY_PAID_LIMIT) {
    throw new LotteryConfigurationError('抽奖每日上限配置无效');
  }
  if (todayPaidDrawCount >= settings.dailyPaidLimit) {
    throw new LotteryLimitError(`今天最多付费抽 ${settings.dailyPaidLimit} 次，明天再来吧`);
  }
};

const isAmountEffect = (value: unknown): value is LotteryAmountEffect => (
  value === 'bonus_coins' || value === 'bonus_xp' || value === 'bonus_privilege'
);

const isEmptyLotteryPrize = (prize: LotteryPrizeLike): boolean => (
  prize.effectType === 'none' || String(prize.title || '').includes('谢谢参与')
);

const parseLegacyTitleAmount = (title: unknown, unit: string): number | null => {
  const match = String(title || '').trim().match(new RegExp(`^(\\d+)\\s*${unit}$`));
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
};

export const resolveLotteryRewardAmount = (prize: LotteryPrizeLike): number => {
  if (!isAmountEffect(prize.effectType)) {
    throw new LotteryConfigurationError('该抽奖奖品不是即时数值奖励');
  }

  const configuredAmount = Number(prize.cost);
  if (Number.isSafeInteger(configuredAmount) && configuredAmount > 0) return configuredAmount;

  // 旧版本曾把即时奖励数值保存为 0/null。只兼容这种非正数或空值，
  // 明确填写的小数等非法正数必须失败，避免悄悄改写家长配置。
  const canUseLegacyTitle = prize.cost === null || prize.cost === undefined || prize.cost === ''
    || (Number.isFinite(configuredAmount) && configuredAmount <= 0);
  if (canUseLegacyTitle) {
    for (const unit of LOTTERY_LEGACY_AMOUNT_UNITS[prize.effectType]) {
      const legacyAmount = parseLegacyTitleAmount(prize.title, unit);
      if (legacyAmount !== null) return legacyAmount;
    }
  }

  const title = String(prize.title || '未命名奖品');
  throw new LotteryConfigurationError(`抽奖奖品“${title}”的到账数值必须是正整数，请让家长修正奖品配置`);
};

export const normalizeLotteryPrize = <T extends LotteryPrizeLike>(prize: T): T => {
  if (!isAmountEffect(prize.effectType)) return prize;
  const amount = resolveLotteryRewardAmount(prize);
  return {
    ...prize,
    title: `${amount}${LOTTERY_AMOUNT_UNITS[prize.effectType]}`,
    cost: amount,
  };
};

export const normalizeLotteryOutcome = <T extends LotteryPrizeLike>(prize: T): T => {
  if (!isEmptyLotteryPrize(prize)) return normalizeLotteryPrize(prize);
  return {
    ...prize,
    title: `${LOTTERY_EMPTY_REWARD_COINS}金币`,
    icon: '🪙',
    cost: LOTTERY_EMPTY_REWARD_COINS,
    effectType: 'bonus_coins',
  };
};

export const normalizeLotteryPrizeInput = <T extends LotteryPrizeLike>(input: T): T => {
  if (isEmptyLotteryPrize(input)) {
    throw new LotteryConfigurationError('抽奖不能设置“谢谢参与”或其他空奖，请配置真实奖品');
  }
  if (!isAmountEffect(input.effectType)) return input;
  const amount = Number(input.cost);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new LotteryConfigurationError('即时到账奖品的数值必须是正整数');
  }
  return {
    ...input,
    title: `${amount}${LOTTERY_AMOUNT_UNITS[input.effectType]}`,
    cost: amount,
  };
};

export const isLotteryInventoryVisible = (item: LotteryPrizeLike & { source?: unknown }): boolean => {
  if (item.source !== 'lottery' && item.source !== 'free_draw') return true;
  if (HIDDEN_LOTTERY_INVENTORY_EFFECTS.has(String(item.effectType || ''))) return false;
  return !String(item.title || '').includes('谢谢参与');
};

export const validateLotteryActivationIds = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.length !== 8) {
    throw new LotteryConfigurationError('必须选择恰好8个奖品上架');
  }
  const ids = input.map(id => String(id || '').trim());
  if (ids.some(id => !id) || new Set(ids).size !== 8) {
    throw new LotteryConfigurationError('上架奖品不能重复或为空，必须选择8个不同奖品');
  }
  return ids;
};
