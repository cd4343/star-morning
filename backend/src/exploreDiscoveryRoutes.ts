import type { Express } from 'express';
import type { Database } from 'sqlite';
import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import { getDb } from './database';
import {
  deduplicateExploreCandidates,
  generateExploreQueries,
  getCandidateRejection,
  parseExploreIntent,
  rankExploreCandidates,
  scoreExploreCandidate,
  type ExploreDiscoveryCandidate,
  type ExplorePlannerRequest,
  type ParsedExploreIntent,
} from './exploreDiscoveryRules';
import {
  cacheTrustedExploreImage,
  mapFeedCategoryToPlaceCategory,
  previewTrustedExploreLink,
} from './exploreFeed';
import { EXPLORE_EXPERIENCE_GROUPS, isExploreFeedItemComplete } from './exploreExperience';

type DiscoveryDependencies = {
  now?: () => Date;
  searchProvider?: (query: string, intent: ParsedExploreIntent, signal: AbortSignal) => Promise<ExploreDiscoveryCandidate[]>;
  cacheImage?: (url: string, familyId: string) => Promise<string>;
  previewLink?: typeof previewTrustedExploreLink;
};

export class ExploreDiscoveryUnavailableError extends Error {
  constructor() { super('source_temporarily_unavailable'); }
}

const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);
const parseJsonArray = (value: unknown): string[] => {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
};
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const numeric = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (/免费|free/i.test(raw)) return 0;
  const match = raw.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

const inferCandidateTags = (...facts: unknown[]) => {
  const haystack = facts.map(value => text(value, 200)).join(' ');
  const experienceKeys = EXPLORE_EXPERIENCE_GROUPS.flatMap(group => group.options)
    .filter(option => option.key !== 'any' && option.keywords.some(keyword => haystack.includes(keyword)))
    .map(option => option.key);
  const objectiveKeys = [
    ...(/科学|实验|手工|手作|陶艺|烘焙|料理|模型|机器人|绘画|设计/.test(haystack) ? ['hands-on' as const] : []),
    ...(/博物馆|科技馆|科学馆|科普|历史|图书馆|美术馆|展览|遗址/.test(haystack) ? ['knowledge' as const] : []),
    ...(/公园|步道|湿地|动物|植物|徒步|骑行|攀岩|游泳|滑冰|球馆/.test(haystack) ? ['energy' as const] : []),
    ...(/亲子|家庭|工作坊/.test(haystack) ? ['family' as const] : []),
  ];
  return { experienceKeys: [...new Set(experienceKeys)], objectiveKeys: [...new Set(objectiveKeys)] };
};

const getMatchedReasonCodes = (item: ExploreDiscoveryCandidate, intent: ParsedExploreIntent) => {
  const reasons: string[] = [];
  if (intent.preferences.experienceKeys.includes('any')
    || intent.preferences.experienceKeys.some(key => item.experienceKeys.includes(key))) reasons.push('experience');
  if (intent.preferences.objective && item.objectiveKeys.includes(intent.preferences.objective)) reasons.push('objective');
  if (intent.hardConditions.districtScope.some(value => text(item.district).includes(value))) reasons.push('district');
  if (intent.hardConditions.budgetMax !== undefined && item.priceAmount !== undefined) reasons.push('budget');
  if (item.type === 'activity' && (intent.hardConditions.dateFrom || intent.hardConditions.dateTo)) reasons.push('date');
  return reasons;
};

const getAdjustmentCodes = (intent: ParsedExploreIntent) => {
  if (intent.hardConditions.budgetMax !== undefined) return ['remove_budget'];
  if (intent.hardConditions.districtScope.length > 0) return ['expand_district'];
  if (intent.hardConditions.indoorPreference !== 'any') return ['remove_indoor'];
  return ['change_experience'];
};

