import { afterEach, describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { ensureExploreSourceSchema, runExploreDiscoveryMaintenance, syncExploreSourceCatalog } from './exploreSourceCatalog';

const databases: Database[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map(database => database.close()));
});

const createDatabase = async () => {
  const database = await open({ filename: ':memory:', driver: sqlite3.Database });
  databases.push(database);
  await database.exec('CREATE TABLE explore_feed_items (id TEXT PRIMARY KEY)');
  return database;
};

describe('trusted Explore source catalog', () => {
  it('creates the append-only schema and syncs active and queued vetted sources idempotently', async () => {
    const database = await createDatabase();

    await ensureExploreSourceSchema(database);
    await ensureExploreSourceSchema(database);
    await syncExploreSourceCatalog(database, new Date('2026-07-17T04:00:00.000Z'));
    await database.run(
      `UPDATE explore_source_registry
          SET health_status = 'degraded', consecutive_failures = 3, last_checked_at = ?
        WHERE source_key = 'amap-poi'`,
      '2026-07-17T04:30:00.000Z'
    );
    await syncExploreSourceCatalog(database, new Date('2026-07-17T05:00:00.000Z'));

    const active = await database.all(
      `SELECT source_key, trust_tier FROM explore_source_registry WHERE is_enabled = 1 ORDER BY source_key`
    );
    expect(active).toEqual([
      { source_key: 'amap-poi', trust_tier: 'A' },
      { source_key: 'national-public-culture-cloud', trust_tier: 'B' },
      { source_key: 'shanghai-library-activities', trust_tier: 'S' },
      { source_key: 'shanghai-museum-events', trust_tier: 'S' },
    ]);
    expect((await database.get('SELECT COUNT(*) AS count FROM explore_source_registry')).count).toBeGreaterThan(10);
    expect(await database.get(
      `SELECT source_key, trust_tier, authority_fields_json, health_status,
              consecutive_failures, last_checked_at FROM explore_source_registry WHERE source_key = 'amap-poi'`
    )).toEqual({
      source_key: 'amap-poi',
      trust_tier: 'A',
      authority_fields_json: '["title","address","latitude","longitude","category","imageUrl"]',
      health_status: 'degraded',
      consecutive_failures: 3,
      last_checked_at: '2026-07-17T04:30:00.000Z',
    });

    const columns = (await database.all('PRAGMA table_info(explore_feed_items)'))
      .map((column: { name: string }) => column.name);
    expect(columns).toEqual(expect.arrayContaining(['verified_at', 'fresh_until', 'verification_level']));
  });

  it('degrades after three due failures, recovers on one success, and removes runs older than 90 Beijing days', async () => {
    const database = await createDatabase();
    await ensureExploreSourceSchema(database);
    await syncExploreSourceCatalog(database, new Date('2026-04-01T04:00:00.000Z'));
    await database.run(`UPDATE explore_source_registry
      SET is_enabled = CASE WHEN source_key = 'amap-poi' THEN 1 ELSE 0 END,
          refresh_minutes = CASE WHEN source_key = 'amap-poi' THEN 1 ELSE refresh_minutes END`);
    await database.run(
      `INSERT INTO explore_discovery_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'old-run', '上海', '[]', null, 0, 0, null, '2026-04-01T00:00:00.000Z'
    );
    for (const timestamp of ['2026-07-14T04:00:00.000Z', '2026-07-15T04:01:00.000Z', '2026-07-16T04:02:00.000Z']) {
      await runExploreDiscoveryMaintenance(database, new Date(timestamp), async () => false);
    }
    expect(await database.get(
      `SELECT health_status, consecutive_failures FROM explore_source_registry WHERE source_key = 'amap-poi'`
    )).toEqual({ health_status: 'degraded', consecutive_failures: 3 });
    expect(await database.get(`SELECT id FROM explore_discovery_runs WHERE id = 'old-run'`)).toBeUndefined();

    await runExploreDiscoveryMaintenance(database, new Date('2026-07-17T04:03:00.000Z'), async () => true);
    expect(await database.get(
      `SELECT health_status, consecutive_failures, last_success_at FROM explore_source_registry WHERE source_key = 'amap-poi'`
    )).toEqual({ health_status: 'healthy', consecutive_failures: 0, last_success_at: '2026-07-17T04:03:00.000Z' });
  });

  it('uses each enabled source refresh interval instead of probing every source daily', async () => {
    const database = await createDatabase();
    await ensureExploreSourceSchema(database);
    await syncExploreSourceCatalog(database, new Date('2026-07-17T00:00:00.000Z'));
    await database.run(`UPDATE explore_source_registry
      SET is_enabled = CASE WHEN source_key = 'shanghai-museum-events' THEN 1 ELSE 0 END,
          last_checked_at = '2026-07-17T01:00:00.000Z'`);
    const checked: string[] = [];

    expect((await runExploreDiscoveryMaintenance(
      database, new Date('2026-07-17T06:59:00.000Z'), async source => { checked.push(source.source_key); return true; }
    )).checked).toBe(0);
    expect((await runExploreDiscoveryMaintenance(
      database, new Date('2026-07-17T07:00:00.000Z'), async source => { checked.push(source.source_key); return true; }
    )).checked).toBe(1);
    expect(checked).toEqual(['shanghai-museum-events']);
  });
});
