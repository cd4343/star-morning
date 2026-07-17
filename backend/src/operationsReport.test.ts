import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectOperationsReport } from './operationsReport';

describe('operations report privacy and invariant checks', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE schema_versions (version TEXT PRIMARY KEY);
      CREATE TABLE task_sessions (id TEXT PRIMARY KEY, status TEXT, startedAt TEXT);
      CREATE TABLE task_entries (id TEXT PRIMARY KEY, status TEXT, submittedAt TEXT, reviewedAt TEXT, submission_key TEXT);
      CREATE TABLE task_reward_settlements (task_entry_id TEXT, coins_awarded INTEGER, game_minutes_awarded INTEGER, created_at TEXT);
      CREATE TABLE chest_records (id TEXT PRIMARY KEY, rewardName TEXT, rewardType TEXT, status TEXT, createdAt TEXT, delivery_key TEXT);
      CREATE TABLE lottery_puzzle_progress (child_id TEXT PRIMARY KEY, pieces INTEGER, tickets_generated INTEGER);
      CREATE TABLE screen_time_ledger (id TEXT PRIMARY KEY, deltaMinutes INTEGER, reason TEXT, source TEXT, createdAt TEXT);
      CREATE TABLE child_wish_requests (id TEXT PRIMARY KEY, child_id TEXT, title TEXT, status TEXT, created_at TEXT);
      CREATE TABLE explore_child_intents (childId TEXT PRIMARY KEY, selectionsJson TEXT, updatedAt TEXT);
      CREATE TABLE explore_feed_items (
        id TEXT PRIMARY KEY, title TEXT, summary TEXT, imageUrl TEXT, latitude REAL, longitude REAL,
        venue TEXT, district TEXT, city TEXT, activityStart TEXT, activityEnd TEXT, signupDeadline TEXT,
        type TEXT, status TEXT, enrichmentStatus TEXT, createdAt TEXT
      );
      INSERT INTO schema_versions VALUES ('phase10');
      INSERT INTO task_sessions VALUES ('session-1', 'completed', '2026-07-16T03:00:00.000Z');
      INSERT INTO task_entries VALUES ('entry-1', 'approved', '2026-07-16T03:05:00.000Z', '2026-07-16T04:00:00.000Z', 'submit-1');
      INSERT INTO task_reward_settlements VALUES ('entry-1', 10, 5, '2026-07-16T04:00:00.000Z');
      INSERT INTO chest_records VALUES ('chest-1', 'PRIVATE CHILD REWARD', 'coins', 'granted', '2026-07-16T03:05:00.000Z', 'task-entry:entry-1');
      INSERT INTO lottery_puzzle_progress VALUES ('private-child-id', 1, 2);
      INSERT INTO screen_time_ledger VALUES ('ledger-1', 5, 'PRIVATE TASK TITLE', 'study_saved_time', '2026-07-16T04:00:00.000Z');
      INSERT INTO child_wish_requests VALUES ('wish-1', 'private-child-id', 'PRIVATE WISH', 'pending', '2026-07-16T04:00:00.000Z');
      INSERT INTO explore_child_intents VALUES ('private-child-id', '["museum"]', '2026-07-16T04:00:00.000Z');
      INSERT INTO explore_feed_items VALUES (
        'feed-1', 'PRIVATE PLACE', 'PRIVATE DESCRIPTION', 'https://example.com/image.jpg', NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, 'poi', 'new', 'ready', '2026-07-16T04:00:00.000Z'
      );
    `);
  });

  afterEach(async () => { await db.close(); });

  it('returns aggregate metrics without leaking identity or free text', async () => {
    const report = await collectOperationsReport(db, 7, new Date('2026-07-17T03:00:00.000Z'));
    const serialized = JSON.stringify(report);

    expect(report.activity.tasks.sessions).toMatchObject({ started: 1, completed: 1 });
    expect(report.activity.tasks.submissions).toMatchObject({ submitted: 1, approved: 1 });
    expect(report.activity.rewards.chests).toMatchObject({ granted: 1, coinRewards: 1 });
    expect(report.checks.incompleteExploreItemsExposed).toBe(1);
    expect(report.database.missingColumns).toEqual([]);
    expect(serialized).not.toContain('private-child-id');
    expect(serialized).not.toContain('PRIVATE');
  });
});