export const getChildAgeForFamily = async (
  database: Database, familyId: string, childId: string, now: Date = new Date()
) => {
  const child = await database.get(
    `SELECT birthdate FROM users WHERE id = ? AND familyId = ? AND role = 'child'`, childId, familyId
  );
  if (!child) throw new Error('child_not_found');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(child.birthdate || ''))) return undefined;
  const [year, month, day] = String(child.birthdate).split('-').map(Number);
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  let age = beijing.getUTCFullYear() - year;
  if (beijing.getUTCMonth() + 1 < month || (beijing.getUTCMonth() + 1 === month && beijing.getUTCDate() < day)) age--;
  return Math.max(0, age);
};

const searchAmapPoi = async (
  query: string, intent: ParsedExploreIntent, signal: AbortSignal
): Promise<ExploreDiscoveryCandidate[]> => {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return [];
  const checkedAt = new Date();
  const response = await axios.get('https://restapi.amap.com/v3/place/text', {
    params: { key, keywords: query, city: intent.hardConditions.city, citylimit: true, offset: 10, page: 1, extensions: 'all' },
    timeout: 8_000,
    signal,
  });
  if (String(response.data?.status) !== '1') throw new Error(text(response.data?.info, 80) || 'amap_failed');
  return (Array.isArray(response.data?.pois) ? response.data.pois : []).map((poi: any) => {
    const [longitude, latitude] = String(poi.location || '').split(',').map(Number);
    const imageSourceUrl = text(poi.photos?.[0]?.url, 500);
    const address = text(Array.isArray(poi.address) ? poi.address.join('') : poi.address, 160);
    const tags = inferCandidateTags(poi.name, poi.type, address);
    return {
      externalId: text(poi.id, 80), sourceKey: 'amap-poi', sourceUrl: 'https://restapi.amap.com/v3/place/text',
      trustTier: 'A' as const, type: 'poi' as const, title: text(poi.name, 80),
      summary: `高德地点信息：${address || text(poi.type, 120)}`,
      imageUrl: imageSourceUrl, imageSourceUrl, category: text(poi.type?.split(';')?.[0], 40) || '其他',
      city: text(poi.cityname, 40) || intent.hardConditions.city, district: text(poi.adname, 40), address,
      latitude: Number.isFinite(latitude) ? latitude : undefined, longitude: Number.isFinite(longitude) ? longitude : undefined,
      priceAmount: numeric(poi.biz_ext?.cost), indoorOutdoor: 'unknown' as const,
      experienceKeys: tags.experienceKeys,
      objectiveKeys: tags.objectiveKeys,
      verifiedAt: checkedAt.toISOString(), freshUntil: addDays(checkedAt, 30).toISOString(),
      authorityFields: ['title', 'address', 'latitude', 'longitude', 'category', 'imageUrl'],
    };
  });
};

const loadFreshLocalCandidates = async (database: Database, familyId: string, now: Date) => {
  const rows = await database.all(`
    SELECT f.*, e.source_key, e.source_url AS evidence_source_url, e.supported_fields_json,
           e.verified_at AS evidence_verified_at, e.fresh_until AS evidence_fresh_until,
           COALESCE(r.trust_tier, 'family') AS trust_tier
      FROM explore_feed_items f
      JOIN explore_feed_item_evidence e ON e.feed_item_id = f.id AND e.evidence_status = 'active'
      LEFT JOIN explore_source_registry r ON r.source_key = e.source_key AND r.is_enabled = 1
     WHERE f.familyId = ? AND f.status = 'pending_review' AND f.enrichmentStatus = 'ready'
       AND e.fresh_until > ?
     ORDER BY f.createdAt DESC LIMIT 20`, familyId, now.toISOString());
  return rows.map((row: any): ExploreDiscoveryCandidate => ({
    id: row.id, externalId: row.amapPoiId || undefined, sourceKey: row.source_key,
    sourceUrl: row.evidence_source_url, trustTier: row.trust_tier, type: row.type === 'poi' ? 'poi' : 'activity',
    title: row.title, summary: row.summary || '', imageUrl: row.imageUrl || '', imageSourceUrl: row.imageSourceUrl || undefined,
    category: row.category || row.feedCategory || '其他', city: row.city || '', district: row.district || undefined,
    address: row.type === 'poi' ? row.venue || undefined : undefined, venue: row.venue || undefined,
    latitude: row.latitude == null ? undefined : Number(row.latitude), longitude: row.longitude == null ? undefined : Number(row.longitude),
    activityStart: row.activityStart || undefined, activityEnd: row.activityEnd || undefined,
    priceAmount: numeric(row.price), ageMin: row.ageMin ?? undefined, ageMax: row.ageMax ?? undefined,
    indoorOutdoor: 'unknown', experienceKeys: parseJsonArray(row.experienceTags), objectiveKeys: [],
    verifiedAt: row.evidence_verified_at, freshUntil: row.evidence_fresh_until,
    authorityFields: parseJsonArray(row.supported_fields_json),
  }));
};

