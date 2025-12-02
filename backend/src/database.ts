import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { randomUUID } from 'crypto';

let db: Database;

export const initializeDatabase = async () => {
  const dbPath = path.resolve(__dirname, '../../stellar.db');
  
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  console.log('📦 Connected to SQLite database');
  await db.run('PRAGMA foreign_keys = ON');
  await createTables();
  
  try { await db.run('ALTER TABLE users ADD COLUMN pin TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN birthdate TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN gender TEXT'); } catch (e) {} // boy, girl, dad, mom, grandpa, grandma
  try { await db.run('ALTER TABLE wishes ADD COLUMN isActive INTEGER DEFAULT 0'); } catch (e) {} // 抽奖奖品是否上架
  try { await db.run('ALTER TABLE wishes ADD COLUMN weight INTEGER DEFAULT 10'); } catch (e) {} // 抽奖权重 (1-100)

  return db;
};

export const getDb = () => {
  if (!db) throw new Error('Database not initialized!');
  return db;
};

const createTables = async () => {
  await db.exec(`CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, email TEXT UNIQUE, password TEXT, name TEXT NOT NULL, 
      role TEXT CHECK(role IN ('parent', 'child')) NOT NULL, avatar TEXT, 
      coins INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, maxXp INTEGER DEFAULT 100, privilegePoints INTEGER DEFAULT 0,
      pin TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, coinReward INTEGER NOT NULL, xpReward INTEGER NOT NULL, durationMinutes INTEGER NOT NULL, category TEXT NOT NULL, frequency TEXT, isEnabled INTEGER DEFAULT 1, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_entries (
      id TEXT PRIMARY KEY, taskId TEXT NOT NULL, childId TEXT NOT NULL, status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'completed')) DEFAULT 'pending', submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP, reviewedAt DATETIME, proof TEXT, actualDurationMinutes INTEGER, earnedCoins INTEGER DEFAULT 0, earnedXp INTEGER DEFAULT 0,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS wishes (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, type TEXT CHECK(type IN ('shop', 'savings', 'lottery')) NOT NULL, title TEXT NOT NULL, cost INTEGER DEFAULT 0, targetAmount INTEGER DEFAULT 0, currentAmount INTEGER DEFAULT 0, icon TEXT, stock INTEGER DEFAULT -1, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS privileges (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, cost INTEGER NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS achievement_defs (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, icon TEXT, conditionType TEXT NOT NULL, conditionValue INTEGER DEFAULT 0, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY, childId TEXT NOT NULL, achievementId TEXT NOT NULL, unlockedAt DATETIME DEFAULT CURRENT_TIMESTAMP, 
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // 新增：用户背包 (Inventory)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      id TEXT PRIMARY KEY, 
      childId TEXT NOT NULL, 
      wishId TEXT, 
      title TEXT NOT NULL, 
      icon TEXT, 
      status TEXT CHECK(status IN ('unused', 'used', 'returned')) DEFAULT 'unused', 
      cost INTEGER DEFAULT 0,
      acquiredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      usedAt DATETIME,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
};
