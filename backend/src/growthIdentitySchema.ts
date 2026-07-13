import type { Database } from 'sqlite';
import { getSystemAchievementsByLegacySignature } from './growthIdentityCatalog';

type LegacyAchievementRow = {
  id: string;
  familyId: string;
  title: string;
  conditionType: string;
  conditionValue: number;
  conditionCategory?: string | null;
};

const hasTable = async (db: Database, tableName: string) => Boolean(await db.get(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  tableName,
));

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

export const ensureGrowthIdentitySchema = async (db: Database) => {
  await db.run('BEGIN');
  try {
    if (!await hasTable(db, 'achievement_defs')) {
      throw new Error('Required table achievement_defs is missing');
    }

    await addColumnIfMissing(db, 'achievement_defs', 'system_key', 'TEXT');
    await addColumnIfMissing(db, 'achievement_defs', 'is_system', 'INTEGER NOT NULL DEFAULT 0');

    const assignedRows = await db.all<{ familyId: string; system_key: string }[]>(
      `SELECT familyId, system_key FROM achievement_defs
       WHERE is_system = 1 AND system_key IS NOT NULL AND TRIM(system_key) != ''`,
    );
    const assignedKeys = new Set(assignedRows.map(row => `${row.familyId}|${row.system_key}`));
    const legacyRows = await db.all<LegacyAchievementRow[]>(
      `SELECT id, familyId, title, conditionType, conditionValue, conditionCategory
       FROM achievement_defs
       WHERE COALESCE(is_system, 0) = 0
         AND (system_key IS NULL OR TRIM(system_key) = '')
       ORDER BY rowid`,
    );

    let classified = 0;
    let conflicts = 0;
    for (const row of legacyRows) {
      const candidates = getSystemAchievementsByLegacySignature({
        conditionType: row.conditionType,
        conditionValue: Number(row.conditionValue || 0),
        conditionCategory: row.conditionCategory || undefined,
      }).filter(candidate => (
        candidate.title === row.title || candidate.legacyTitles.includes(row.title)
      ));
      if (candidates.length !== 1) continue;

      const candidate = candidates[0];
      const assignmentKey = `${row.familyId}|${candidate.systemKey}`;
      if (assignedKeys.has(assignmentKey)) {
        conflicts++;
        continue;
      }

      await db.run(
        `UPDATE achievement_defs SET system_key = ?, is_system = 1
         WHERE id = ? AND COALESCE(is_system, 0) = 0
           AND (system_key IS NULL OR TRIM(system_key) = '')`,
        candidate.systemKey,
        row.id,
      );
      assignedKeys.add(assignmentKey);
      classified++;
    }

    await db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_achievement_defs_family_system_key
      ON achievement_defs(familyId, system_key)
      WHERE is_system = 1 AND system_key IS NOT NULL
    `);
    await db.run('COMMIT');
    return { classified, conflicts };
  } catch (error) {
    try {
      await db.run('ROLLBACK');
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
};
