import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { randomUUID } from 'crypto';
import { ensureProductConfigTables } from './productConfig';
import { ensureLotterySafetyTables } from './lotteryRules';
import { ensureEconomySchema } from './economySchema';
import { ensureTaskSettlementSchema } from './taskSettlement';
import { ensureGrowthIdentitySchema } from './growthIdentitySchema';
import { ensureGrowthCosmeticSchema } from './growthCosmeticSchema';
import { ensureParentDailyWelcomeSchema } from './parentDailyWelcome';
import { ensureExploreSourceSchema, syncExploreSourceCatalog } from './exploreSourceCatalog';

let db: Database;

export const ensureSmsAuditSchema = async (database: Database) => {
  const columns = new Set<string>(
    (await database.all('PRAGMA table_info(auth_sms_codes)'))
      .map((column: { name: string }) => column.name)
  );
  if (!columns.has('provider')) {
    await database.run("ALTER TABLE auth_sms_codes ADD COLUMN provider TEXT NOT NULL DEFAULT 'local'");
  }
  if (!columns.has('providerBizId')) {
    await database.run('ALTER TABLE auth_sms_codes ADD COLUMN providerBizId TEXT');
  }
};

export const migrateRetiredMorningTaskCategories = async (database: Database) => {
  const version = 'phase9a-retire-morning-category';
  const applied = await database.get('SELECT version FROM schema_versions WHERE version = ?', version);
  if (applied) return;

  await database.exec('BEGIN IMMEDIATE');
  try {
    await database.run(`
      UPDATE tasks
         SET category = CASE
           WHEN title LIKE '%晨读%' OR title LIKE '%阅读%' OR title LIKE '%复习%'
             OR title LIKE '%背诵%' OR title LIKE '%作业%' OR title LIKE '%学习%'
           THEN '学习'
           ELSE '生活'
         END
       WHERE category IN ('早晨启动', '晨间启动', '晨读', '早晨复习', '起床复习')
    `);
    await database.run(
      'INSERT INTO schema_versions (version, description) VALUES (?, ?)',
      version,
      '停用晨间任务分类：学习标题迁移为学习，其余迁移为生活'
    );
    await database.exec('COMMIT');
  } catch (error) {
    await database.exec('ROLLBACK');
    throw error;
  }
};

