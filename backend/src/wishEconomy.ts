const MAX_REFERENCE_RMB = 1_000_000;

export const normalizeShopReferenceRmb = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_REFERENCE_RMB) {
    throw new Error(`现实参考价必须是 0-${MAX_REFERENCE_RMB} 的整数`);
  }
  return parsed;
};

export const toParentWish = (wish: Record<string, unknown>) => {
  const { reference_rmb: referenceRmb = null, ...rest } = wish;
  return { ...rest, referenceRmb };
};

export const toChildWish = (wish: Record<string, unknown>) => {
  const { reference_rmb: _referenceRmb, referenceRmb: _camelReferenceRmb, ...rest } = wish;
  return rest;
};
