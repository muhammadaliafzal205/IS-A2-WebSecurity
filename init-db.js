const fs = require("node:fs");
const path = require("node:path");
const db = require("./db");

const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf8");

db.exec(schema);

console.log("Database schema initialized.");
db.close();
