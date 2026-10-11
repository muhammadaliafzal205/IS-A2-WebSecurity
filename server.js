const express = require("express");
const path = require("node:path");
const crypto = require("node:crypto");
const createDOMPurify = require("dompurify");
const { JSDOM } = require("jsdom");
const db = require("./db");

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const mode = (process.env.SECURITY_MODE || "safe").toLowerCase();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const csrfTokens = new Set();

if (!["safe", "vulnerable"].includes(mode)) {
  console.error('SECURITY_MODE must be either "safe" or "vulnerable".');
  process.exit(1);
}

if (mode === "vulnerable" && host !== "127.0.0.1" && host !== "localhost") {
  console.error("Vulnerable mode may only bind to localhost.");
  process.exit(1);
}

function sanitizeHtml(value) {
  return DOMPurify.sanitize(String(value ?? ""));
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const sep = storedHash.indexOf(":");
  if (sep === -1) return false;
  const salt = Buffer.from(storedHash.slice(0, sep), "hex");
  const expected = storedHash.slice(sep + 1);
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return derived === expected;
}

function generateCsrfToken() {
  const token = crypto.randomBytes(32).toString("hex");
  csrfTokens.add(token);
  return token;
}

function validateCsrfToken(token) {
  if (!token || !csrfTokens.has(token)) return false;
  csrfTokens.delete(token);
  return true;
}

// ---------- Health ----------
app.get("/api/health", (_req, res) => {
  try {
    const result = db.prepare("SELECT 1 AS database_ok").get();
    res.json({
      status: "ok",
      mode,
      database: result.database_ok === 1 ? "connected" : "error"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", mode, database: "unavailable" });
  }
});

// ---------- CSRF token ----------
app.get("/api/csrf-token", (_req, res) => {
  res.json({ token: generateCsrfToken() });
});

// ---------- Patients ----------
app.get("/api/patients", (_req, res) => {
  const rows = db.prepare(
    "SELECT id, patient_number, display_name, date_of_birth FROM patients ORDER BY display_name ASC"
  ).all();
  res.json(rows);
});

// ---------- Notes (Stored XSS + Reflected XSS) ----------
app.get("/api/notes", (_req, res) => {
  const rows = db.prepare(`
    SELECT n.id, n.body, n.created_at, p.display_name AS patient_name, u.username AS author_name
    FROM notes n
    JOIN patients p ON p.id = n.patient_id
    JOIN users u ON u.id = n.author_id
    ORDER BY n.created_at DESC
    LIMIT 20
  `).all();

  res.json(rows.map((row) => ({
    ...row,
    body: mode === "vulnerable" ? row.body : sanitizeHtml(row.body)
  })));
});

app.post("/api/notes", (req, res) => {
  const noteText = String(req.body.text ?? "");
  const author = db.prepare("SELECT id FROM users WHERE username = ?").get("demo-clinician");
  const patient = db.prepare("SELECT id FROM patients WHERE patient_number = ?").get("TRAINING-001");

  if (!author || !patient) {
    return res.status(500).json({ error: "Missing demo data." });
  }

  const storedValue = mode === "vulnerable" ? noteText : sanitizeHtml(noteText);

  db.prepare(`
    INSERT INTO notes (patient_id, author_id, body)
    VALUES (?, ?, ?)
  `).run(patient.id, author.id, storedValue);

  res.json({ success: true, stored: storedValue });
});

// ---------- Search (Reflected XSS) ----------
app.get("/api/search", (req, res) => {
  const query = String(req.query.q ?? "");

  if (mode === "vulnerable") {
    return res.json({
      query,
      results: [{ patient_name: "Reflected XSS demo", body: query }]
    });
  }

  const results = db.prepare(`
    SELECT n.id, n.body, p.display_name AS patient_name
    FROM notes n
    JOIN patients p ON p.id = n.patient_id
    WHERE n.body LIKE ?
    ORDER BY n.created_at DESC
  `).all(`%${query}%`);

  res.json({
    query,
    results: results.map((row) => ({ ...row, body: sanitizeHtml(row.body) }))
  });
});

// ---------- Login (SQLi Easy) ----------
app.post("/api/login", (req, res) => {
  const username = String(req.body.username ?? "");
  const password = String(req.body.password ?? "");

  if (mode === "vulnerable") {
    const sql = `SELECT u.id, u.username, u.email, u.role FROM users u WHERE u.username = '${username}'`;
    const row = db.prepare(sql).get();
    if (!row) return res.status(401).json({ success: false, error: "Invalid credentials." });
    return res.json({ success: true, user: { id: row.id, username: row.username, email: row.email, role: row.role } });
  }

  const row = db.prepare(`
    SELECT u.id, u.username, u.email, u.role, c.password_hash
    FROM users u
    JOIN credentials c ON c.user_id = u.id
    WHERE u.username = ?
  `).get(username);

  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ success: false, error: "Invalid credentials." });
  }

  res.json({ success: true, user: { id: row.id, username: row.username, email: row.email, role: row.role } });
});