export const initializeDatabase = async () => {
  const dbPath = process.env.STARCOIN_DB_PATH
    ? path.resolve(process.env.STARCOIN_DB_PATH)
    : path.resolve(__dirname, '../../stellar.db');

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
  await ensureSmsAuditSchema(db);
  await ensureProductConfigTables(db);
  await ensureLotterySafetyTables(db);
  await ensureEconomySchema(db);
  await ensureTaskSettlementSchema(db);
  await ensureParentDailyWelcomeSchema(db);

  // B2-6: 迁移版本追踪
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version TEXT PRIMARY KEY,
      appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      description TEXT
    )
  `);
  const existingMigrations = [
    { version: '001', description: '初始核心表结构' },
    { version: '002', description: '用户扩展字段（pin/phone/auth）' },
    { version: '003', description: '任务扩展字段（并行/完成模式/图标）' },
    { version: '004', description: '学习闯关表' },
    { version: '005', description: '情绪急救/游戏票表' },
    { version: '006', description: '早餐/早晨流程表' },
    { version: '007', description: '探索表及索引' },
    { version: '008', description: '探索地点软删除' },
    { version: '009', description: '探索媒体 senderRole 与家庭照片要求开关' },
    { version: '010', description: '探索二期发现资讯流（feed 表/关注源/家庭城市配置）' },
    { version: '011', description: '家庭快速配置与推荐内容去重记录' },
    { version: '012', description: '家庭抽奖开关与每日付费抽取安全上限' },
    { version: '013', description: '奖励经济目标、商品参考价与可回滚变更记录' },
    { version: '014', description: '探索体验选择、完整度门槛与自动补全队列' },
  ];
  for (const m of existingMigrations) {
    await db.run('INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)', [m.version, m.description]);
  }

  await migrateRetiredMorningTaskCategories(db);

  try { await db.run('ALTER TABLE users ADD COLUMN pin TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN phone TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN phoneVerifiedAt TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN authProvider TEXT DEFAULT "password"'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN oneClickProvider TEXT'); } catch (e) {}
  try { await db.run("UPDATE users SET phone = email WHERE (phone IS NULL OR phone = '') AND email GLOB '1??????????'"); } catch (e) {}
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

  // 每日登录奖励字段
  await db.exec(`
    CREATE TABLE IF NOT EXISTS explore_places (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT '其他',
      city TEXT,
      address TEXT,
      latitude REAL,
      longitude REAL,
      source TEXT DEFAULT 'manual',
      externalId TEXT,
      summary TEXT,
      whyGo TEXT,
      observeTips TEXT,
      questionPrompts TEXT,
      tags TEXT,
      status TEXT DEFAULT 'wishlist',
      createdBy TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS explore_checkins (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      placeId TEXT NOT NULL,
      childId TEXT NOT NULL,
      mood TEXT,
      note TEXT,
      checkedInAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      parentConfirmed INTEGER DEFAULT 0,
      parentNote TEXT,
      confirmedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (placeId) REFERENCES explore_places(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS explore_media (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      checkinId TEXT NOT NULL,
      childId TEXT NOT NULL,
      type TEXT NOT NULL,
      filePath TEXT NOT NULL,
      mimeType TEXT,
      sizeBytes INTEGER DEFAULT 0,
      durationSeconds INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (checkinId) REFERENCES explore_checkins(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // B2-3: 探索地点软删除字段
  try { await db.run('ALTER TABLE explore_places ADD COLUMN deletedAt TEXT'); } catch (e) {}
  // 探索改版①：媒体发送者角色——child=孩子打卡上传，parent=家长语音回应
  try { await db.run("ALTER TABLE explore_media ADD COLUMN senderRole TEXT DEFAULT 'child'"); } catch (e) {}
  // 探索改版②：打卡照片要求开关（仅前端引导提示，后端不强制）
  try { await db.run('ALTER TABLE families ADD COLUMN exploreRequirePhoto INTEGER DEFAULT 0'); } catch (e) {}
  // 探索地图一期：单次打卡定位（家长开关控制；仅记录距离，不阻止打卡、不追踪轨迹）
  try { await db.run('ALTER TABLE explore_checkins ADD COLUMN latitude REAL'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_checkins ADD COLUMN longitude REAL'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_checkins ADD COLUMN distanceMeters INTEGER'); } catch (e) {}
  try { await db.run('ALTER TABLE families ADD COLUMN exploreGeoVerify INTEGER DEFAULT 0'); } catch (e) {}

  // 探索二期（发现资讯流）：每日推荐卡片表 + 家长关注源表 + 家庭推送配置列（全部幂等，只增不改）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS explore_feed_items (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      type TEXT CHECK(type IN ('poi','festival','parent','source')),
      title TEXT NOT NULL,
      summary TEXT,
      imageUrl TEXT,
      category TEXT,
      latitude REAL,
      longitude REAL,
      amapPoiId TEXT,
      sourceUrl TEXT,
      status TEXT CHECK(status IN ('pending_review','new','wanted','dismissed')) DEFAULT 'new',
      recommendDate TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.run('CREATE INDEX IF NOT EXISTS idx_explore_feed_items_familyId_status ON explore_feed_items(familyId, status)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_explore_feed_items_familyId_recommendDate ON explore_feed_items(familyId, recommendDate)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_explore_feed_items_familyId_amapPoiId ON explore_feed_items(familyId, amapPoiId)');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS explore_feed_sources (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      url TEXT NOT NULL,
      label TEXT,
      lastFetchedAt DATETIME,
      lastItemHash TEXT,
      isActive INTEGER DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.run('CREATE INDEX IF NOT EXISTS idx_explore_feed_sources_familyId_isActive ON explore_feed_sources(familyId, isActive)');

  try { await db.run('ALTER TABLE families ADD COLUMN exploreCity TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE families ADD COLUMN exploreFeedDailyLimit INTEGER DEFAULT 3'); } catch (e) {}
  try { await db.run('ALTER TABLE families ADD COLUMN exploreFeedCategories TEXT'); } catch (e) {}
  // 发现卡「想去」落地图：记录地点来自哪条资讯
  try { await db.run('ALTER TABLE explore_places ADD COLUMN sourceFeedId TEXT'); } catch (e) {}
  // 探索发现 v2：结构化活动字段 + 适龄 + 有效期(按天) + 城市（全部 append-only）
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN venue TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN district TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN feedCategory TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN ageMin INTEGER'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN ageMax INTEGER'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN activityStart TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN activityEnd TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN signupDeadline TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN price TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN bookingMethod TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN officialUrl TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN recommendReason TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN notes TEXT'); } catch (e) {}
  try { await db.run("ALTER TABLE explore_feed_items ADD COLUMN verifyStatus TEXT DEFAULT '未核验'"); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN recommendScore INTEGER'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN city TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN validFrom TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE explore_feed_items ADD COLUMN validUntil TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE families ADD COLUMN exploreCities TEXT'); } catch (e) {}

  // Phase 10：孩子探索意向 + 推荐内容补全状态（只追加，不改已有字段和状态枚举）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS explore_child_intents (
      childId TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      selectionsJson TEXT NOT NULL DEFAULT '["any"]',
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_explore_child_intents_familyId ON explore_child_intents(familyId);

    CREATE TABLE IF NOT EXISTS explore_experience_settings (
      familyId TEXT PRIMARY KEY,
      disabledOptionsJson TEXT NOT NULL DEFAULT '[]',
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    );
  `);
  const exploreFeedColumns = new Set<string>(
    (await db.all('PRAGMA table_info(explore_feed_items)')).map((column: { name: string }) => column.name)
  );
  const phase10ExploreColumns = [
    ['enrichmentStatus', 'TEXT'],
    ['enrichmentAttempts', 'INTEGER DEFAULT 0'],
    ['nextEnrichmentAt', 'TEXT'],
    ['lastEnrichmentError', 'TEXT'],
    ['imageSourceUrl', 'TEXT'],
    ['contentSourceType', 'TEXT'],
    ['experienceTags', 'TEXT'],
  ] as const;
  for (const [name, definition] of phase10ExploreColumns) {
    if (!exploreFeedColumns.has(name)) {
      await db.run(`ALTER TABLE explore_feed_items ADD COLUMN ${name} ${definition}`);
    }
  }
  await db.run('CREATE INDEX IF NOT EXISTS idx_explore_feed_enrichment_queue ON explore_feed_items(enrichmentStatus, nextEnrichmentAt)');

  // 旧卡不删除：完整卡标记 ready；不完整卡进入家长可见的补全队列，孩子端不再误看空白卡。
  await db.run(`
    UPDATE explore_feed_items
       SET contentSourceType = COALESCE(contentSourceType, CASE type
             WHEN 'poi' THEN 'amap' WHEN 'source' THEN 'official'
             WHEN 'parent' THEN 'parent' ELSE 'system' END),
           imageSourceUrl = COALESCE(imageSourceUrl, imageUrl),
           enrichmentStatus = CASE
             WHEN status IN ('wanted', 'dismissed') THEN 'ready'
             WHEN length(trim(COALESCE(title, ''))) >= 2
              AND length(trim(COALESCE(summary, ''))) >= 4
              AND length(trim(COALESCE(imageUrl, ''))) > 0
              AND ((latitude IS NOT NULL AND longitude IS NOT NULL)
                   OR length(trim(COALESCE(venue, ''))) >= 2
                   OR length(trim(COALESCE(district, ''))) >= 2
                   OR length(trim(COALESCE(city, ''))) >= 2
                   OR length(trim(COALESCE(activityStart, ''))) > 0
                   OR length(trim(COALESCE(activityEnd, ''))) > 0
                   OR length(trim(COALESCE(signupDeadline, ''))) > 0)
             THEN 'ready' ELSE 'waiting' END,
           nextEnrichmentAt = CASE
             WHEN status NOT IN ('wanted', 'dismissed')
              AND NOT (
                length(trim(COALESCE(title, ''))) >= 2
                AND length(trim(COALESCE(summary, ''))) >= 4
                AND length(trim(COALESCE(imageUrl, ''))) > 0
                AND ((latitude IS NOT NULL AND longitude IS NOT NULL)
                     OR length(trim(COALESCE(venue, ''))) >= 2
                     OR length(trim(COALESCE(district, ''))) >= 2
                     OR length(trim(COALESCE(city, ''))) >= 2
                     OR length(trim(COALESCE(activityStart, ''))) > 0
                     OR length(trim(COALESCE(activityEnd, ''))) > 0
                     OR length(trim(COALESCE(signupDeadline, ''))) > 0)
              )
             THEN datetime(COALESCE(createdAt, CURRENT_TIMESTAMP), '+1 hour')
             ELSE NULL END
     WHERE enrichmentStatus IS NULL
  `);

  await ensureExploreSourceSchema(db);
  await syncExploreSourceCatalog(db);

  try { await db.run('ALTER TABLE users ADD COLUMN lastLoginDate TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN loginStreak INTEGER DEFAULT 0'); } catch (e) {}

  // 并行任务字段
  try { await db.run('ALTER TABLE tasks ADD COLUMN isParallel INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run("ALTER TABLE tasks ADD COLUMN completionMode TEXT DEFAULT 'timer'"); } catch (e) {}
  try { await db.run('ALTER TABLE tasks ADD COLUMN targetValue INTEGER'); } catch (e) {}
  try { await db.run('ALTER TABLE tasks ADD COLUMN targetUnit TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE tasks ADD COLUMN reviewFocus TEXT'); } catch (e) {}
  try {
    await db.run(`
      UPDATE tasks
      SET completionMode = 'participation',
          targetUnit = CASE WHEN category = '运动' THEN '分钟/组' WHEN category = '情绪调节' THEN '次/步骤' ELSE '分钟/次' END,
          reviewFocus = CASE
            WHEN category = '运动' THEN '参与完整、动作安全、愿意开始'
            WHEN category = '情绪调节' THEN '识别感受、使用冷静方法、恢复后表达'
            ELSE '投入过程、完成约定、合作表达'
          END
      WHERE category IN ('运动', '活动', '情绪调节')
        AND (
          completionMode IS NULL OR completionMode = '' OR
          (
            completionMode = 'timer' AND
            (reviewFocus IS NULL OR reviewFocus = '' OR reviewFocus IN ('参与完整、动作安全、愿意开始', '投入过程、完成约定、合作表达'))
          )
        )
    `);
  } catch (e) {}

  // 任务超时标记
  try { await db.run('ALTER TABLE task_entries ADD COLUMN isOverdue INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE task_entries ADD COLUMN autoCompleted INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE task_entries ADD COLUMN autoCompleteReason TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE task_sessions ADD COLUMN parentReminderReadAt DATETIME'); } catch (e) {}

  // 游戏票：学习任务节省时间自动入账（旧库兼容）
  try { await db.run('ALTER TABLE screen_time_rules ADD COLUMN studySavedTimeEnabled INTEGER DEFAULT 1'); } catch (e) {}
  try { await db.run('ALTER TABLE screen_time_rules ADD COLUMN studySavedTimeRatio REAL DEFAULT 1'); } catch (e) {}
  try {
    await db.run(`
      UPDATE screen_time_rules
         SET dailyBaseMinutes = 15
       WHERE dailyBaseMinutes = 20
         AND dailyMaxMinutes = 45
         AND ticketMinutes = 10
         AND cooldownMinutes = 3
         AND COALESCE(studySavedTimeEnabled, 1) = 1
         AND COALESCE(studySavedTimeRatio, 1) = 1
    `);
  } catch (e) {}
  try { await db.run('ALTER TABLE screen_time_ledger ADD COLUMN taskEntryId TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE screen_time_ledger ADD COLUMN learningSessionId TEXT'); } catch (e) {}

  // R1: 经济锚点设置（每天任务数 / 金币兑人民币 / 中等奖品攒几天 / 游戏加场特权点价）
  try { await db.run('ALTER TABLE families ADD COLUMN ecoTasksPerDay INTEGER DEFAULT 10'); } catch (e) {}
  try { await db.run('ALTER TABLE families ADD COLUMN ecoCoinPerRmb INTEGER DEFAULT 10'); } catch (e) {}
  try { await db.run('ALTER TABLE families ADD COLUMN ecoMidPrizeDays INTEGER DEFAULT 10'); } catch (e) {}
  try { await db.run('ALTER TABLE families ADD COLUMN ecoGamePrivilegePoints INTEGER DEFAULT 2'); } catch (e) {}

  // F5: 成就奖励改为解锁即自动发放。存量未领取（rewardClaimedAt IS NULL）的成就一次性补发。
  // 用 schema_versions 当幂等标记，INSERT OR IGNORE，仅当 changes===1（首次写入）才执行回填。
  try {
    const backfillMark = await db.run(
      'INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)',
      ['achv-autoclaim-backfill-2026-06', '成就奖励自动发放：存量未领取一次性补发']
    );
    if ((backfillMark.changes || 0) === 1) {
      const pending = await db.all(
        `SELECT ua.id as userAchievementId, ua.childId,
                ad.title, ad.icon, ad.rewardCoins, ad.rewardXp, ad.rewardPrivilegePoints, ad.rewardDelivery
         FROM user_achievements ua
         JOIN achievement_defs ad ON ua.achievementId = ad.id
         WHERE ua.rewardClaimedAt IS NULL`
      );
      let backfilledCount = 0;
      for (const row of pending) {
        const rewardCoins = Math.max(0, Math.trunc(Number(row.rewardCoins || 0)));
        const rewardXp = Math.max(0, Math.trunc(Number(row.rewardXp || 0)));
        const rewardPrivilegePoints = Math.max(0, Math.trunc(Number(row.rewardPrivilegePoints || 0)));
        const rewardDelivery = row.rewardDelivery === 'backpack' ? 'backpack' : 'instant';
        const hasReward = rewardCoins > 0 || rewardXp > 0 || rewardPrivilegePoints > 0;
        const nowIso = new Date().toISOString();
        try {
          let inventoryId: string | null = null;
          if (hasReward && rewardDelivery === 'backpack') {
            inventoryId = randomUUID();
            await db.run(
              `INSERT INTO user_inventory (
                 id, childId, title, icon, cost, costType, source, status,
                 rewardCoins, rewardXp, rewardPrivilegePoints, acquiredAt
               ) VALUES (?, ?, ?, ?, 0, 'coins', 'achievement_reward', 'pending', ?, ?, ?, ?)`,
              inventoryId, row.childId, `${row.title}成就礼包`, row.icon || '🏆',
              rewardCoins, rewardXp, rewardPrivilegePoints, nowIso
            );
          } else if (hasReward) {
            await db.run(
              'UPDATE users SET coins = coins + ?, xp = xp + ?, privilegePoints = privilegePoints + ? WHERE id = ?',
              rewardCoins, rewardXp, rewardPrivilegePoints, row.childId
            );
          }
          await db.run(
            'UPDATE user_achievements SET rewardClaimedAt = ?, rewardInventoryId = ? WHERE id = ? AND rewardClaimedAt IS NULL',
            nowIso, inventoryId, row.userAchievementId
          );
          backfilledCount++;
        } catch (rowErr) {
          console.error('成就奖励补发单条失败:', row.userAchievementId, rowErr);
        }
      }
      console.log(`✅ 成就奖励自动发放补发完成：共补发 ${backfilledCount} 条（待发放 ${pending.length} 条）`);
    }
  } catch (e) {
    console.error('⚠️ 成就奖励补发迁移失败:', e);
  }

  // 上海默认关注源一次性预置：对从未配置过发现推送（无城市、无关注源）的存量家庭，
  // 写入实查可用的上海公共文化数据源并把城市设为上海。新家庭走家长端自行配置。
  try {
    const shMark = await db.run(
      'INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)',
      ['shanghai-default-sources-2026-06', '上海默认关注源与城市预置']
    );
    if ((shMark.changes || 0) === 1) {
      const SHANGHAI_DEFAULT_SOURCES = [
        { url: 'https://zjj.wenhuayun.cn/frontActivity/activityList.do', label: '文化云·上海公共文化活动' },
        { url: 'https://www.library.sh.cn/activity', label: '上海图书馆·活动' },
        { url: 'https://whlyj.sh.gov.cn/wbzx/', label: '市文旅局·文博资讯' },
        { url: 'https://www.shanghaimuseum.net/', label: '上海博物馆·展讯' },
        { url: 'https://www.expo-museum.cn/', label: '世博会博物馆·展讯' },
      ];
      const fams = await db.all(
        `SELECT f.id FROM families f
         WHERE f.id != 'TEMP' AND COALESCE(f.exploreCity, '') = ''
           AND NOT EXISTS (SELECT 1 FROM explore_feed_sources s WHERE s.familyId = f.id)`
      );
      for (const fam of fams) {
        await db.run("UPDATE families SET exploreCity = '上海' WHERE id = ?", fam.id);
        for (const src of SHANGHAI_DEFAULT_SOURCES) {
          await db.run(
            'INSERT INTO explore_feed_sources (id, familyId, url, label, isActive) VALUES (?, ?, ?, ?, 1)',
            randomUUID(), fam.id, src.url, src.label
          );
        }
      }
      if (fams.length > 0) console.log(`✅ 已为 ${fams.length} 个家庭预置上海默认关注源(5个)与城市`);
    }
  } catch (e) {
    console.error('⚠️ 上海默认关注源预置失败:', e);
  }

  // R1: 游戏加场特权一次性预置——对没有「游戏加场」特权的存量家庭补一条（特权以特权点计价）。
  try {
    const gameAddonMark = await db.run(
      'INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)',
      ['game-addon-privilege-2026-06', '游戏加场30分钟特权预置']
    );
    if ((gameAddonMark.changes || 0) === 1) {
      const famsWithoutAddon = await db.all(
        `SELECT f.id FROM families f
         WHERE f.id != 'TEMP'
           AND NOT EXISTS (SELECT 1 FROM privileges p WHERE p.familyId = f.id AND p.title LIKE '%游戏加场%')`
      );
      for (const fam of famsWithoutAddon) {
        await db.run(
          `INSERT INTO privileges (id, familyId, title, description, cost, icon, level, timeWindow, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          randomUUID(), fam.id, '游戏加场 30 分钟',
          '今天的游戏票用完了还想玩？用攒下的信任换 30 分钟加场',
          2, '🎮', 'bronze', null, '娱乐'
        );
      }
      if (famsWithoutAddon.length > 0) console.log(`✅ 已为 ${famsWithoutAddon.length} 个家庭预置「游戏加场 30 分钟」特权`);
    }
  } catch (e) {
    console.error('⚠️ 游戏加场特权预置失败:', e);
  }

  // N1: 生活/学习/运动成就阶梯补齐——为存量家庭补「连续3天」档（新家庭由 DEFAULT_ACHIEVEMENT_SEEDS 直接覆盖）。
  // 仅当家庭内不存在同 title 的成就时插入，家长自定义成就不受影响。
  try {
    const achvExpandMark = await db.run(
      'INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)',
      ['achv-seed-expand-2026-06', '生活/学习/运动成就补齐「连续3天」档']
    );
    if ((achvExpandMark.changes || 0) === 1) {
      const NEW_STREAK3_SEEDS = [
        { title: '三日小当家', desc: '连续 3 天完成生活任务', icon: '🧹', type: 'streak_days', value: 3, conditionCategory: '生活', category: '生活', rewardCoins: 10, rewardXp: 10, rewardPrivilegePoints: 0 },
        { title: '三日书声', desc: '连续 3 天完成学习任务', icon: '📅', type: 'streak_days', value: 3, conditionCategory: '学习', category: '学习', rewardCoins: 10, rewardXp: 10, rewardPrivilegePoints: 0 },
        { title: '连动三天', desc: '连续 3 天完成运动任务', icon: '🔥', type: 'streak_days', value: 3, conditionCategory: '运动', category: '运动', rewardCoins: 10, rewardXp: 10, rewardPrivilegePoints: 0 },
      ];
      const achvFams = await db.all(`SELECT id FROM families WHERE id != 'TEMP'`);
      let achvInserted = 0;
      for (const fam of achvFams) {
        for (const ach of NEW_STREAK3_SEEDS) {
          const dup = await db.get(
            'SELECT 1 FROM achievement_defs WHERE familyId = ? AND title = ?',
            fam.id, ach.title
          );
          if (dup) continue;
          await db.run(
            `INSERT INTO achievement_defs (
                id, familyId, title, description, icon, conditionType, conditionValue,
                conditionCategory, category, rewardCoins, rewardXp, rewardPrivilegePoints, rewardDelivery
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            randomUUID(), fam.id, ach.title, ach.desc, ach.icon, ach.type, ach.value,
            ach.conditionCategory, ach.category, ach.rewardCoins, ach.rewardXp, ach.rewardPrivilegePoints, 'instant'
          );
          achvInserted++;
        }
      }
      console.log(`✅ 成就阶梯补齐：检查 ${achvFams.length} 个家庭，新增 ${achvInserted} 条「连续3天」成就`);
    }
  } catch (e) {
    console.error('⚠️ 成就阶梯补齐迁移失败:', e);
  }

  // 高光时刻：为存量家庭回填 6 条 manual 成就，由家长在成就管理页手动颁发（新家庭由 DEFAULT_ACHIEVEMENT_SEEDS 直接覆盖）。
  // 仅当家庭内不存在同 title 的成就时插入，家长自定义成就不受影响。
  try {
    const manualPackMark = await db.run(
      'INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)',
      ['achv-manual-pack-2026-06', '高光时刻：6 条 manual 成就回填']
    );
    if ((manualPackMark.changes || 0) === 1) {
      const MANUAL_PACK_SEEDS = [
      { title: '第一次独立完成', desc: '不用任何帮助独立完成一件家务', icon: '🧽', type: 'manual', value: 0, category: '生活', rewardCoins: 8, rewardXp: 15 },
      { title: '主动多做一件', desc: '没人要求，主动帮家里做了额外的事', icon: '🤝', type: 'manual', value: 0, category: '生活', rewardCoins: 10, rewardXp: 15 },
      { title: '自己发现错误', desc: '检查作业时自己找出并改正了错误', icon: '🔍', type: 'manual', value: 0, category: '学习', rewardCoins: 10, rewardXp: 15 },
      { title: '教会别人一次', desc: '把学会的东西讲给家人听懂', icon: '🎓', type: 'manual', value: 0, category: '学习', rewardCoins: 10, rewardXp: 20 },
      { title: '坚持到最后', desc: '很累但坚持完成了整场运动', icon: '🏁', type: 'manual', value: 0, category: '运动', rewardCoins: 10, rewardXp: 15 },
      { title: '勇敢再试一次', desc: '失败后没放弃，重新尝试', icon: '🌈', type: 'manual', value: 0, category: '成长', rewardCoins: 12, rewardXp: 20 },
      ];
      const manualFams = await db.all(`SELECT id FROM families WHERE id != 'TEMP'`);
      let manualInserted = 0;
      for (const fam of manualFams) {
        for (const ach of MANUAL_PACK_SEEDS) {
          const dup = await db.get(
            'SELECT 1 FROM achievement_defs WHERE familyId = ? AND title = ?',
            fam.id, ach.title
          );
          if (dup) continue;
          await db.run(
            `INSERT INTO achievement_defs (
                id, familyId, title, description, icon, conditionType, conditionValue,
                conditionCategory, category, rewardCoins, rewardXp, rewardPrivilegePoints, rewardDelivery
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            randomUUID(), fam.id, ach.title, ach.desc, ach.icon, ach.type, ach.value,
            null, ach.category, ach.rewardCoins, ach.rewardXp, 0, 'instant'
          );
          manualInserted++;
        }
      }
      console.log(`✅ 高光时刻成就回填：检查 ${manualFams.length} 个家庭，新增 ${manualInserted} 条 manual 成就`);
    }
  } catch (e) {
    console.error('⚠️ 高光时刻成就回填迁移失败:', e);
  }

  // R4: 周报表（每周日 20:00 北京时间由 weeklyReport.ts 调度生成，确定性规则拼装文案）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      childId TEXT NOT NULL,
      weekStart TEXT NOT NULL,
      childStory TEXT,
      parentNarrative TEXT,
      statsJson TEXT,
      suggestion TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_reports_childId_weekStart ON weekly_reports(childId, weekStart)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_weekly_reports_familyId_weekStart ON weekly_reports(familyId, weekStart)');
  await db.run('INSERT OR IGNORE INTO schema_versions (version, description) VALUES (?, ?)', ['011', '周报表 weekly_reports']);

  // Phase 4: run after every legacy achievement seed/backfill so the first restart classifies them too.
  await ensureGrowthIdentitySchema(db);
  await ensureGrowthCosmeticSchema(db);

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
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, email TEXT UNIQUE, phone TEXT, phoneVerifiedAt TEXT, authProvider TEXT DEFAULT 'password', oneClickProvider TEXT, password TEXT, name TEXT NOT NULL,
      role TEXT CHECK(role IN ('parent', 'child')) NOT NULL, avatar TEXT,
      coins INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1, maxXp INTEGER DEFAULT 100, privilegePoints INTEGER DEFAULT 0,
      rewardXpTotal INTEGER DEFAULT 0,
      pin TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // 添加累计奖励经验字段（如果不存在）
  try { await db.run('ALTER TABLE users ADD COLUMN rewardXpTotal INTEGER DEFAULT 0'); } catch (e) {}
  // 低电量模式：存当天北京日期，非当天即视为未开启，次日自动恢复
  try { await db.run('ALTER TABLE users ADD COLUMN lowEnergyDate TEXT'); } catch (e) {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sms_codes (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      purpose TEXT NOT NULL,
      codeHash TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      expiresAt DATETIME NOT NULL,
      consumedAt DATETIME,
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
      id TEXT PRIMARY KEY, taskId TEXT NOT NULL, childId TEXT NOT NULL, status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'completed')) DEFAULT 'pending', submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP, reviewedAt DATETIME, proof TEXT, actualDurationMinutes INTEGER, earnedCoins INTEGER DEFAULT 0, earnedXp INTEGER DEFAULT 0, rewardXp INTEGER DEFAULT 0,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // 添加奖励经验字段（如果不存在）
  try { await db.run('ALTER TABLE task_entries ADD COLUMN rewardXp INTEGER DEFAULT 0'); } catch (e) {}
  // B3-1 打回原因：让孩子知道哪里可以改进（幂等加列）
  try { await db.run('ALTER TABLE task_entries ADD COLUMN reviewNote TEXT'); } catch (e) {}

  // 学习闯关：独立于普通任务，避免影响现有线上任务/审核数据
  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_sessions (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      taskId TEXT NOT NULL,
      childId TEXT NOT NULL,
      status TEXT CHECK(status IN ('running', 'completed', 'auto_completed', 'abandoned')) DEFAULT 'running',
      startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      endedAt DATETIME,
      autoCompletedAt DATETIME,
      taskEntryId TEXT,
      reminderReadAt DATETIME,
      parentReminderReadAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (taskEntryId) REFERENCES task_entries(id) ON DELETE SET NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS learning_quests (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      subject TEXT DEFAULT '综合',
      questType TEXT DEFAULT 'written',
      feeling TEXT DEFAULT 'normal',
      resistanceLevel TEXT DEFAULT 'medium',
      icon TEXT DEFAULT '📚',
      estimatedMinutes INTEGER DEFAULT 10,
      totalCoins INTEGER DEFAULT 10,
      totalXp INTEGER DEFAULT 15,
      privilegePoints INTEGER DEFAULT 0,
      isActive INTEGER DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS learning_steps (
      id TEXT PRIMARY KEY,
      questId TEXT NOT NULL,
      title TEXT NOT NULL,
      stepOrder INTEGER NOT NULL,
      minutes INTEGER DEFAULT 5,
      coins INTEGER DEFAULT 2,
      xp INTEGER DEFAULT 3,
      prompt TEXT,
      isRequired INTEGER DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (questId) REFERENCES learning_quests(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS learning_sessions (
      id TEXT PRIMARY KEY,
      questId TEXT NOT NULL,
      childId TEXT NOT NULL,
      status TEXT CHECK(status IN ('in_progress', 'pending', 'approved', 'rejected')) DEFAULT 'in_progress',
      currentStepIndex INTEGER DEFAULT 0,
      proof TEXT,
      stuckReason TEXT,
      earnedCoins INTEGER DEFAULT 0,
      earnedXp INTEGER DEFAULT 0,
      startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      submittedAt DATETIME,
      reviewedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (questId) REFERENCES learning_quests(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS emotion_checkins (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      childId TEXT NOT NULL,
      scene TEXT NOT NULL,
      intensity TEXT DEFAULT 'medium',
      action TEXT,
      note TEXT,
      helped INTEGER DEFAULT 0,
      xpAwarded INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS screen_time_rules (
      familyId TEXT PRIMARY KEY,
      isEnabled INTEGER DEFAULT 1,
      dailyBaseMinutes INTEGER DEFAULT 15,
      dailyMaxMinutes INTEGER DEFAULT 45,
      ticketMinutes INTEGER DEFAULT 10,
      cooldownMinutes INTEGER DEFAULT 3,
      studySavedTimeEnabled INTEGER DEFAULT 1,
      studySavedTimeRatio REAL DEFAULT 1,
      weekdayAllowedStart TEXT DEFAULT '17:30',
      weekdayAllowedEnd TEXT DEFAULT '20:30',
      weekendAllowedStart TEXT DEFAULT '09:00',
      weekendAllowedEnd TEXT DEFAULT '20:30',
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS screen_time_ledger (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      childId TEXT NOT NULL,
      deltaMinutes INTEGER NOT NULL,
      reason TEXT,
      source TEXT DEFAULT 'manual',
      taskEntryId TEXT,
      learningSessionId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS screen_time_sessions (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      childId TEXT NOT NULL,
      plannedMinutes INTEGER NOT NULL,
      status TEXT CHECK(status IN ('running', 'completed', 'cancelled')) DEFAULT 'running',
      startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      endedAt DATETIME,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS breakfast_items (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '🍽️',
      category TEXT DEFAULT '主食',
      costCoins INTEGER DEFAULT 0,
      isActive INTEGER DEFAULT 1,
      isDefault INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  try { await db.run('ALTER TABLE breakfast_items ADD COLUMN description TEXT'); } catch (e) {}
  try { await db.run("ALTER TABLE breakfast_items ADD COLUMN icon TEXT DEFAULT '🥣'"); } catch (e) {}
  try { await db.run("ALTER TABLE breakfast_items ADD COLUMN category TEXT DEFAULT '主食'"); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_items ADD COLUMN costCoins INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_items ADD COLUMN isActive INTEGER DEFAULT 1'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_items ADD COLUMN isDefault INTEGER DEFAULT 0'); } catch (e) {}
  try {
    await db.run(`
      UPDATE breakfast_items
         SET icon = COALESCE(NULLIF(icon, ''), '🥣'),
             category = COALESCE(NULLIF(category, ''), '主食'),
             costCoins = COALESCE(costCoins, 0),
             isActive = COALESCE(isActive, 1),
             isDefault = COALESCE(isDefault, 0)
    `);
  } catch (e) {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS breakfast_orders (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      childId TEXT NOT NULL,
      itemId TEXT,
      planId TEXT,
      title TEXT NOT NULL,
      icon TEXT DEFAULT '🍽️',
      costCoins INTEGER DEFAULT 0,
      orderDate TEXT NOT NULL,
      status TEXT CHECK(status IN ('ordered', 'served', 'cancelled')) DEFAULT 'ordered',
      selectedBy TEXT DEFAULT 'child',
      refundCoins INTEGER DEFAULT 0,
      changeCount INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      servedAt DATETIME,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (itemId) REFERENCES breakfast_items(id) ON DELETE SET NULL,
      FOREIGN KEY (planId) REFERENCES breakfast_plans(id) ON DELETE SET NULL
    )
  `);
  try { await db.run('ALTER TABLE breakfast_orders ADD COLUMN planId TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_orders ADD COLUMN selectedBy TEXT DEFAULT "child"'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_orders ADD COLUMN refundCoins INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_orders ADD COLUMN changeCount INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_orders ADD COLUMN updatedAt DATETIME'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_orders ADD COLUMN itemIds TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_orders ADD COLUMN itemsSnapshot TEXT'); } catch (e) {}
  try { await db.run('UPDATE breakfast_orders SET updatedAt = COALESCE(updatedAt, createdAt, CURRENT_TIMESTAMP)'); } catch (e) {}

  await db.exec(`
    CREATE TABLE IF NOT EXISTS breakfast_plans (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      childId TEXT,
      planDate TEXT NOT NULL,
      defaultItemId TEXT,
      optionItemIds TEXT,
      note TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(familyId, childId, planDate),
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (defaultItemId) REFERENCES breakfast_items(id) ON DELETE SET NULL
    )
  `);
  try { await db.run('ALTER TABLE breakfast_plans ADD COLUMN defaultItemId TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_plans ADD COLUMN optionItemIds TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_plans ADD COLUMN note TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE breakfast_plans ADD COLUMN updatedAt DATETIME'); } catch (e) {}
  try { await db.run('UPDATE breakfast_plans SET updatedAt = COALESCE(updatedAt, createdAt, CURRENT_TIMESTAMP)'); } catch (e) {}
  // 早晨流程已并入普通任务挑战，清理旧表，避免新旧功能概念并存。
  await db.exec('DROP TABLE IF EXISTS morning_routine_logs');
  await db.exec('DROP TABLE IF EXISTS morning_routine_steps');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS wishes (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, type TEXT CHECK(type IN ('shop', 'savings', 'lottery')) NOT NULL, title TEXT NOT NULL, cost INTEGER DEFAULT 0, targetAmount INTEGER DEFAULT 0, currentAmount INTEGER DEFAULT 0, icon TEXT, stock INTEGER DEFAULT -1, rarity TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  // 添加稀有度字段（如果不存在）
  try { await db.run('ALTER TABLE wishes ADD COLUMN rarity TEXT'); } catch (e) {}
  // 抽奖奖品效果类型：null/普通 | draw_again 再抽一次 | bonus_coins 金币到账 | bonus_xp 等级经验到账 | bonus_privilege 特权点到账
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
  // 新增：特权层级（bronze, silver, gold, diamond）
  try { await db.run('ALTER TABLE privileges ADD COLUMN level TEXT DEFAULT "bronze"'); } catch (e) {}
  // 新增：使用时间限制（JSON格式）
  try { await db.run('ALTER TABLE wishes ADD COLUMN timeWindow TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE privileges ADD COLUMN timeWindow TEXT'); } catch (e) {}
  // 新增：特权分类（时间、家务、娱乐、外出、特殊、其他）
  try { await db.run('ALTER TABLE privileges ADD COLUMN category TEXT DEFAULT "其他"'); } catch (e) {}
  await db.exec(`
    CREATE TABLE IF NOT EXISTS achievement_defs (
      id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT NOT NULL, description TEXT, icon TEXT, conditionType TEXT NOT NULL, conditionValue INTEGER DEFAULT 0, conditionCategory TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  // 添加 conditionCategory 字段（如果不存在）- 用于 category_count 和 streak_days 类型
  try { await db.run('ALTER TABLE achievement_defs ADD COLUMN conditionCategory TEXT'); } catch (e) {}
  // 新增：成就展示分类与达成奖励
  try { await db.run('ALTER TABLE achievement_defs ADD COLUMN category TEXT DEFAULT "成长"'); } catch (e) {}
  try { await db.run('ALTER TABLE achievement_defs ADD COLUMN rewardCoins INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE achievement_defs ADD COLUMN rewardXp INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE achievement_defs ADD COLUMN rewardPrivilegePoints INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE achievement_defs ADD COLUMN rewardDelivery TEXT DEFAULT "instant"'); } catch (e) {}

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY,
      childId TEXT NOT NULL,
      achievementId TEXT NOT NULL,
      unlockedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      rewardClaimedAt DATETIME,
      rewardInventoryId TEXT,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 登录奖励字段
  try { await db.run('ALTER TABLE users ADD COLUMN lastLoginDate TEXT'); } catch (e) {}
  try { await db.run('ALTER TABLE users ADD COLUMN loginStreak INTEGER DEFAULT 0'); } catch (e) {}

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
  // 成就礼包奖励字段
  try { await db.run('ALTER TABLE user_inventory ADD COLUMN rewardCoins INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE user_inventory ADD COLUMN rewardXp INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE user_inventory ADD COLUMN rewardPrivilegePoints INTEGER DEFAULT 0'); } catch (e) {}
  try { await db.run('ALTER TABLE user_achievements ADD COLUMN rewardClaimedAt DATETIME'); } catch (e) {}
  try { await db.run('ALTER TABLE user_achievements ADD COLUMN rewardInventoryId TEXT'); } catch (e) {}

  // 迁移：扩展库存状态约束，兼容 used/transferring 等当前业务状态
  try {
    const tableInfo = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_inventory'");
    const needsMigration = tableInfo?.sql && (
      !tableInfo.sql.includes("'transferring'") ||
      !tableInfo.sql.includes("'used'")
    );

    if (needsMigration) {
      console.log('📦 Migrating user_inventory status constraint...');
      await db.run('DROP TABLE IF EXISTS user_inventory_new');
      await db.run(`
        CREATE TABLE user_inventory_new (
          id TEXT PRIMARY KEY,
          childId TEXT NOT NULL,
          wishId TEXT,
          privilegeId TEXT,
          title TEXT NOT NULL,
          icon TEXT,
          status TEXT CHECK(status IN ('pending', 'redeemed', 'cancelled', 'used', 'unused', 'returned', 'transferring')) DEFAULT 'pending',
          cost INTEGER DEFAULT 0,
          costType TEXT CHECK(costType IN ('coins', 'privilegePoints')) DEFAULT 'coins',
          acquiredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          redeemedAt DATETIME,
          source TEXT DEFAULT 'shop',
          cancelCount INTEGER DEFAULT 0,
          rewardCoins INTEGER DEFAULT 0,
          rewardXp INTEGER DEFAULT 0,
          rewardPrivilegePoints INTEGER DEFAULT 0,
          FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      await db.run(`
        INSERT INTO user_inventory_new (
          id, childId, wishId, privilegeId, title, icon, status, cost,
          costType, acquiredAt, redeemedAt, source, cancelCount,
          rewardCoins, rewardXp, rewardPrivilegePoints
        )
        SELECT
          id, childId, wishId, privilegeId, title, icon, status, cost,
          costType, acquiredAt, redeemedAt, COALESCE(source, 'shop'), COALESCE(cancelCount, 0),
          COALESCE(rewardCoins, 0), COALESCE(rewardXp, 0), COALESCE(rewardPrivilegePoints, 0)
        FROM user_inventory
      `);
      await db.run('DROP TABLE user_inventory');
      await db.run('ALTER TABLE user_inventory_new RENAME TO user_inventory');
      console.log('✅ user_inventory status constraint migration completed');
    }
  } catch (e) {
    console.error('⚠️ user_inventory status constraint migration failed:', e);
    throw e;
  }

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
      isRead INTEGER DEFAULT 0,
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

  // 宝箱设置表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chest_settings (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL UNIQUE,
      isEnabled INTEGER DEFAULT 1,
      triggerMode TEXT DEFAULT 'random',
      easyChance REAL DEFAULT 0.25,
      mediumChance REAL DEFAULT 0.50,
      hardChance REAL DEFAULT 0.75,
      guaranteeCount INTEGER DEFAULT 5,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);
  try { await db.run('ALTER TABLE chest_settings ADD COLUMN updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP'); } catch (e) {}

  // 宝箱记录表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chest_records (
      id TEXT PRIMARY KEY,
      childId TEXT NOT NULL,
      familyId TEXT NOT NULL,
      taskEntryId TEXT,
      rewardId TEXT,
      rewardName TEXT NOT NULL,
      rewardType TEXT NOT NULL,
      rewardValue INTEGER NOT NULL,
      rewardRarity TEXT DEFAULT 'common',
      rewardIcon TEXT DEFAULT '🎁',
      status TEXT DEFAULT 'pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (taskEntryId) REFERENCES task_entries(id) ON DELETE SET NULL,
      FOREIGN KEY (rewardId) REFERENCES reward_pools(id) ON DELETE SET NULL
    )
  `);

  try {
    // 为老数据补充 status 字段（默认为 granted，因为之前的都是发完的）
    await db.exec(`ALTER TABLE chest_records ADD COLUMN status TEXT DEFAULT 'granted'`);
    console.log('✅ chest_records status column added');
  } catch (e) {
    // 忽略错误，说明字段已存在
  }

  // 家庭目标设置表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS family_goals (
      id TEXT PRIMARY KEY,
      familyId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      targetAmount INTEGER NOT NULL,
      currentAmount INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('active', 'completed')) DEFAULT 'active',
      icon TEXT DEFAULT '🏆',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (familyId) REFERENCES families(id) ON DELETE CASCADE
    )
  `);

  // 家庭目标贡献记录表
  await db.exec(`
    CREATE TABLE IF NOT EXISTS family_goal_contributions (
      id TEXT PRIMARY KEY,
      goalId TEXT NOT NULL,
      childId TEXT NOT NULL,
      amount INTEGER NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (goalId) REFERENCES family_goals(id) ON DELETE CASCADE,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 创建索引以提升查询性能
  console.log('📦 Creating indexes...');
  try {
    // users 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_users_familyId ON users(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_auth_sms_codes_phone_purpose ON auth_sms_codes(phone, purpose)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_auth_sms_codes_active ON auth_sms_codes(phone, purpose, consumedAt, expiresAt)');

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
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_sessions_childId_status ON task_sessions(childId, status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_sessions_familyId_status ON task_sessions(familyId, status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_sessions_taskId_status ON task_sessions(taskId, status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_task_sessions_startedAt ON task_sessions(startedAt)');

    // learning 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_learning_quests_familyId ON learning_quests(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_learning_quests_familyId_active ON learning_quests(familyId, isActive)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_learning_steps_questId ON learning_steps(questId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_learning_sessions_childId ON learning_sessions(childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_learning_sessions_questId ON learning_sessions(questId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_learning_sessions_status ON learning_sessions(status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_emotion_checkins_familyId ON emotion_checkins(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_emotion_checkins_childId ON emotion_checkins(childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_emotion_checkins_createdAt ON emotion_checkins(createdAt)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_screen_time_ledger_familyId_childId ON screen_time_ledger(familyId, childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_screen_time_ledger_createdAt ON screen_time_ledger(createdAt)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_screen_time_ledger_source ON screen_time_ledger(source)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_screen_time_ledger_taskEntryId ON screen_time_ledger(taskEntryId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_screen_time_ledger_learningSessionId ON screen_time_ledger(learningSessionId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_screen_time_sessions_familyId_childId ON screen_time_sessions(familyId, childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_screen_time_sessions_status ON screen_time_sessions(status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_breakfast_items_familyId ON breakfast_items(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_breakfast_orders_familyId_childId ON breakfast_orders(familyId, childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_breakfast_orders_orderDate ON breakfast_orders(orderDate)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_breakfast_plans_familyId_date ON breakfast_plans(familyId, planDate)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_breakfast_plans_childId_date ON breakfast_plans(childId, planDate)');

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

    // chest_records 表索引
    await db.run('CREATE INDEX IF NOT EXISTS idx_chest_records_childId ON chest_records(childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_chest_records_familyId ON chest_records(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_explore_places_familyId ON explore_places(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_explore_places_status ON explore_places(status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_explore_places_familyId_status ON explore_places(familyId, status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_explore_checkins_familyId ON explore_checkins(familyId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_explore_checkins_childId ON explore_checkins(childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_explore_checkins_familyId_childId ON explore_checkins(familyId, childId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_explore_checkins_placeId ON explore_checkins(placeId)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_explore_media_checkinId ON explore_media(checkinId)');

    console.log('✅ Database indexes created');
  } catch (e) {
    console.log('⚠️ Some indexes may already exist, continuing...');
  }
};
