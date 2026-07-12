import type { Express, NextFunction, Request, Response } from 'express';
import type { Database } from 'sqlite';
import { randomUUID } from 'crypto';
import { getDb } from './database';
import {
  assessPriceAlignment,
  daysToRedeem,
  normalizeEconomySettings,
  suggestShopCoins,
  type EconomyPreset,
} from './economyPolicy';

interface AuthRequest extends Request {
  user?: { id: string; familyId: string; role: 'parent' | 'child' };
}

export class EconomyServiceError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

const LEGACY_LIMITS = {
  ecoTasksPerDay: { min: 1, max: 50, fallback: 10 },
  ecoCoinPerRmb: { min: 1, max: 100, fallback: 10 },
  ecoMidPrizeDays: { min: 1, max: 60, fallback: 10 },
  ecoGamePrivilegePoints: { min: 1, max: 10, fallback: 2 },
} as const;

type LegacySettingKey = keyof typeof LEGACY_LIMITS;

const normalizeStoredInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const parseInputInt = (value: unknown, field: string, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new EconomyServiceError(400, 'invalid_economy_setting', `${field} 必须是 ${min}-${max} 的整数`);
  }
  return parsed;
};

const resolveAliasedInput = (input: Record<string, unknown>, canonical: string, legacy: string) => {
  const canonicalValue = input[canonical];
  const legacyValue = input[legacy];
  if (canonicalValue !== undefined && legacyValue !== undefined && Number(canonicalValue) !== Number(legacyValue)) {
    throw new EconomyServiceError(400, 'conflicting_economy_setting', `${canonical} 与 ${legacy} 不能冲突`);
  }
  return canonicalValue !== undefined ? canonicalValue : legacyValue;
};

const getPreset = (coinPerRmb: number): EconomyPreset | 'custom' => {
  if (coinPerRmb === 5) return 'fast';
  if (coinPerRmb === 10) return 'standard';
  if (coinPerRmb === 20) return 'longTerm';
  return 'custom';
};

export const getEconomySettings = async (db: Database, familyId: string) => {
  const family = await db.get(
    `SELECT ecoTasksPerDay, ecoCoinPerRmb, ecoMidPrizeDays, ecoGamePrivilegePoints,
            eco_daily_coin_target
       FROM families WHERE id = ?`,
    familyId,
  );
  if (!family) throw new EconomyServiceError(404, 'family_not_found', '家庭不存在');

  const legacy = {} as Record<LegacySettingKey, number>;
  for (const key of Object.keys(LEGACY_LIMITS) as LegacySettingKey[]) {
    const limit = LEGACY_LIMITS[key];
    legacy[key] = normalizeStoredInt(family[key], limit.min, limit.max, limit.fallback);
  }
  const canonical = normalizeEconomySettings({
    coinPerRmb: legacy.ecoCoinPerRmb,
    dailyCoinTarget: family.eco_daily_coin_target,
  });

  return {
    ...legacy,
    dailyCoinTarget: canonical.dailyCoinTarget,
    ecoDailyCoinTarget: canonical.dailyCoinTarget,
    settings: {
      preset: getPreset(canonical.coinPerRmb),
      ...canonical,
    },
  };
};

export const updateEconomySettings = async (
  db: Database,
  familyId: string,
  rawInput: Record<string, unknown> = {},
) => {
  const assignments: string[] = [];
  const values: number[] = [];
  const input = rawInput || {};

  const coinPerRmb = resolveAliasedInput(input, 'coinPerRmb', 'ecoCoinPerRmb');
  if (coinPerRmb !== undefined) {
    assignments.push('ecoCoinPerRmb = ?');
    values.push(parseInputInt(coinPerRmb, 'coinPerRmb', 1, 100));
  }
  const dailyTarget = resolveAliasedInput(input, 'dailyCoinTarget', 'ecoDailyCoinTarget');
  if (dailyTarget !== undefined) {
    assignments.push('eco_daily_coin_target = ?');
    values.push(parseInputInt(dailyTarget, 'dailyCoinTarget', 1, 500));
  }

  for (const key of ['ecoTasksPerDay', 'ecoMidPrizeDays', 'ecoGamePrivilegePoints'] as const) {
    if (input[key] === undefined) continue;
    const limit = LEGACY_LIMITS[key];
    assignments.push(`${key} = ?`);
    values.push(parseInputInt(input[key], key, limit.min, limit.max));
  }

  if (assignments.length > 0) {
    const result = await db.run(
      `UPDATE families SET ${assignments.join(', ')} WHERE id = ?`,
      ...values,
      familyId,
    );
    if ((result.changes || 0) !== 1) throw new EconomyServiceError(404, 'family_not_found', '家庭不存在');
  }
  return getEconomySettings(db, familyId);
};

