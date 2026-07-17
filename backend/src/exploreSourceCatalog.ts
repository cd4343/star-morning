import type { Database } from 'sqlite';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { collectOperationsReport } from './operationsReport';
import { getBeijingDate, getLocalDateString } from './beijingTime';

export const EXPLORE_SOURCE_CATALOG_VERSION = '2026-07-17.1';

export const TRUSTED_SOURCE_CATALOG = [{
  sourceKey: 'amap-poi',
  label: '高德地点',
  sourceType: 'poi_provider',
  trustTier: 'A',
  baseUrl: 'https://restapi.amap.com',
  cityScope: [],
  categoryScope: [],
  authorityFields: ['title', 'address', 'latitude', 'longitude', 'category', 'imageUrl'],
  refreshMinutes: 43_200,
  enabled: true,
}] as const;

export const ensureExploreSourceSchema = async (database: Database) => {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS explore_source_registry (
      source_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      source_type TEXT NOT NULL,
      trust_tier TEXT NOT NULL CHECK(trust_tier IN ('S', 'A', 'B', 'family')),
      base_url TEXT NOT NULL,
      city_scope_json TEXT NOT NULL DEFAULT '[]',
      category_scope_json TEXT NOT NULL DEFAULT '[]',
      authority_fields_json TEXT NOT NULL DEFAULT '[]',
      refresh_minutes INTEGER NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      health_status TEXT NOT NULL DEFAULT 'unknown' CHECK(health_status IN ('unknown', 'healthy', 'degraded')),
      last_checked_at TEXT,
      last_success_at TEXT,
      catalog_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS explore_feed_item_evidence (
      id TEXT PRIMARY KEY,
      feed_item_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_url TEXT NOT NULL,
      supported_fields_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      fresh_until TEXT NOT NULL,
      evidence_status TEXT NOT NULL DEFAULT 'active' CHECK(evidence_status IN ('active', 'conflict', 'expired', 'rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(feed_item_id, source_key, source_url),
      FOREIGN KEY (feed_item_id) REFERENCES explore_feed_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS explore_discovery_runs (
      id TEXT PRIMARY KEY,
      city TEXT NOT NULL,
      experience_keys_json TEXT NOT NULL DEFAULT '[]',
      objective TEXT,
      result_count INTEGER NOT NULL DEFAULT 0,
      partial INTEGER NOT NULL DEFAULT 0,
      failure_code TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_explore_source_registry_health
      ON explore_source_registry(is_enabled, health_status);
    CREATE INDEX IF NOT EXISTS idx_explore_feed_item_evidence_item
      ON explore_feed_item_evidence(feed_item_id, evidence_status);
    CREATE INDEX IF NOT EXISTS idx_explore_discovery_runs_created
      ON explore_discovery_runs(created_at, result_count);
  `);

  const columns = new Set<string>(
    (await database.all('PRAGMA table_info(explore_feed_items)'))
      .map((column: { name: string }) => column.name)
  );
  for (const [name, definition] of [
    ['verified_at', 'TEXT'],
    ['fresh_until', 'TEXT'],
    ['verification_level', 'TEXT'],
  ] as const) {
    if (!columns.has(name)) await database.run(`ALTER TABLE explore_feed_items ADD COLUMN ${name} ${definition}`);
  }
};

export const syncExploreSourceCatalog = async (database: Database, now: Date = new Date()) => {
  const timestamp = now.toISOString();
  for (const source of TRUSTED_SOURCE_CATALOG) {
    await database.run(
      `INSERT INTO explore_source_registry (
         source_key, label, source_type, trust_tier, base_url, city_scope_json,
         category_scope_json, authority_fields_json, refresh_minutes, is_enabled,
         catalog_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET
         label = excluded.label,
         source_type = excluded.source_type,
         trust_tier = excluded.trust_tier,
         base_url = excluded.base_url,
         city_scope_json = excluded.city_scope_json,
         category_scope_json = excluded.category_scope_json,
         authority_fields_json = excluded.authority_fields_json,
         refresh_minutes = excluded.refresh_minutes,
         is_enabled = excluded.is_enabled,
         catalog_version = excluded.catalog_version,
         updated_at = excluded.updated_at`,
      source.sourceKey,
      source.label,
      source.sourceType,
      source.trustTier,
      source.baseUrl,
      JSON.stringify(source.cityScope),
      JSON.stringify(source.categoryScope),
      JSON.stringify(source.authorityFields),
      source.refreshMinutes,
      source.enabled ? 1 : 0,
      EXPLORE_SOURCE_CATALOG_VERSION,
      timestamp,
      timestamp
    );
  }
};

type ExploreSourceRow = {
  source_key: string;
  base_url: string;
  last_checked_at?: string | null;
};

export type ExploreSourceProbe = (source: ExploreSourceRow) => Promise<boolean>;

const defaultExploreSourceProbe: ExploreSourceProbe = async source => {
  if (source.source_key !== 'amap-poi' || !process.env.AMAP_WEB_SERVICE_KEY) return false;
  const response = await axios.get(`${source.base_url}/v3/place/text`, {
    params: { key: process.env.AMAP_WEB_SERVICE_KEY, keywords: '公园', offset: 1, page: 1, extensions: 'base' },
    timeout: 8_000,
  });
  return String(response.data?.status) === '1';
};

export const runExploreDiscoveryMaintenance = async (
  database: Database, now: Date = new Date(), probe: ExploreSourceProbe = defaultExploreSourceProbe
) => {
  const timestamp = now.toISOString();
  const dueBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sources = await database.all<ExploreSourceRow[]>(`
    SELECT source_key, base_url, last_checked_at
      FROM explore_source_registry
     WHERE is_enabled = 1 AND (last_checked_at IS NULL OR last_checked_at <= ?)
  `, dueBefore);
  let succeeded = 0;
  let failed = 0;
  for (const source of sources) {
    let healthy = false;
    try { healthy = await probe(source); } catch { healthy = false; }
    if (healthy) {
      succeeded++;
      await database.run(`UPDATE explore_source_registry SET
        consecutive_failures = 0, health_status = 'healthy', last_checked_at = ?, last_success_at = ?, updated_at = ?
        WHERE source_key = ?`, timestamp, timestamp, timestamp, source.source_key);
    } else {
      failed++;
      await database.run(`UPDATE explore_source_registry SET
        consecutive_failures = consecutive_failures + 1,
        health_status = CASE WHEN consecutive_failures + 1 >= 3 THEN 'degraded' ELSE health_status END,
        last_checked_at = ?, updated_at = ? WHERE source_key = ?`, timestamp, timestamp, source.source_key);
    }
  }
  const todayStart = new Date(`${getLocalDateString(now)}T00:00:00+08:00`);
  const cutoff = new Date(todayStart.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await database.run('DELETE FROM explore_discovery_runs WHERE created_at < ?', cutoff);
  return { checked: sources.length, succeeded, failed, deletedRuns: deleted.changes || 0 };
};

const getBeijingWeekKey = (now: Date) => {
  const day = getBeijingDate(now).getDay() || 7;
  const todayStart = new Date(`${getLocalDateString(now)}T00:00:00+08:00`);
  return getLocalDateString(new Date(todayStart.getTime() - (day - 1) * 24 * 60 * 60 * 1000));
};

const writeWeeklyCoverageReport = async (database: Database, now: Date) => {
  const logsDirectory = path.resolve(__dirname, '../../logs');
  const reportPath = path.join(logsDirectory, 'explore-source-coverage-latest.json');
  const coverageWeek = getBeijingWeekKey(now);
  try {
    const existing = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    if (existing?.coverageWeek === coverageWeek) return false;
  } catch { /* Missing or invalid prior summary is replaced atomically. */ }
  const report = await collectOperationsReport(database, 7, now);
  await fs.mkdir(logsDirectory, { recursive: true });
  const temporaryPath = `${reportPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify({ coverageWeek, ...report }, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, reportPath);
  return true;
};

export const startExploreDiscoveryMaintenanceScheduler = (getDatabase: () => Database) => {
  const run = async () => {
    try {
      const database = getDatabase();
      await runExploreDiscoveryMaintenance(database);
      await writeWeeklyCoverageReport(database, new Date());
    } catch (error) {
      console.error('[ExploreDiscovery] maintenance failed:', error instanceof Error ? error.message : String(error));
    }
  };
  const initial = setTimeout(() => void run(), 15_000);
  const daily = setInterval(() => void run(), 24 * 60 * 60 * 1000);
  initial.unref?.();
  daily.unref?.();
};