const persistResults = async (
  database: Database, familyId: string, results: ReturnType<typeof rankExploreCandidates>, now: Date
) => {
  await database.exec('BEGIN IMMEDIATE');
  try {
    for (const item of results) {
      const existing = item.id ? await database.get(
        `SELECT id FROM explore_feed_items WHERE id = ? AND familyId = ? AND status = 'pending_review'`, item.id, familyId
      ) : await database.get(
        `SELECT id FROM explore_feed_items WHERE familyId = ? AND status = 'pending_review'
          AND ((amapPoiId IS NOT NULL AND amapPoiId = ?) OR (title = ? AND sourceUrl = ?)) LIMIT 1`,
        familyId, item.externalId || '', item.title, item.sourceUrl
      );
      const id = existing?.id || randomUUID();
      item.id = id;
      if (!existing) {
        await database.run(`INSERT INTO explore_feed_items (
          id, familyId, type, title, summary, imageUrl, category, latitude, longitude, amapPoiId, sourceUrl,
          status, recommendDate, createdAt, venue, district, feedCategory, ageMin, ageMax, activityStart,
          activityEnd, price, officialUrl, recommendReason, verifyStatus, recommendScore, city,
          enrichmentStatus, imageSourceUrl, contentSourceType, experienceTags, verified_at, fresh_until, verification_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?)`,
        id, familyId, item.type === 'poi' ? 'poi' : 'source', item.title, item.summary, item.imageUrl, item.category,
        item.latitude ?? null, item.longitude ?? null, item.externalId || null, item.sourceUrl,
        now.toISOString().slice(0, 10), now.toISOString(), item.address || item.venue || null, item.district || null,
        item.category, item.ageMin ?? null, item.ageMax ?? null, item.activityStart || null, item.activityEnd || null,
        item.priceAmount == null ? null : String(item.priceAmount), item.type === 'activity' ? item.sourceUrl : null,
        item.recommendationRole, '已核验', item.score, item.city, item.imageSourceUrl || item.imageUrl,
        item.sourceKey === 'amap-poi' ? 'amap' : 'official', JSON.stringify(item.experienceKeys),
        item.verifiedAt, item.freshUntil, item.trustTier);
      } else {
        await database.run(`UPDATE explore_feed_items SET
          title = ?, summary = ?, imageUrl = ?, category = ?, latitude = ?, longitude = ?, sourceUrl = ?,
          venue = ?, district = ?, feedCategory = ?, price = ?, recommendReason = ?, verifyStatus = ?,
          recommendScore = ?, city = ?, enrichmentStatus = 'ready', imageSourceUrl = ?, contentSourceType = ?,
          experienceTags = ?, verified_at = ?, fresh_until = ?, verification_level = ?
          WHERE id = ? AND familyId = ? AND status = 'pending_review'`,
        item.title, item.summary, item.imageUrl, item.category, item.latitude ?? null, item.longitude ?? null,
        item.sourceUrl, item.address || item.venue || null, item.district || null, item.category,
        item.priceAmount == null ? null : String(item.priceAmount), item.recommendationRole, '已核验', item.score,
        item.city, item.imageSourceUrl || item.imageUrl, item.sourceKey === 'amap-poi' ? 'amap' : 'official',
        JSON.stringify(item.experienceKeys), item.verifiedAt, item.freshUntil, item.trustTier, id, familyId);
      }
      const evidenceId = randomUUID();
      const contentHash = createHash('sha256').update(JSON.stringify({
        title: item.title, summary: item.summary, imageUrl: item.imageUrl, sourceUrl: item.sourceUrl,
      })).digest('hex');
      await database.run(`INSERT INTO explore_feed_item_evidence (
        id, feed_item_id, source_key, source_url, supported_fields_json, content_hash,
        verified_at, fresh_until, evidence_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(feed_item_id, source_key, source_url) DO UPDATE SET
        supported_fields_json = excluded.supported_fields_json, content_hash = excluded.content_hash,
        verified_at = excluded.verified_at, fresh_until = excluded.fresh_until,
        evidence_status = 'active', updated_at = excluded.updated_at`,
      evidenceId, id, item.sourceKey, item.sourceUrl, JSON.stringify(item.authorityFields), contentHash,
      item.verifiedAt, item.freshUntil, now.toISOString(), now.toISOString());
    }
    await database.exec('COMMIT');
  } catch (error) {
    await database.exec('ROLLBACK');
    throw error;
  }
};