// ---------- Change Email (CSRF) ----------
app.post("/api/change-email", (req, res) => {
  const newEmail = String(req.body.email ?? "");

  if (mode === "safe") {
    const token = String(req.body._csrf ?? "");
    if (!validateCsrfToken(token)) {
      return res.status(403).json({ success: false, error: "CSRF token validation failed." });
    }
  }

  const user = db.prepare("SELECT id FROM users WHERE username = ?").get("demo-admin");
  if (user) {
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(newEmail, user.id);
  }

  return res.json({ success: true, email: newEmail });
});

// ---------- SQLi Easy ----------
app.get("/api/sql-easy", (req, res) => {
  const username = String(req.query.username ?? "");

  if (mode === "vulnerable") {
    const sql = `SELECT id, username, email, role FROM users WHERE username = '${username}'`;
    const rows = db.prepare(sql).all();
    return res.json({ mode, sql, rows });
  }

  const rows = db.prepare(`
    SELECT id, username, email, role FROM users WHERE username = ?
  `).all(username);

  res.json({ mode, sql: "SELECT id, username, email, role FROM users WHERE username = ?", rows });
});

// ---------- SQLi Intermediate ----------
app.get("/api/sql-intermediate", (req, res) => {
  const name = String(req.query.name ?? "");

  if (mode === "vulnerable") {
    const sql = `SELECT id, display_name, date_of_birth FROM patients WHERE display_name LIKE '%${name}%'`;
    const rows = db.prepare(sql).all();
    return res.json({ mode, sql, rows });
  }

  const rows = db.prepare(`
    SELECT id, display_name, date_of_birth FROM patients WHERE display_name LIKE ?
  `).all(`%${name}%`);

  res.json({ mode, sql: "SELECT ... WHERE display_name LIKE ?", rows });
});

// ---------- SQLi Advanced ----------
app.get("/api/sql-advanced", (req, res) => {
  const stage = String(req.query.stage ?? "tables");
  const table = String(req.query.table ?? "users");

  if (mode === "vulnerable") {
    if (stage === "tables") {
      const sql = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
      return res.json({ mode, stage, sql, rows: db.prepare(sql).all() });
    }
    if (stage === "columns") {
      const sql = `PRAGMA table_info(${table})`;
      return res.json({ mode, stage, table, sql, rows: db.prepare(sql).all() });
    }
    const sql = `SELECT * FROM ${table} LIMIT 5`;
    return res.json({ mode, stage: "data", table, sql, rows: db.prepare(sql).all() });
  }

  const allowedTables = new Set(["users", "patients", "notes", "credentials"]);
  if (!allowedTables.has(table)) {
    return res.status(400).json({ error: "Unsupported table name." });
  }

  const stageSqlMap = {
    tables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    columns: `PRAGMA table_info(${table})`,
    data: `SELECT * FROM ${table} LIMIT 5`
  };

  const sql = stageSqlMap[stage] || stageSqlMap.tables;
  const rows = db.prepare(sql).all();
  res.json({ mode, stage, table, sql, rows });
});

// ---------- Pages ----------
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/dom-demo", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "dom-demo.html"));
});

app.listen(port, host, () => {
  console.log(`Security Lab mode: ${mode}`);
  console.log(`Listening at http://${host}:${port}`);
});