import type { Database } from 'sqlite';

const hasTable = async (db: Database, tableName: string) => Boolean(await db.get(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  tableName,
));

export const ensureGrowthCosmeticSchema = async (db: Database) => {
  await db.run('BEGIN');
  try {
    if (!await hasTable(db, 'users')) throw new Error('Required table users is missing');

    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_cosmetic_unlocks (
        child_id TEXT NOT NULL,
        cosmetic_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_key TEXT,
        unlocked_at TEXT NOT NULL,
        PRIMARY KEY (child_id, cosmetic_key),
        FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_cosmetic_unlocks_child_id
        ON user_cosmetic_unlocks(child_id);

      CREATE TABLE IF NOT EXISTS user_profile_customization (
        child_id TEXT PRIMARY KEY,
        avatar_key TEXT,
        frame_key TEXT,
        theme_key TEXT,
        title_key TEXT,
        featured_achievement_ids TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await db.run('COMMIT');
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch { /* Preserve the migration error. */ }
    throw error;
  }
};