export const searchExploreDiscovery = async (
  database: Database, familyId: string, request: ExplorePlannerRequest, dependencies: DiscoveryDependencies = {}
) => {
  if (!text(request.city, 40)) throw new Error('city_required');
  if (text(request.customText).length > 160) throw new Error('custom_text_too_long');
  if ((request.districtScope?.length || 0) > 5) throw new Error('too_many_districts');
  if ((request.experienceKeys?.length || 0) > 2) throw new Error('too_many_experiences');
  const now = dependencies.now?.() || new Date();
  const intent = parseExploreIntent(request, now);
  const childAge = request.childId ? await getChildAgeForFamily(database, familyId, request.childId, now) : undefined;
  const local = await loadFreshLocalCandidates(database, familyId, now);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const provider = dependencies.searchProvider || searchAmapPoi;
  const settled = await Promise.allSettled(generateExploreQueries(intent).map(query => provider(query, intent, controller.signal)));
  clearTimeout(timeout);
  const providerFailed = settled.some(result => result.status === 'rejected');
  const live = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const link: ExploreDiscoveryCandidate[] = [];
  if (intent.hardConditions.officialUrl) {
    try {
      const preview = await (dependencies.previewLink || previewTrustedExploreLink)(intent.hardConditions.officialUrl);
      const tags = inferCandidateTags(preview.title, preview.summary, preview.venue);
      link.push({
        sourceKey: 'family-link', sourceUrl: preview.sourceUrl, trustTier: 'family', type: preview.activityStart ? 'activity' : 'poi',
        title: preview.title, summary: preview.summary, imageUrl: preview.imageUrl, imageSourceUrl: preview.imageUrl,
        category: '活动', city: preview.city || intent.hardConditions.city, district: preview.district || undefined,
        address: preview.venue || undefined, venue: preview.venue || undefined,
        activityStart: preview.activityStart || undefined, activityEnd: preview.activityEnd || undefined,
        experienceKeys: tags.experienceKeys, objectiveKeys: tags.objectiveKeys,
        verifiedAt: now.toISOString(), freshUntil: addDays(now, preview.activityStart ? 0.25 : 30).toISOString(),
        authorityFields: ['title', 'summary', 'imageUrl', 'activityStart', 'activityEnd', 'venue'], indoorOutdoor: 'unknown',
      });
    } catch { /* An explicit link is optional; reliable provider/local results may still be returned. */ }
  }
  const cacheImage = dependencies.cacheImage || cacheTrustedExploreImage;
  const shortlist = deduplicateExploreCandidates([...local, ...live, ...link])
    .sort((a, b) => scoreExploreCandidate(b, intent, now) - scoreExploreCandidate(a, intent, now)).slice(0, 8);
  const cached = (await Promise.all(shortlist.map(async item => {
    if (item.imageUrl.startsWith('/uploads/explore/')) return item;
    try { return { ...item, imageUrl: await cacheImage(item.imageUrl, familyId) }; } catch { return null; }
  }))).filter((item): item is ExploreDiscoveryCandidate => !!item);
  const reliable = cached.filter(item => !getCandidateRejection(item, intent, now, childAge));
  const results = rankExploreCandidates(reliable, intent, now);
  if (providerFailed && results.length === 0) throw new ExploreDiscoveryUnavailableError();
  await persistResults(database, familyId, results, now);
  const partial = providerFailed && results.length > 0;
  await database.run(`INSERT INTO explore_discovery_runs (
    id, city, experience_keys_json, objective, result_count, partial, failure_code, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, randomUUID(), intent.hardConditions.city,
  JSON.stringify(intent.preferences.experienceKeys), intent.preferences.objective || null, results.length,
  partial ? 1 : 0, providerFailed ? 'provider_failed' : null, now.toISOString());
  return {
    intent,
    results: results.map(item => ({
      ...item,
      trustLabel: item.trustTier,
      matchedReasons: getMatchedReasonCodes(item, intent),
    })),
    adjustments: results.length === 0 ? getAdjustmentCodes(intent) : [],
    partial,
    messageCode: results.length > 0 ? 'reliable_results_found' : 'no_reliable_results',
  };
};

export const addVerifiedExploreResultToPlan = async (
  database: Database, familyId: string, userId: string, sourceFeedId: string, now: Date = new Date()
) => {
  await database.exec('BEGIN IMMEDIATE');
  try {
    const existing = await database.get(
      'SELECT id FROM explore_places WHERE familyId = ? AND sourceFeedId = ? AND deletedAt IS NULL', familyId, sourceFeedId
    );
    if (existing) { await database.exec('COMMIT'); return { id: existing.id, created: false }; }
    const item = await database.get(`
      SELECT f.* FROM explore_feed_items f
      JOIN explore_feed_item_evidence e ON e.feed_item_id = f.id AND e.evidence_status = 'active'
      WHERE f.id = ? AND f.familyId = ? AND f.enrichmentStatus = 'ready' AND e.fresh_until > ? LIMIT 1`,
      sourceFeedId, familyId, now.toISOString());
    if (!item) throw new Error('verified_result_not_found');
    if (!isExploreFeedItemComplete(item)) throw new Error('verified_result_not_found');
    const id = randomUUID();
    await database.run(`INSERT INTO explore_places (
      id, familyId, title, category, city, address, latitude, longitude, source, externalId,
      summary, whyGo, observeTips, questionPrompts, tags, status, createdBy, sourceFeedId, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovery', ?, ?, '', '', '', ?, 'wishlist', ?, ?, ?)`,
    id, familyId, text(item.title, 80), mapFeedCategoryToPlaceCategory(item.category), text(item.city, 40),
    text(item.venue, 160), item.latitude ?? null, item.longitude ?? null, text(item.amapPoiId, 80) || null,
    text(item.summary, 300), text(item.experienceTags, 200), userId, sourceFeedId, now.toISOString());
    await database.exec('COMMIT');
    return { id, created: true };
  } catch (error) {
    await database.exec('ROLLBACK');
    throw error;
  }
};

export const registerExploreDiscoveryRoutes = (app: Express, protect: any, requireParent: any) => {
  app.post('/api/parent/explore/discovery/preview-intent', protect, requireParent, async (req: any, res: any) => {
    try { res.json(parseExploreIntent(req.body || {})); }
    catch (error: any) { res.status(400).json({ message: error?.message || 'invalid_explore_intent' }); }
  });
  app.post('/api/parent/explore/discovery/search', protect, requireParent, async (req: any, res: any) => {
    try { res.json(await searchExploreDiscovery(getDb(), req.user.familyId, req.body || {})); }
    catch (error: any) {
      const unavailable = error instanceof ExploreDiscoveryUnavailableError;
      res.status(unavailable ? 503 : 400).json({ message: error?.message || 'explore_discovery_failed' });
    }
  });
};
