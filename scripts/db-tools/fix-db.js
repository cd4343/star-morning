// fix-db.js - 修复 user_inventory 表结构
// Database is in project root folder, which is ../.. from scripts/db-tools
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../../stellar.db');
const db = new sqlite3.Database(dbPath);

const runSql = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) { if (err) reject(err); else resolve(this); });
});
const allSql = (sql) => new Promise((resolve, reject) => {
  db.all(sql, (err, rows) => { if (err) reject(err); else resolve(rows); });
});

(async () => {
  try {
    console.log("开始修复 user_inventory 表...");
    
    // 获取现有数据
    let data = [];
    try {
      data = await allSql('SELECT * FROM user_inventory');
      console.log(`现有 ${data.length} 条数据`);
    } catch (e) {
      console.log("表不存在或无数据，将创建新表");
    }
    
    // 删除临时表（如果存在）
    await runSql('DROP TABLE IF EXISTS user_inventory_new');
    
    // 创建新表
    await runSql(`CREATE TABLE user_inventory_new (
      id TEXT PRIMARY KEY, 
      childId TEXT NOT NULL, 
      wishId TEXT, 
      privilegeId TEXT,
      title TEXT NOT NULL, 
      icon TEXT, 
      status TEXT DEFAULT 'pending',
      cost INTEGER DEFAULT 0, 
      costType TEXT DEFAULT 'coins', 
      source TEXT DEFAULT 'shop',
      cancelCount INTEGER DEFAULT 0, 
      acquiredAt DATETIME DEFAULT CURRENT_TIMESTAMP, 
      redeemedAt DATETIME
    )`);
    console.log("新表结构已创建");
    
    // 迁移数据
    for (const row of data) {
      let status = row.status;
      // 转换旧状态值
      if (status === 'unused') status = 'pending';
      if (status === 'used') status = 'redeemed';
      if (status === 'returned') status = 'cancelled';
      
      await runSql(`INSERT INTO user_inventory_new VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.id, row.childId, row.wishId, row.privilegeId, row.title, row.icon,
         status, row.cost || 0, row.costType || 'coins', row.source || 'shop', 
         row.cancelCount || 0, row.acquiredAt, row.redeemedAt]);
    }
    console.log(`已迁移 ${data.length} 条数据`);
    
    // 删除旧表
    await runSql('DROP TABLE IF EXISTS user_inventory');
    console.log("已删除旧表");
    
    // 重命名新表
    await runSql('ALTER TABLE user_inventory_new RENAME TO user_inventory');
    console.log("已重命名新表");
    
    console.log("✅ 数据库修复完成！");
    db.close();
  } catch (error) {
    console.error("❌ 修复失败:", error);
    db.close();
    process.exit(1);
  }
})();

