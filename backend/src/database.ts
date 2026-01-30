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
  
  // SQLite 优化配置
  await db.run('PRAGMA foreign_keys = ON');           // 启用外键约束
  await db.run('PRAGMA busy_timeout = 30000');        // 增加忙等待超时为30秒（高并发时需要更长时间）
  await db.run('PRAGMA journal_mode = WAL');          // 使用 WAL 模式，提高并发读写性能
  await db.run('PRAGMA synchronous = NORMAL');        // 正常同步模式，平衡性能和安全
  await db.run('PRAGMA cache_size = -64000');         // 64MB 缓存
  await db.run('PRAGMA temp_store = MEMORY');         // 临时表存储在内存中
  await createTables();
  
  try { await db.run('ALTER TABLE users ADD COLUMN pin TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN birthdate TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN gender TEXT'); } catch (e) {} // boy, girl, dad, mom, grandpa, grandma
  try { await db.run('ALTER TABLE wishes ADD COLUMN isActive INTEGER DEFAULT 0'); } catch (e) {} // 抽奖奖品是否上架
  try { await db.run('ALTER TABLE wishes ADD COLUMN weight INTEGER DEFAULT 10'); } catch (e) {} // 抽奖权重 (1-100)
  try { await db.run('ALTER TABLE tasks ADD COLUMN icon TEXT'); } catch (e) {} // 任务图标
  
  // 常用任务字段（旧版兼容）
  try { await db.run('ALTER TABLE tasks ADD COLUMN isRecurring INTEGER DEFAULT 0'); } catch (e) {} // 是否为常用任务模板
  try { await db.run('ALTER TABLE tasks ADD COLUMN recurringSchedule TEXT'); } catch (e) {} // 周期类型: daily/weekday/weekend
  try { await db.run('ALTER TABLE tasks ADD COLUMN recurringTaskTemplateId TEXT'); } catch (e) {} // 实例指向的模板ID
  try { await db.run('ALTER TABLE tasks ADD COLUMN lastGeneratedDate TEXT'); } catch (e) {} // 模板上次生成日期
  
  // 新版任务类型字段
  try { await db.run('ALTER TABLE tasks ADD COLUMN taskType TEXT DEFAULT "daily"'); } catch (e) {} // 任务类型: daily(每日)/once(单次)/custom(自定义)
  try { await db.run('ALTER TABLE tasks ADD COLUMN customDays TEXT'); } catch (e) {} // 自定义周期，JSON数组如[1,3,5]表示周一三五
  try { await db.run('ALTER TABLE tasks ADD COLUMN validDate TEXT'); } catch (e) {} // 单次任务的有效日期（YYYY-MM-DD）

  return db;
};

export const getDb = () => {
  if (!db) throw new Error('Database not initialized!');
  return db;
};

