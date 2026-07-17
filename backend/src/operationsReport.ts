import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { isExploreFeedItemComplete } from './exploreExperience';

const REQUIRED_TABLES = [
  'schema_versions',
  'task_sessions',
  'task_entries',
  'task_reward_settlements',
  'chest_records',
  'lottery_puzzle_progress',
  'screen_time_ledger',
  'child_wish_requests',
  'explore_child_intents',
  'explore_feed_items',
] as const;

const toInt = (value: unknown) => {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? number : 0;
};

const inWindow = (column: string) => `datetime(${column}) BETWEEN datetime(?) AND datetime(?)`;

const parseArgs = (args: string[]) => {
  const valueAfter = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const databasePath = valueAfter('--db') || process.env.STARCOIN_DB_PATH;
  const days = Number(valueAfter('--days') || 7);
  if (!databasePath) throw new Error('STARCOIN_DB_PATH or --db is required.');
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--days must be an integer from 1 to 30.');
  return { databasePath: path.resolve(databasePath), days };
};

const readLogSummary = (projectRoot: string, startAtMs: number) => {
  const logsDirectory = path.join(projectRoot, 'logs');
  if (!fs.existsSync(logsDirectory)) return { available: false, filesScanned: 0, matchingErrorLines: 0, truncatedFiles: 0 };

  const maxBytes = 1024 * 1024;
  const files = fs.readdirSync(logsDirectory, { withFileTypes: true })
    .filter(item => item.isFile() && item.name.toLowerCase().endsWith('.log'))
    .map(item => ({ file: path.join(logsDirectory, item.name), stat: fs.statSync(path.join(logsDirectory, item.name)) }))
    .filter(item => item.stat.mtimeMs >= startAtMs)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, 20);

  let matchingErrorLines = 0;
  let truncatedFiles = 0;
  for (const item of files) {
    const bytes = Math.min(item.stat.size, maxBytes);
    const buffer = Buffer.alloc(bytes);
    const handle = fs.openSync(item.file, 'r');
    try {
      fs.readSync(handle, buffer, 0, bytes, Math.max(0, item.stat.size - bytes));
    } finally {
      fs.closeSync(handle);
    }
    if (item.stat.size > maxBytes) truncatedFiles += 1;
    matchingErrorLines += buffer.toString('utf8').split(/\r?\n/)
      .filter(line => /(^|\s|\[)(error|fatal|uncaught|unhandled)(\s|:|\]|$)/i.test(line)).length;
  }
  return { available: true, filesScanned: files.length, matchingErrorLines, truncatedFiles };
};

const readBackupSummary = (projectRoot: string) => {
  const directory = path.join(projectRoot, 'backups');
  if (!fs.existsSync(directory)) return { available: false, databaseBackupCount: 0, latestBackupAt: null };
  const backups = fs.readdirSync(directory, { withFileTypes: true })
    .filter(item => item.isFile() && item.name.toLowerCase().endsWith('.db'))
    .map(item => fs.statSync(path.join(directory, item.name)).mtime)
    .sort((a, b) => b.getTime() - a.getTime());
  return {
    available: true,
    databaseBackupCount: backups.length,
    latestBackupAt: backups[0]?.toISOString() || null,
  };
};

