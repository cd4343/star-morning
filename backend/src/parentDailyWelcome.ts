import type { Database } from 'sqlite';

export type ParentDailyWelcomeClaim = {
  shouldShow: boolean;
  date: string;
};

export class ParentDailyWelcomeError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ParentDailyWelcomeError';
  }
}

export const ensureParentDailyWelcomeSchema = async (db: Database): Promise<void> => {
  const usersTable = await db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  if (!usersTable) throw new Error('Required table users is missing');

  const columns = await db.all('PRAGMA table_info(users)');
  if (!columns.some((column: any) => column.name === 'parent_welcome_last_shown_date')) {
    await db.run('ALTER TABLE users ADD COLUMN parent_welcome_last_shown_date TEXT');
  }
};

export const claimParentDailyWelcome = async (
  db: Database,
  parentId: string,
  beijingDate: string,
): Promise<ParentDailyWelcomeClaim> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beijingDate)) {
    throw new ParentDailyWelcomeError('Invalid Beijing business date', 400);
  }

  const result = await db.run(
    `UPDATE users
       SET parent_welcome_last_shown_date = ?
     WHERE id = ?
       AND role = 'parent'
       AND COALESCE(parent_welcome_last_shown_date, '') <> ?`,
    beijingDate,
    parentId,
    beijingDate,
  );

  if (result.changes === 1) return { shouldShow: true, date: beijingDate };

  const user = await db.get(
    'SELECT role, parent_welcome_last_shown_date AS lastShownDate FROM users WHERE id = ?',
    parentId,
  );
  if (!user) throw new ParentDailyWelcomeError('Parent account not found', 404);
  if (user.role !== 'parent') {
    throw new ParentDailyWelcomeError('Daily welcome is only available to parent accounts', 403);
  }

  return { shouldShow: false, date: beijingDate };
};