const createTables = async () => {
  await db.exec(`CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  
  // 创建临时家庭记录，用于注册流程
  // 这样注册时 familyId = 'TEMP' 不会触发外键约束错误
  try {
    await db.run(`INSERT OR IGNORE INTO families (id, name) VALUES ('TEMP', '临时家庭')`);
  } catch (e) {
    // 忽略错误，可能已存在
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, email TEXT UNIQUE, password TEXT, name TEXT NOT NULL, 
      role TEXT CHECK(role IN ('parent', 'child')) NOT NULL, avatar TEXT, 
      coins INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, maxXp INTEGER DEFAULT 100, privilegePoints INTEGER DEFAULT 0,
      rewardXpTotal INTEGER DEFAULT 0,
      pin TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 添加累计奖励经验字段（如果不存在）
  try { await db.run('ALTER TABLE users ADD COLUMN rewardXpTotal INTEGER DEFAULT 0'); } catch (e) {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, coinReward INTEGER NOT NULL, xpReward INTEGER NOT NULL, durationMinutes INTEGER NOT NULL, category TEXT NOT NULL, frequency TEXT, isEnabled INTEGER DEFAULT 1, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_entries (
      id TEXT PRIMARY KEY, taskId TEXT NOT NULL, childId TEXT NOT NULL, status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'completed')) DEFAULT 'pending', submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP, reviewedAt DATETIME, proof TEXT, actualDurationMinutes INTEGER, earnedCoins INTEGER DEFAULT 0, earnedXp INTEGER DEFAULT 0, rewardXp INTEGER DEFAULT 0,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // 添加奖励经验字段（如果不存在）
  try { await db.run('ALTER TABLE task_entries ADD COLUMN rewardXp INTEGER DEFAULT 0'); } catch (e) {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS wishes (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, type TEXT CHECK(type IN ('shop', 'savings', 'lottery')) NOT NULL, title TEXT NOT NULL, cost INTEGER DEFAULT 0, targetAmount INTEGER DEFAULT 0, currentAmount INTEGER DEFAULT 0, icon TEXT, stock INTEGER DEFAULT -1, rarity TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  // 添加稀有度字段（如果不存在）
  try { await db.run('ALTER TABLE wishes ADD COLUMN rarity TEXT'); } catch (e) {}
  // 抽奖奖品效果类型：null/普通 | draw_again 再抽一次（背包中使用后获得一次免费抽奖）
  try { await db.run('ALTER TABLE wishes ADD COLUMN effectType TEXT'); } catch (e) {}
  // 系统默认奖项标记（1=系统自动创建的，不能删除和修改名称）
  try { await db.run('ALTER TABLE wishes ADD COLUMN isSystemDefault INTEGER DEFAULT 0'); } catch (e) {}
  // 商品分类（零食、玩乐、特权、其他）
  try { await db.run('ALTER TABLE wishes ADD COLUMN category TEXT'); } catch (e) {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS privileges (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, cost INTEGER NOT NULL, icon TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  // 添加图标字段（如果不存在）
  try { await db.run('ALTER TABLE privileges ADD COLUMN icon TEXT'); } catch (e) {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS achievement_defs (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, icon TEXT, conditionType TEXT NOT NULL, conditionValue INTEGER DEFAULT 0, conditionCategory TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  // 添加 conditionCategory 字段（如果不存在）- 用于 category_count 和 streak_days 类型
  try { await db.run('ALTER TABLE achievement_defs ADD COLUMN conditionCategory TEXT'); } catch (e) {}
  
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
      privilegeId TEXT,
      title TEXT NOT NULL, 
      icon TEXT, 
      status TEXT CHECK(status IN ('pending', 'redeemed', 'cancelled')) DEFAULT 'pending', 
      cost INTEGER DEFAULT 0,
      costType TEXT CHECK(costType IN ('coins', 'privilegePoints')) DEFAULT 'coins',
      acquiredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      redeemedAt DATETIME,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // 迁移旧数据：unused -> pending, used -> redeemed, returned -> cancelled
  try {
    await db.run("UPDATE user_inventory SET status = 'pending' WHERE status = 'unused'");
    await db.run("UPDATE user_inventory SET status = 'redeemed' WHERE status = 'used'");
    await db.run("UPDATE user_inventory SET status = 'cancelled' WHERE status = 'returned'");
  } catch (e) {}
  // 添加新字段
  try { await db.run('ALTER TABLE user_inventory ADD COLUMN privilegeId TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE user_inventory ADD COLUMN costType TEXT CHECK(costType IN (\'coins\', \'privilegePoints\')) DEFAULT \'coins\''); } catch (e) {}
  // 添加物品来源字段 source: shop(商店购买), lottery(抽奖), privilege(特权兑换), savings(储蓄达成)
  try { await db.run('ALTER TABLE user_inventory ADD COLUMN source TEXT DEFAULT \'shop\''); } catch (e) {}
  // 添加撤销次数字段，每个商品最多只能撤销一次
  try { await db.run('ALTER TABLE user_inventory ADD COLUMN cancelCount INTEGER DEFAULT 0'); } catch (e) {}
  
  // 惩罚设置表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS punishment_settings (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL UNIQUE,
      enabled INTEGER DEFAULT 0,
      
      mildName TEXT DEFAULT '轻度警告',
      mildRate REAL DEFAULT 0.3,
      mildMin INTEGER DEFAULT 2,
      mildMax INTEGER DEFAULT 10,
      
      moderateName TEXT DEFAULT '中度惩罚',
      moderateRate REAL DEFAULT 0.5,
      moderateMin INTEGER DEFAULT 5,
      moderateMax INTEGER DEFAULT 20,
      
      severeName TEXT DEFAULT '严重惩罚',
      severeRate REAL DEFAULT 1.0,
      severeExtra INTEGER DEFAULT 5,
      severeMax INTEGER DEFAULT 50,
      
      customName TEXT DEFAULT '自定义扣除',
      customMin INTEGER DEFAULT 1,
      customMax INTEGER DEFAULT 100,
      
      allowNegative INTEGER DEFAULT 1,
      negativeLimit INTEGER DEFAULT -10,
      notifyChild INTEGER DEFAULT 1,
      requireReason INTEGER DEFAULT 1,
      
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  try { await db.run('ALTER TABLE punishment_settings ADD COLUMN customName TEXT DEFAULT \'自定义扣除\''); } catch (e) {}
  try { await db.run('ALTER TABLE punishment_settings ADD COLUMN customMin INTEGER DEFAULT 1'); } catch (e) {}
  try { await db.run('ALTER TABLE punishment_settings ADD COLUMN customMax INTEGER DEFAULT 100'); } catch (e) {}
  
  // 惩罚记录表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS punishment_records (
      id TEXT PRIMARY KEY,
      taskEntryId TEXT NOT NULL,
      taskId TEXT NOT NULL,
      childId TEXT NOT NULL,
      parentId TEXT NOT NULL,
      familyId TEXT NOT NULL,
      
      level TEXT CHECK(level IN ('mild', 'moderate', 'severe', 'custom')) NOT NULL,
      reason TEXT NOT NULL,
      
      taskReward INTEGER NOT NULL,
      deductedCoins INTEGER NOT NULL,
      balanceBefore INTEGER NOT NULL,
      balanceAfter INTEGER NOT NULL,
      
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskEntryId) REFERENCES task_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parentId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  
  // 迁移：为 punishment_records 的 level 增加 'custom'（SQLite 无法 ALTER CHECK，需重建表）
  // 只有当表结构需要迁移时才执行（检测 level CHECK 是否包含 custom）
  try {
    // 检查当前表的 CHECK 约束是否已包含 'custom'
    const tableInfo = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='punishment_records'");
    const needsMigration = tableInfo && tableInfo.sql && !tableInfo.sql.includes("'custom'");
    
    if (needsMigration) {
      console.log('📦 Migrating punishment_records to support custom level...');
      // 清理可能残留的临时表
      await db.run('DROP TABLE IF EXISTS punishment_records_new');
      
      await db.run(`CREATE TABLE punishment_records_new (
        id TEXT PRIMARY KEY,
        taskEntryId TEXT NOT NULL,
        taskId TEXT NOT NULL,
        childId TEXT NOT NULL,
        parentId TEXT NOT NULL,
        familyId TEXT NOT NULL,
        level TEXT CHECK(level IN ('mild', 'moderate', 'severe', 'custom')) NOT NULL,
        reason TEXT NOT NULL,
        taskReward INTEGER NOT NULL,
        deductedCoins INTEGER NOT NULL,
        balanceBefore INTEGER NOT NULL,
        balanceAfter INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (taskEntryId) REFERENCES task_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parentId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
      )`);
      await db.run('INSERT INTO punishment_records_new SELECT * FROM punishment_records');
      await db.run('DROP TABLE punishment_records');
      await db.run('ALTER TABLE punishment_records_new RENAME TO punishment_records');
      console.log('✅ punishment_records migration completed');
    }
  } catch (e) {
    // 新库或已是新结构时可能失败，忽略
    console.log('📦 punishment_records migration skipped or already done');
  }
  
  // 创建索引以提升查询性能
  console.log('📦 Creating indexes...');
  try {
    // users 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_users_familyId ON users(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
    
    // tasks 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_tasks_familyId ON tasks(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_tasks_isEnabled ON tasks(isEnabled)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_tasks_familyId_isEnabled ON tasks(familyId, isEnabled)');
    
    // task_entries 表索引（高频查询）
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_entries_childId ON task_entries(childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_entries_taskId ON task_entries(taskId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_entries_status ON task_entries(status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_entries_submittedAt ON task_entries(submittedAt)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_entries_childId_status ON task_entries(childId, status)');
    
    // wishes 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_wishes_familyId ON wishes(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_wishes_type ON wishes(type)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_wishes_familyId_type ON wishes(familyId, type)');
    
    // user_inventory 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_user_inventory_childId ON user_inventory(childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_user_inventory_status ON user_inventory(status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_user_inventory_source ON user_inventory(source)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_user_inventory_childId_source ON user_inventory(childId, source)');
    
    // punishment_records 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_punishment_records_familyId ON punishment_records(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_punishment_records_childId ON punishment_records(childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_punishment_records_taskEntryId ON punishment_records(taskEntryId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_punishment_records_createdAt ON punishment_records(createdAt)');
    
    // user_achievements 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_user_achievements_childId ON user_achievements(childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_user_achievements_achievementId ON user_achievements(achievementId)');
    
    // achievement_defs 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_achievement_defs_familyId ON achievement_defs(familyId)');
    
    // privileges 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_privileges_familyId ON privileges(familyId)');
    
    console.log('✅ Database indexes created');
  } catch (e) {
    console.log('⚠️ Some indexes may already exist, continuing...');
  }
};