const getProductionSummary = async (db: Database, familyId: string, targetDailyCoins: number) => {
  const row = await db.get(
    `SELECT COALESCE(SUM(te.earnedCoins), 0) AS total
       FROM task_entries te
       JOIN users u ON te.childId = u.id
      WHERE u.familyId = ? AND te.status = 'approved'
        AND date(te.submittedAt, '+8 hours') >= date('now', '+8 hours', '-13 days')`,
    familyId,
  );
  const total = Math.max(0, Math.round(Number(row?.total || 0)));
  return {
    total,
    measuredDailyCoins: Math.round(total / 14),
    targetDailyCoins,
    sampleDays: 14,
  };
};

export const getEconomyAudit = async (db: Database, familyId: string) => {
  const settings = await getEconomySettings(db, familyId);
  const production = await getProductionSummary(db, familyId, settings.settings.dailyCoinTarget);
  const projectionDailyCoins = production.total > 0
    ? Math.max(1, production.measuredDailyCoins)
    : settings.settings.dailyCoinTarget;
  const rows = await db.all(
    `SELECT id, title, cost, reference_rmb
       FROM wishes WHERE familyId = ? AND type = 'shop'
      ORDER BY createdAt ASC, id ASC`,
    familyId,
  );

  const items = rows.map(row => {
    const rawReferenceRmb = row.reference_rmb === null || row.reference_rmb === undefined
      ? null
      : Number(row.reference_rmb);
    const referenceIsValid = rawReferenceRmb !== null
      && Number.isFinite(rawReferenceRmb)
      && rawReferenceRmb >= 0;
    const validReferenceRmb = referenceIsValid ? rawReferenceRmb as number : null;
    const suggestedCoins = validReferenceRmb === null
      ? null
      : suggestShopCoins(validReferenceRmb, settings.settings.coinPerRmb);
    return {
      id: row.id,
      title: row.title,
      currentCoins: Math.max(0, Math.round(Number(row.cost || 0))),
      referenceRmb: rawReferenceRmb,
      suggestedCoins,
      alignment: suggestedCoins === null
        ? rawReferenceRmb === null
          ? 'missing_reference' as const
          : 'invalid_reference' as const
        : assessPriceAlignment(row.cost, suggestedCoins),
      daysToRedeem: daysToRedeem(row.cost, projectionDailyCoins),
    };
  });

  const warnings: Array<{ code: string; count?: number; measured?: number; target?: number }> = [];
  const missingReference = items.filter(item => item.alignment === 'missing_reference').length;
  const invalidReference = items.filter(item => item.alignment === 'invalid_reference').length;
  if (missingReference > 0) warnings.push({ code: 'catalog_missing_reference', count: missingReference });
  if (invalidReference > 0) warnings.push({ code: 'catalog_invalid_reference', count: invalidReference });
  if (production.total === 0) {
    warnings.push({ code: 'production_no_history' });
  } else if (production.measuredDailyCoins > production.targetDailyCoins * 1.5) {
    warnings.push({
      code: 'production_above_target',
      measured: production.measuredDailyCoins,
      target: production.targetDailyCoins,
    });
  }

  const recentBatches = await db.all(
    `SELECT id, change_type AS changeType, status, created_at AS createdAt,
            rolled_back_at AS rolledBackAt
       FROM economy_change_batches
      WHERE family_id = ? ORDER BY created_at DESC LIMIT 5`,
    familyId,
  );

  return {
    settings,
    production: {
      measuredDailyCoins: production.measuredDailyCoins,
      targetDailyCoins: production.targetDailyCoins,
      sampleDays: production.sampleDays,
    },
    catalog: {
      total: items.length,
      aligned: items.filter(item => item.alignment === 'aligned').length,
      underpriced: items.filter(item => item.alignment === 'underpriced').length,
      overpriced: items.filter(item => item.alignment === 'overpriced').length,
      missingReference,
      invalidReference,
      items,
    },
    warnings,
    recentBatches,
  };
};

const normalizeWishIds = (wishIds: unknown) => {
  if (!Array.isArray(wishIds) || wishIds.length === 0 || wishIds.length > 200) {
    throw new EconomyServiceError(400, 'invalid_wish_ids', '请选择1-200个商品');
  }
  const normalized = wishIds.map(id => String(id || '').trim());
  if (normalized.some(id => !id) || new Set(normalized).size !== normalized.length) {
    throw new EconomyServiceError(400, 'invalid_wish_ids', '商品不能重复或为空');
  }
  return normalized;
};

