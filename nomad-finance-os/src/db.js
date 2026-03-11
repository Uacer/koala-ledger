const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { DEFAULT_EXPENSE_CATEGORIES } = require("./constants");

function createDb(filename = ":memory:") {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(__dirname, "schema.sql");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
  runMigrations(db);
  return db;
}

function runMigrations(db) {
  ensureColumn(db, "accounts", "opening_balance", "NUMERIC NOT NULL DEFAULT 0");
}

function ensureColumn(db, table, column, ddl) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = rows.some((row) => row.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function ensureUserAndSeedDefaults(db, userId) {
  db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(userId);
  db.prepare(
    `
      INSERT OR IGNORE INTO user_settings (user_id, base_currency, timezone)
      VALUES (?, 'USD', 'UTC')
    `
  ).run(userId);

  const seedCategories = db.transaction(() => {
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM expense_category_l1 WHERE user_id = ?")
      .get(userId).count;
    if (count === 0) {
      const insertL1 = db.prepare(
        "INSERT INTO expense_category_l1 (user_id, name, is_default, active) VALUES (?, ?, 1, 1)"
      );
      const insertL2 = db.prepare(
        "INSERT INTO expense_category_l2 (user_id, l1_id, name, is_default, active) VALUES (?, ?, ?, 1, 1)"
      );
      for (const [l1Name, l2List] of Object.entries(DEFAULT_EXPENSE_CATEGORIES)) {
        const result = insertL1.run(userId, l1Name);
        const l1Id = Number(result.lastInsertRowid);
        for (const l2Name of l2List) {
          insertL2.run(userId, l1Id, l2Name);
        }
      }
    }
  });
  seedCategories();

}

function normalizeMonth(month) {
  if (!month) return new Date().toISOString().slice(0, 7);
  return month.slice(0, 7);
}

module.exports = {
  createDb,
  ensureUserAndSeedDefaults,
  normalizeMonth
};
