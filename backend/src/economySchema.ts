import type { Database } from 'sqlite';

const hasColumn = async (db: Database, tableName: string, columnName: string) => {
  const columns = await db.all(`PRAGMA table_info(${tableName})`);
  return columns.some(column => column.name === columnName);
};

const addColumnIfMissing = async (
  db: Database,
  tableName: string,
  columnName: string,
  definition: string,
) => {
  if (await hasColumn(db, tableName, columnName)) return;
  await db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};

export const ensureEconomySchema = async (db: Database) => {
  await db.run('BEGIN');
  try {
    await addColumnIfMissing(db, 'families', 'eco_daily_coin_target', 'INTEGER NOT NULL DEFAULT 30');
    await addColumnIfMissing(db, 'wishes', 'reference_rmb', 'INTEGER');

    await db.exec(`
      CREATE TABLE IF NOT EXISTS economy_change_batches (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        change_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('applied', 'rolled_back')),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        rolled_back_at DATETIME,
        FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS economy_change_items (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        old_value INTEGER NOT NULL,
        new_value INTEGER NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (batch_id) REFERENCES economy_change_batches(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_economy_batches_family_created
        ON economy_change_batches(family_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_economy_items_batch
        ON economy_change_items(batch_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_economy_items_unique_change
        ON economy_change_items(batch_id, entity_type, entity_id, field_name);
    `);

    await db.run('COMMIT');
  } catch (error) {
    try {
      await db.run('ROLLBACK');
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
};
