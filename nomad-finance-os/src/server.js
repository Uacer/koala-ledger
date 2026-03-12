const fs = require("node:fs");
const path = require("node:path");

loadEnvFile(path.join(__dirname, "..", ".env"));
const { createDb } = require("./db");
const { createApp } = require("./app");

const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "nomad-finance.db");
const db = createDb(dbPath);
const app = createApp(db);

const port = Number.parseInt(process.env.PORT || "5001", 10);
app.listen(port, () => {
  console.log(`Nomad Finance OS API running on http://localhost:${port}`);
});

function loadEnvFile(filename) {
  if (!fs.existsSync(filename)) return;
  const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
