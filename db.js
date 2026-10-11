const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const projectRoot = path.join(__dirname, "..");
const dataDir = path.join(projectRoot, "data");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "app.sqlite"));
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

module.exports = db;
