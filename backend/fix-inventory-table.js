const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../stellar.db');

console.log("开始修复 user_inventory 表的 CHECK 约束...\n");

const runSql = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const getSql = (sql) => new Promise((resolve, reject) => {
  db.get(sql, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const allSql = (sql) => new Promise((resolve, reject) => {
  db.all(sql, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

(async () => {
  try {
    // 1. 查看现有数据
    const existingData = await allSql('SELECT * FROM user_inventory');
    console.log(`现有 ${existingData.length} 条数据`);

    // 2. 创建临时表（无CHECK约束）
    await runSql(`CREATE TABLE IF NOT EXISTS user_inventory_new (
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
      redeemedAt DATETIME,
      FOREIGN KEY (childId) REFERENCES users(id) ON DELETE CASCADE
    )`);
    console.log("✅ 创建临时表");

    // 3. 复制数据并转换状态
    for (const row of existingData) {
      let newStatus = row.status;
      if (newStatus === 'unused') newStatus = 'pending';
      if (newStatus === 'used') newStatus = 'redeemed';
      if (newStatus === 'returned') newStatus = 'cancelled';
      
      await runSql(`INSERT INTO user_inventory_new 
        (id, childId, wishId, privilegeId, title, icon, status, cost, costType, source, cancelCount, acquiredAt, redeemedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        row.id, row.childId, row.wishId, row.privilegeId, row.title, row.icon,
        newStatus, row.cost || 0, row.costType || 'coins', row.source || 'shop',
        row.cancelCount || 0, row.acquiredAt, row.usedAt || row.redeemedAt
      ]);
    }
    console.log("✅ 迁移数据完成");

    // 4. 删除旧表
    await runSql(`DROP TABLE user_inventory`);
    console.log("✅ 删除旧表");

    // 5. 重命名新表
    await runSql(`ALTER TABLE user_inventory_new RENAME TO user_inventory`);
    console.log("✅ 重命名新表");

    // 6. 验证
    const newSchema = await getSql("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_inventory'");
    console.log("\n新表结构:");
    console.log(newSchema?.sql);

    const count = await getSql('SELECT COUNT(*) as count FROM user_inventory');
    console.log(`\n数据行数: ${count.count}`);
    
    console.log("\n✅ 修复完成！");
  } catch (err) {
    console.error("修复失败:", err);
  } finally {
    db.close();
  }
})();