export const collectOperationsReport = async (db: Database, days = 7, now = new Date()) => {
  const endAt = now.toISOString();
  const startAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const tableRows = await db.all<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table'");
  const tables = new Set(tableRows.map(row => row.name));
  const missingTables = REQUIRED_TABLES.filter(table => !tables.has(table));
  const has = (table: typeof REQUIRED_TABLES[number]) => tables.has(table);
  const columns = async (table: string) => new Set((await db.all(`PRAGMA table_info(${table})`)).map((row: any) => row.name));

  const integrityRows = await db.all('PRAGMA integrity_check');
  const integrityIssueCount = integrityRows.filter((row: any) => String(row.integrity_check || '').toLowerCase() !== 'ok').length;
  const foreignKeyViolationCount = (await db.all('PRAGMA foreign_key_check')).length;
  const schemaVersionCount = has('schema_versions')
    ? toInt((await db.get('SELECT COUNT(*) AS count FROM schema_versions'))?.count)
    : null;

  const taskSessions = has('task_sessions') ? await db.get(
    `SELECT COUNT(*) AS started,
            COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running,
            COALESCE(SUM(CASE WHEN status IN ('completed', 'auto_completed') THEN 1 ELSE 0 END), 0) AS completed,
            COALESCE(SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END), 0) AS abandoned
       FROM task_sessions WHERE ${inWindow('startedAt')}`,
    startAt, endAt,
  ) : null;

  const taskSubmissions = has('task_entries') ? await db.get(
    `SELECT COUNT(*) AS submitted,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
            COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
            COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
            (SELECT COUNT(*) FROM task_entries WHERE status = 'pending') AS pendingBacklog
       FROM task_entries WHERE ${inWindow('submittedAt')}`,
    startAt, endAt,
  ) : null;

  const taskReviews = has('task_entries') ? await db.get(
    `SELECT COUNT(*) AS reviewed,
            COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
            COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected
       FROM task_entries WHERE reviewedAt IS NOT NULL AND ${inWindow('reviewedAt')}`,
    startAt, endAt,
  ) : null;

  const entryColumns = has('task_entries') ? await columns('task_entries') : new Set<string>();
  const duplicateSubmissionKeys = entryColumns.has('submission_key')
    ? toInt((await db.get(`SELECT COUNT(*) AS count FROM (
        SELECT submission_key FROM task_entries
         WHERE submission_key IS NOT NULL GROUP BY submission_key HAVING COUNT(*) > 1
      )`))?.count)
    : null;

  const settlements = has('task_reward_settlements') ? await db.get(
    `SELECT COUNT(*) AS settled,
            COALESCE(SUM(coins_awarded), 0) AS coinsAwarded,
            COALESCE(SUM(game_minutes_awarded), 0) AS gameMinutesAwarded
       FROM task_reward_settlements WHERE ${inWindow('created_at')}`,
    startAt, endAt,
  ) : null;
  const duplicateSettlements = has('task_reward_settlements')
    ? toInt((await db.get(`SELECT COUNT(*) AS count FROM (
        SELECT task_entry_id FROM task_reward_settlements GROUP BY task_entry_id HAVING COUNT(*) > 1
      )`))?.count)
    : null;
  const approvedWithoutSettlement = has('task_entries') && has('task_reward_settlements')
    ? toInt((await db.get(
      `SELECT COUNT(*) AS count
         FROM task_entries entry
         LEFT JOIN task_reward_settlements settlement ON settlement.task_entry_id = entry.id
        WHERE entry.status = 'approved' AND settlement.task_entry_id IS NULL
          AND ${inWindow('COALESCE(entry.reviewedAt, entry.submittedAt)')}`,
      startAt, endAt,
    ))?.count)
    : null;

  const chests = has('chest_records') ? await db.get(
    `SELECT COUNT(*) AS granted,
            COALESCE(SUM(CASE WHEN rewardType = 'coins' THEN 1 ELSE 0 END), 0) AS coinRewards,
            COALESCE(SUM(CASE WHEN rewardType IN ('lotteryPuzzle', 'lotteryTicket') THEN 1 ELSE 0 END), 0) AS puzzleRewards,
            COALESCE(SUM(CASE WHEN rewardType = 'privilegePoints' THEN 1 ELSE 0 END), 0) AS privilegeRewards
       FROM chest_records WHERE status = 'granted' AND ${inWindow('createdAt')}`,
    startAt, endAt,
  ) : null;
  const chestColumns = has('chest_records') ? await columns('chest_records') : new Set<string>();
  const duplicateChestDeliveryKeys = chestColumns.has('delivery_key')
    ? toInt((await db.get(`SELECT COUNT(*) AS count FROM (
        SELECT delivery_key FROM chest_records
         WHERE delivery_key IS NOT NULL GROUP BY delivery_key HAVING COUNT(*) > 1
      )`))?.count)
    : null;
  const puzzleSnapshot = has('lottery_puzzle_progress') ? await db.get(
    `SELECT COALESCE(SUM(CASE WHEN pieces = 1 THEN 1 ELSE 0 END), 0) AS childrenWithOnePiece,
            COALESCE(SUM(tickets_generated), 0) AS ticketsGenerated
       FROM lottery_puzzle_progress`,
  ) : null;

  const screenTime = has('screen_time_ledger') ? await db.get(
    `SELECT COUNT(*) AS events,
            COALESCE(SUM(deltaMinutes), 0) AS totalDeltaMinutes,
            COALESCE(SUM(CASE WHEN source = 'study_saved_time' THEN deltaMinutes ELSE 0 END), 0) AS studySavedMinutes,
            COALESCE(SUM(CASE WHEN source = 'privilege_redemption' THEN deltaMinutes ELSE 0 END), 0) AS privilegeRedemptionMinutes,
            COALESCE(SUM(CASE WHEN source = 'parent' THEN deltaMinutes ELSE 0 END), 0) AS parentAdjustmentMinutes,
            COALESCE(SUM(CASE WHEN source = 'morning_startup' THEN deltaMinutes ELSE 0 END), 0) AS retiredMorningMinutes
       FROM screen_time_ledger WHERE ${inWindow('createdAt')}`,
    startAt, endAt,
  ) : null;

  const wishes = has('child_wish_requests') ? await db.get(
    `SELECT COUNT(*) AS created,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
            COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
            COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
            COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
            (SELECT COUNT(*) FROM child_wish_requests
              WHERE status IN ('pending', 'approved', 'change_requested')) AS activeBacklog
       FROM child_wish_requests WHERE ${inWindow('created_at')}`,
    startAt, endAt,
  ) : null;
  const childrenWithMultipleActiveWishes = has('child_wish_requests')
    ? toInt((await db.get(`SELECT COUNT(*) AS count FROM (
        SELECT child_id FROM child_wish_requests
         WHERE status IN ('pending', 'approved', 'change_requested')
         GROUP BY child_id HAVING COUNT(*) > 1
      )`))?.count)
    : null;

  const exploreIntentsUpdated = has('explore_child_intents')
    ? toInt((await db.get(`SELECT COUNT(*) AS count FROM explore_child_intents WHERE ${inWindow('updatedAt')}`, startAt, endAt))?.count)
    : null;
  const exploreFeedColumns = has('explore_feed_items') ? await columns('explore_feed_items') : new Set<string>();
  const exploreFeed = !has('explore_feed_items') ? null : exploreFeedColumns.has('enrichmentStatus')
    ? await db.get(
      `SELECT COUNT(*) AS created,
              COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS available,
              COALESCE(SUM(CASE WHEN status = 'wanted' THEN 1 ELSE 0 END), 0) AS wanted,
              COALESCE(SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END), 0) AS pendingReview,
              COALESCE(SUM(CASE WHEN enrichmentStatus = 'waiting' THEN 1 ELSE 0 END), 0) AS waitingEnrichment,
              COALESCE(SUM(CASE WHEN enrichmentStatus = 'failed' THEN 1 ELSE 0 END), 0) AS failedEnrichment,
              (SELECT COUNT(*) FROM explore_feed_items
                WHERE status = 'pending_review' OR enrichmentStatus IN ('waiting', 'failed')) AS parentBacklog
         FROM explore_feed_items WHERE ${inWindow('createdAt')}`,
      startAt, endAt,
    )
    : await db.get(
      `SELECT COUNT(*) AS created,
              COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS available,
              COALESCE(SUM(CASE WHEN status = 'wanted' THEN 1 ELSE 0 END), 0) AS wanted,
              COALESCE(SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END), 0) AS pendingReview,
              NULL AS waitingEnrichment, NULL AS failedEnrichment,
              (SELECT COUNT(*) FROM explore_feed_items WHERE status = 'pending_review') AS parentBacklog
         FROM explore_feed_items WHERE ${inWindow('createdAt')}`,
      startAt, endAt,
    );
  let incompleteExploreItemsExposed: number | null = null;
  if (has('explore_feed_items') && exploreFeedColumns.has('enrichmentStatus')) {
    const candidates = await db.all(
      `SELECT title, summary, imageUrl, latitude, longitude, venue, district, city,
              activityStart, activityEnd, signupDeadline, type
         FROM explore_feed_items
        WHERE status = 'new' AND COALESCE(enrichmentStatus, '') NOT IN ('waiting', 'failed')`,
    );
    incompleteExploreItemsExposed = candidates.filter(item => !isExploreFeedItemComplete(item)).length;
  }

  const checks = {
    duplicateSubmissionKeys,
    duplicateChestDeliveryKeys,
    duplicateSettlements,
    approvedWithoutSettlement,
    childrenWithMultipleActiveWishes,
    incompleteExploreItemsExposed,
  };
  const missingColumns = [
    has('task_entries') && !entryColumns.has('submission_key') ? 'task_entries.submission_key' : null,
    has('chest_records') && !chestColumns.has('delivery_key') ? 'chest_records.delivery_key' : null,
    has('explore_feed_items') && !exploreFeedColumns.has('enrichmentStatus') ? 'explore_feed_items.enrichmentStatus' : null,
  ].filter((value): value is string => value !== null);
  const numericCheckValues = Object.values(checks).filter((value): value is number => typeof value === 'number');
  const status = integrityIssueCount === 0 && foreignKeyViolationCount === 0
    && missingTables.length === 0 && missingColumns.length === 0 && numericCheckValues.every(value => value === 0)
    ? 'ok' : 'attention';

  return {
    reportVersion: 'phase11-operations-v1',
    status,
    generatedAt: endAt,
    window: { kind: 'rolling', days, startAt, endAt, timezone: 'Asia/Shanghai' },
    privacy: {
      mode: 'aggregate-only',
      excluded: ['names', 'phones', 'emails', 'task text', 'wish text', 'notes', 'locations', 'coordinates', 'tokens', 'secrets'],
    },
    database: { integrityOk: integrityIssueCount === 0, integrityIssueCount, foreignKeyViolationCount, schemaVersionCount, missingTables, missingColumns },
    activity: {
      tasks: { sessions: taskSessions, submissions: taskSubmissions, reviews: taskReviews, settlements },
      rewards: { chests, puzzleSnapshot },
      screenTime,
      wishes,
      explore: { intentsUpdated: exploreIntentsUpdated, feed: exploreFeed },
    },
    checks,
    limitations: {
      duplicateAttemptsBlocked: 'not-recorded; duplicate persisted rows are checked instead',
      processUptime: 'not-recorded',
    },
  };
};

const main = async () => {
  const { databasePath, days } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(databasePath)) throw new Error('Database file does not exist.');
  const db = await open({ filename: databasePath, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    await db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;');
    const now = new Date();
    const projectRoot = path.resolve(__dirname, '../..');
    const report = await collectOperationsReport(db, days, now);
    const runtime = {
      databaseFileSizeBytes: fs.statSync(databasePath).size,
      logs: readLogSummary(projectRoot, now.getTime() - days * 24 * 60 * 60 * 1000),
      backups: readBackupSummary(projectRoot),
    };
    process.stdout.write(`${JSON.stringify({ ...report, runtime }, null, 2)}\n`);
  } finally {
    await db.close();
  }
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[ERROR] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
