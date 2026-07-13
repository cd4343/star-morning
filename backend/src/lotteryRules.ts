import type { Database } from 'sqlite';

export type LotteryAmountEffect = 'bonus_coins' | 'bonus_xp' | 'bonus_privilege';

export const LOTTERY_DAILY_PAID_LIMIT = 2;
export const LOTTERY_EMPTY_REWARD_COINS = 5;

export interface LotterySafetySettings {
  enabled: boolean;
  dailyPaidLimit: number;
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
};

export const getLotterySafetySettings = async (db: Database, familyId: string): Promise<LotterySafetySettings> => {
  await ensureLotterySafetyTables(db);
  const row = await db.get(
    'SELECT is_enabled, daily_paid_limit FROM family_lottery_settings WHERE family_id = ?',
    familyId,
  );
  if (!row) return { enabled: true, dailyPaidLimit: LOTTERY_DAILY_PAID_LIMIT };
  const enabled = row.is_enabled === 1;
  return {
    enabled,
    dailyPaidLimit: enabled
      ? Math.min(LOTTERY_DAILY_PAID_LIMIT, Math.max(0, Number(row.daily_paid_limit) || 0))
      : 0,
  };
};

export const setLotteryEnabled = async (db: Database, familyId: string, enabled: boolean): Promise<LotterySafetySettings> => {
  await ensureLotterySafetyTables(db);
  await db.run(
    `INSERT INTO family_lottery_settings (family_id, is_enabled, daily_paid_limit, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(family_id) DO UPDATE SET
       is_enabled = excluded.is_enabled,
       daily_paid_limit = ?,
       updated_at = CURRENT_TIMESTAMP`,
    familyId, enabled ? 1 : 0, LOTTERY_DAILY_PAID_LIMIT, LOTTERY_DAILY_PAID_LIMIT,
  );
  return { enabled, dailyPaidLimit: enabled ? LOTTERY_DAILY_PAID_LIMIT : 0 };
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
  if (!Number.isInteger(settings.dailyPaidLimit) || settings.dailyPaidLimit < 0 || settings.dailyPaidLimit > LOTTERY_DAILY_PAID_LIMIT) {
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
