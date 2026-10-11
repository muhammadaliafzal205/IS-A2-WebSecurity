const crypto = require("node:crypto");
const db = require("./db");

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);

  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (username, email, role)
  VALUES (?, ?, ?)
`);

const insertCredential = db.prepare(`
  INSERT OR IGNORE INTO credentials (user_id, password_hash)
  VALUES (?, ?)
`);

const insertPatient = db.prepare(`
  INSERT OR IGNORE INTO patients (patient_number, display_name, date_of_birth)
  VALUES (?, ?, ?)
`);

const insertNote = db.prepare(`
  INSERT OR IGNORE INTO notes (id, patient_id, author_id, body)
  VALUES (?, ?, ?, ?)
`);

const seed = db.transaction(() => {
  insertUser.run("demo-admin", "admin@example.test", "admin");
  insertUser.run("demo-clinician", "clinician@example.test", "clinician");

  const admin = db.prepare("SELECT id FROM users WHERE username = ?")
    .get("demo-admin");
  const clinician = db.prepare("SELECT id FROM users WHERE username = ?")
    .get("demo-clinician");

  insertCredential.run(admin.id, hashPassword("DemoPass!2026"));
  insertCredential.run(clinician.id, hashPassword("DemoPass!2026"));

  insertPatient.run("TRAINING-001", "Alex Example", "1980-01-01");
  insertPatient.run("TRAINING-002", "Jordan Sample", "1990-06-15");

  const patient = db.prepare(
    "SELECT id FROM patients WHERE patient_number = ?"
  ).get("TRAINING-001");

  insertNote.run(
    1,
    patient.id,
    clinician.id,
    "Synthetic training note. Do not use real patient information."
  );
});

seed();

console.log("Synthetic demo records added.");
console.log("Demo usernames: demo-admin, demo-clinician");
console.log("Demo password: DemoPass!2026");
console.log("These accounts are for local training only.");

db.close();