const loadSelectedShopItems = async (db: Database, familyId: string, rawWishIds: unknown) => {
  const wishIds = normalizeWishIds(rawWishIds);
  const placeholders = wishIds.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT id, title, cost, reference_rmb
       FROM wishes
      WHERE familyId = ? AND type = 'shop' AND id IN (${placeholders})`,
    familyId,
    ...wishIds,
  );
  if (rows.length !== wishIds.length) {
    throw new EconomyServiceError(404, 'shop_item_not_found', '部分商品不存在或不属于当前家庭');
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  return wishIds.map(id => byId.get(id));
};

export const previewShopRecalibration = async (db: Database, familyId: string, rawWishIds: unknown) => {
  const settings = await getEconomySettings(db, familyId);
  const production = await getProductionSummary(db, familyId, settings.settings.dailyCoinTarget);
  const projectionDailyCoins = production.total > 0
    ? Math.max(1, production.measuredDailyCoins)
    : settings.settings.dailyCoinTarget;
  const rows = await loadSelectedShopItems(db, familyId, rawWishIds);

  const changes = rows.map(row => {
    if (
      row.reference_rmb === null
      || row.reference_rmb === undefined
      || !Number.isFinite(Number(row.reference_rmb))
      || Number(row.reference_rmb) < 0
    ) {
      throw new EconomyServiceError(400, 'reference_rmb_required', '选中的商品必须先填写现实参考价');
    }
    const oldValue = Math.max(0, Math.round(Number(row.cost || 0)));
    const newValue = suggestShopCoins(Number(row.reference_rmb), settings.settings.coinPerRmb);
    return {
      id: row.id,
      title: row.title,
      referenceRmb: Number(row.reference_rmb),
      oldValue,
      newValue,
      oldDaysToRedeem: daysToRedeem(oldValue, projectionDailyCoins),
      newDaysToRedeem: daysToRedeem(newValue, projectionDailyCoins),
    };
  }).filter(change => change.oldValue !== change.newValue);

  return { settings: settings.settings, changes, unchangedCount: rows.length - changes.length };
};

export const applyShopRecalibration = async (
  db: Database,
  familyId: string,
  actorId: string,
  rawWishIds: unknown,
) => {
  if (!actorId) throw new EconomyServiceError(400, 'actor_required', '缺少操作人');
  const preview = await previewShopRecalibration(db, familyId, rawWishIds);
  if (preview.changes.length === 0) {
    throw new EconomyServiceError(400, 'no_economy_changes', '所选商品无需调整');
  }
  const batchId = randomUUID();

  await db.run('BEGIN');
  try {
    await db.run(
      `INSERT INTO economy_change_batches (id, family_id, actor_id, change_type, status)
       VALUES (?, ?, ?, 'shop', 'applied')`,
      batchId,
      familyId,
      actorId,
    );
    for (const change of preview.changes) {
      const updated = await db.run(
        `UPDATE wishes SET cost = ?
          WHERE id = ? AND familyId = ? AND type = 'shop' AND cost = ?`,
        change.newValue,
        change.id,
        familyId,
        change.oldValue,
      );
      if ((updated.changes || 0) !== 1) {
        throw new EconomyServiceError(409, 'economy_apply_conflict', '商品价格已变化，请重新预览');
      }
      await db.run(
        `INSERT INTO economy_change_items
         (id, batch_id, entity_type, entity_id, field_name, old_value, new_value)
         VALUES (?, ?, 'wish', ?, 'cost', ?, ?)`,
        randomUUID(),
        batchId,
        change.id,
        change.oldValue,
        change.newValue,
      );
    }
    await db.run('COMMIT');
    return { batchId, changes: preview.changes };
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch {}
    throw error;
  }
};

export const rollbackEconomyBatch = async (db: Database, familyId: string, batchId: string) => {
  await db.run('BEGIN');
  try {
    const batch = await db.get(
      `SELECT id, status FROM economy_change_batches
        WHERE id = ? AND family_id = ?`,
      batchId,
      familyId,
    );
    if (!batch) throw new EconomyServiceError(404, 'economy_batch_not_found', '调整批次不存在');
    if (batch.status !== 'applied') {
      throw new EconomyServiceError(409, 'economy_batch_already_rolled_back', '该批次已经回滚');
    }

    const items = await db.all(
      `SELECT entity_type, entity_id, field_name, old_value, new_value
         FROM economy_change_items WHERE batch_id = ? ORDER BY created_at ASC, id ASC`,
      batchId,
    );
    if (items.length === 0) throw new EconomyServiceError(409, 'economy_batch_empty', '调整批次没有可回滚记录');

    for (const item of items) {
      if (item.entity_type !== 'wish' || item.field_name !== 'cost') {
        throw new EconomyServiceError(409, 'unsupported_economy_rollback', '该批次包含当前版本无法回滚的字段');
      }
      const restored = await db.run(
        `UPDATE wishes SET cost = ?
          WHERE id = ? AND familyId = ? AND cost = ?`,
        item.old_value,
        item.entity_id,
        familyId,
        item.new_value,
      );
      if ((restored.changes || 0) !== 1) {
        throw new EconomyServiceError(409, 'economy_rollback_conflict', '商品已被再次修改，整批回滚已取消');
      }
    }

    const marked = await db.run(
      `UPDATE economy_change_batches
          SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP
        WHERE id = ? AND family_id = ? AND status = 'applied'`,
      batchId,
      familyId,
    );
    if ((marked.changes || 0) !== 1) {
      throw new EconomyServiceError(409, 'economy_rollback_conflict', '批次状态已经变化');
    }
    await db.run('COMMIT');
    return { batchId, restoredCount: items.length };
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch {}
    throw error;
  }
};

export const getLegacyPriceSuggestion = async (
  db: Database,
  familyId: string,
  type: string,
  rawDays: unknown,
) => {
  if (type !== 'shop' && type !== 'privilege') {
    throw new EconomyServiceError(400, 'invalid_price_type', 'type 只支持 shop 或 privilege');
  }
  const settings = await getEconomySettings(db, familyId);
  const parsedDays = Math.round(Number(rawDays));
  const days = Number.isFinite(parsedDays) && parsedDays > 0
    ? Math.min(365, parsedDays)
    : settings.ecoMidPrizeDays;
  if (type === 'privilege') {
    return {
      suggestedPoints: Math.max(1, days),
      gameAddonPoints: settings.ecoGamePrivilegePoints,
      days,
      pricingModel: 'stable_family_anchor',
    };
  }
  const production = await getProductionSummary(db, familyId, settings.settings.dailyCoinTarget);
  const estimated = production.total === 0;
  const dailyIncome = estimated ? settings.settings.dailyCoinTarget : Math.max(1, production.measuredDailyCoins);
  const suggestedCoins = Math.max(1, dailyIncome * days);
  return {
    dailyIncome,
    suggestedPrice: suggestedCoins,
    suggestedCoins,
    days,
    estimated,
    pricingModel: 'stable_family_anchor',
  };
};

const asyncRoute = (
  handler: (req: AuthRequest, res: Response) => Promise<unknown>,
) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (error instanceof EconomyServiceError) {
      res.status(error.statusCode).json({ code: error.code, message: error.message });
      return;
    }
    next(error);
  }
};

export const registerEconomyRoutes = (
  app: Express,
  protect: any,
  requireParent: any,
  databaseProvider: () => Database = getDb,
) => {
  app.get('/api/parent/economy-settings', protect, requireParent, asyncRoute(async (req, res) => {
    res.json(await getEconomySettings(databaseProvider(), req.user!.familyId));
  }));
  app.put('/api/parent/economy-settings', protect, requireParent, asyncRoute(async (req, res) => {
    const settings = await updateEconomySettings(databaseProvider(), req.user!.familyId, req.body || {});
    res.json({ message: '经济设置已更新', ...settings });
  }));
  app.get('/api/parent/economy-audit', protect, requireParent, asyncRoute(async (req, res) => {
    res.json(await getEconomyAudit(databaseProvider(), req.user!.familyId));
  }));
  app.post('/api/parent/economy-recalibration-preview', protect, requireParent, asyncRoute(async (req, res) => {
    res.json(await previewShopRecalibration(databaseProvider(), req.user!.familyId, req.body?.wishIds));
  }));
  app.post('/api/parent/economy-recalibration-apply', protect, requireParent, asyncRoute(async (req, res) => {
    res.json(await applyShopRecalibration(databaseProvider(), req.user!.familyId, req.user!.id, req.body?.wishIds));
  }));
  app.post('/api/parent/economy-recalibration/:batchId/rollback', protect, requireParent, asyncRoute(async (req, res) => {
    res.json(await rollbackEconomyBatch(databaseProvider(), req.user!.familyId, req.params.batchId));
  }));
  app.get('/api/parent/price-suggestion', protect, requireParent, asyncRoute(async (req, res) => {
    res.json(await getLegacyPriceSuggestion(
      databaseProvider(),
      req.user!.familyId,
      String(req.query.type || 'shop'),
      req.query.days,
    ));
  }));
};
