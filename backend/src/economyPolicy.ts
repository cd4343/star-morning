export type EconomyPreset = 'fast' | 'standard' | 'longTerm';

export interface EconomySettings {
  coinPerRmb: number;
  dailyCoinTarget: number;
}

export type PriceAlignment = 'underpriced' | 'aligned' | 'overpriced';

export const ECONOMY_PRESETS: Record<EconomyPreset, number> = {
  fast: 5,
  standard: 10,
  longTerm: 20,
};

export const DEFAULT_ECONOMY_SETTINGS: EconomySettings = {
  coinPerRmb: ECONOMY_PRESETS.standard,
  dailyCoinTarget: 30,
};

const normalizeBoundedInt = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

export const normalizeEconomySettings = (input: {
  coinPerRmb?: unknown;
  dailyCoinTarget?: unknown;
}): EconomySettings => ({
  coinPerRmb: normalizeBoundedInt(input.coinPerRmb, 1, 100, DEFAULT_ECONOMY_SETTINGS.coinPerRmb),
  dailyCoinTarget: normalizeBoundedInt(input.dailyCoinTarget, 1, 500, DEFAULT_ECONOMY_SETTINGS.dailyCoinTarget),
});

export const suggestShopCoins = (referenceRmb: number, coinPerRmb: number) => {
  if (!Number.isFinite(referenceRmb) || referenceRmb < 0) {
    throw new Error('referenceRmb must be a non-negative number');
  }
  const normalizedRatio = normalizeBoundedInt(
    coinPerRmb,
    1,
    100,
    DEFAULT_ECONOMY_SETTINGS.coinPerRmb,
  );
  return Math.max(0, Math.round(referenceRmb * normalizedRatio));
};

export const daysToRedeem = (itemCoins: number, dailyCoins: number) => {
  const normalizedCoins = Math.max(0, Math.round(Number(itemCoins) || 0));
  const normalizedDailyCoins = Math.max(1, Math.round(Number(dailyCoins) || 0));
  return Math.max(1, Math.ceil(normalizedCoins / normalizedDailyCoins));
};

export const assessPriceAlignment = (
  actualCoins: number,
  suggestedCoins: number,
  tolerance = 0.2,
): PriceAlignment => {
  const actual = Math.max(0, Math.round(Number(actualCoins) || 0));
  const suggested = Math.max(0, Math.round(Number(suggestedCoins) || 0));
  const safeTolerance = Math.max(0, Math.min(1, Number(tolerance) || 0));

  if (suggested === 0) return actual === 0 ? 'aligned' : 'overpriced';
  if (actual < suggested * (1 - safeTolerance)) return 'underpriced';
  if (actual > suggested * (1 + safeTolerance)) return 'overpriced';
  return 'aligned';
};
