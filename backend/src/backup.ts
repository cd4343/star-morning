import fs from 'fs';
import path from 'path';
import { getDb } from './database';

const DB_PATH = process.env.STARCOIN_DB_PATH
  ? path.resolve(process.env.STARCOIN_DB_PATH)
  : path.resolve(__dirname, '../../stellar.db');

const BACKUP_DIR = process.env.STARCOIN_BACKUP_DIR
  ? path.resolve(process.env.STARCOIN_BACKUP_DIR)
  : path.resolve(__dirname, '../../backups');

const KEEP_DAYS = 7;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function getBackupFileName(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const ts = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');

  return `stellar-${ts}.db`;
}

function quoteSqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function createConsistentBackup(backupPath: string) {
  const db = getDb();

  try {
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }

    await db.exec(`VACUUM INTO ${quoteSqlString(backupPath)}`);
  } catch (err) {
    console.warn('[Backup] VACUUM INTO failed, falling back to checkpoint + file copy.', err);
    await db.exec('PRAGMA wal_checkpoint(FULL)');
    fs.copyFileSync(DB_PATH, backupPath);
  }
}

export async function performBackup(): Promise<string | null> {
  try {
    ensureBackupDir();

    if (!fs.existsSync(DB_PATH)) {
      console.error(`[Backup] Database file does not exist: ${DB_PATH}`);
      return null;
    }

    const backupName = getBackupFileName();
    const backupPath = path.join(BACKUP_DIR, backupName);

    await createConsistentBackup(backupPath);
    cleanupOldBackups();

    console.log(`[Backup] Backup created: ${backupName}`);
    return backupPath;
  } catch (err) {
    console.error('[Backup] Backup failed:', err);
    return null;
  }
}

function cleanupOldBackups() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((file) => file.startsWith('stellar-') && file.endsWith('.db'))
      .map((file) => {
        const filePath = path.join(BACKUP_DIR, file);
        return {
          name: file,
          path: filePath,
          time: fs.statSync(filePath).mtime.getTime(),
        };
      });

    for (const file of files) {
      if (file.time < cutoff) {
        fs.unlinkSync(file.path);
        console.log(`[Backup] Removed old backup: ${file.name}`);
      }
    }
  } catch (err) {
    console.error('[Backup] Cleanup failed:', err);
  }
}

export function startBackupScheduler() {
  void performBackup();

  const now = new Date();
  const next3am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0);
  if (next3am <= now) {
    next3am.setDate(next3am.getDate() + 1);
  }

  const msUntil3am = next3am.getTime() - now.getTime();
  console.log(`[Backup] Next backup time: ${next3am.toLocaleString()}`);

  setTimeout(() => {
    void performBackup();
    setInterval(() => void performBackup(), 24 * 60 * 60 * 1000);
  }, msUntil3am);
}
