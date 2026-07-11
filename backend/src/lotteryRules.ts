export type LotteryAmountEffect = 'bonus_coins' | 'bonus_xp' | 'bonus_privilege';

type LotteryPrizeLike = {
  title?: unknown;
  cost?: unknown;
  effectType?: unknown;
  [key: string]: unknown;
};

const LOTTERY_AMOUNT_UNITS: Record<LotteryAmountEffect, string> = {
  bonus_coins: '金币',
  bonus_xp: '经验',
  bonus_privilege: '特权点',
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

const isAmountEffect = (value: unknown): value is LotteryAmountEffect => (
  value === 'bonus_coins' || value === 'bonus_xp' || value === 'bonus_privilege'
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
    const legacyAmount = parseLegacyTitleAmount(prize.title, LOTTERY_AMOUNT_UNITS[prize.effectType]);
    if (legacyAmount !== null) return legacyAmount;
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

export const normalizeLotteryPrizeInput = <T extends LotteryPrizeLike>(input: T): T => {
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
