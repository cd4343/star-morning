const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('../stellar.db');
db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_inventory'", (err, row) => {
  console.log("Current table definition:");
  console.log(row?.sql);
  db.close();
});

