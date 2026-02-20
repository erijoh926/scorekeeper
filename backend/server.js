const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const initSqlJs = require("sql.js");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// ── AUTH ──────────────────────────────────────────────────────────────────────
// Store valid session tokens (in production, use Redis or similar)
const activeSessions = new Set();

function requireAdmin(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (token && activeSessions.has(token)) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ── DATABASE ──────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "survey.db");
let db;

// Persist the in-memory DB to disk after every write
function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helpers that mirror the better-sqlite3 API shape
function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] ?? null;
}

function insert(sql, params = []) {
  db.run(sql, params);
  const id = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];
  saveDb();
  return id;
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
async function start() {
  const SQL = await initSqlJs();

  // Load existing DB from disk or create fresh
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  // Schema
  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      text       TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS responses (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      score        INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS answers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      response_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      value       TEXT
    );
    CREATE TABLE IF NOT EXISTS admin (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL
    );
  `);
  saveDb();

  // Initialize admin password if not exists
  const adminExists = get("SELECT id FROM admin WHERE id = 1");
  if (!adminExists) {
    // Get password from env or use default (you should change this!)
    const defaultPassword = process.env.ADMIN_PASSWORD || "admin123";
    const hash = await bcrypt.hash(defaultPassword, 10);
    db.run("INSERT INTO admin (id, password_hash) VALUES (1, ?)", [hash]);
    saveDb();
    console.log("⚠️  Admin password initialized. Change ADMIN_PASSWORD env var in production!");
  }

  // Seed default questions if empty
  const count = get("SELECT COUNT(*) as n FROM questions");
  if (!count || Number(count.n) === 0) {
    const defaults = [
      "Route 1: Red Wall",
      "Route 2: Blue Corner",
      "Route 3: Yellow Overhang",
      "Route 4: Green Slab",
      "Route 5: Black Crack",
    ];
    defaults.forEach((text, i) => db.run("INSERT INTO questions (text, position) VALUES (?, ?)", [text, i]));
    saveDb();
  }

  // ── ROUTES ────────────────────────────────────────────────────────────────

  app.get("/health", (req, res) => res.json({ ok: true }));

  // Admin login
  app.post("/api/admin/login", async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });

    const admin = get("SELECT password_hash FROM admin WHERE id = 1");
    if (!admin) return res.status(500).json({ error: "Admin not configured" });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid password" });

    // Generate session token (in production, use crypto.randomBytes or JWT)
    const token = Date.now().toString(36) + Math.random().toString(36).substr(2);
    activeSessions.add(token);

    // Auto-expire after 24 hours
    setTimeout(() => activeSessions.delete(token), 24 * 60 * 60 * 1000);

    res.json({ token });
  });

  // Questions — public read
  app.get("/api/questions", (req, res) => {
    res.json(all("SELECT id, text, position FROM questions ORDER BY position ASC"));
  });

  // Leaderboard — public read (top 5)
  app.get("/api/leaderboard", (req, res) => {
    const top5 = all("SELECT name, score FROM responses ORDER BY score DESC LIMIT 5");
    res.json(top5);
  });

  // Questions — admin write
  app.post("/api/questions", requireAdmin, (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "text is required" });
    const maxRow = get("SELECT COALESCE(MAX(position), 0) as m FROM questions");
    const pos = Number(maxRow?.m ?? 0) + 1;
    const id = insert("INSERT INTO questions (text, position) VALUES (?, ?)", [text.trim(), pos]);
    res.json({ id, text: text.trim(), position: pos });
  });

  app.put("/api/questions/:id", requireAdmin, (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "text is required" });
    run("UPDATE questions SET text = ? WHERE id = ?", [text.trim(), req.params.id]);
    res.json({ ok: true });
  });

  app.delete("/api/questions/:id", requireAdmin, (req, res) => {
    run("DELETE FROM questions WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });

  // Responses — public submit
  app.post("/api/responses", (req, res) => {
    const { name, answers } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    if (!answers || typeof answers !== "object") return res.status(400).json({ error: "answers is required" });

    const score = Object.values(answers).reduce(
      (sum, val) => sum + (val === "topp" ? 2 : val === "flash" ? 3 : 0), 0
    );

    db.run("INSERT INTO responses (name, score) VALUES (?, ?)", [name.trim(), score]);
    const responseId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];

    for (const [qid, val] of Object.entries(answers)) {
      const safeVal = (val === "topp" || val === "flash") ? val : null;
      db.run("INSERT INTO answers (response_id, question_id, value) VALUES (?, ?, ?)",
        [responseId, Number(qid), safeVal]);
    }
    saveDb();

    res.json({ id: responseId, score });
  });

  // Responses — admin read
  app.get("/api/responses", requireAdmin, (req, res) => {
    const responses = all("SELECT id, name, score, submitted_at FROM responses ORDER BY submitted_at DESC");
    const answerRows = all("SELECT response_id, question_id, value FROM answers");

    const answerMap = {};
    for (const row of answerRows) {
      if (!answerMap[row.response_id]) answerMap[row.response_id] = {};
      answerMap[row.response_id][row.question_id] = row.value;
    }

    res.json(responses.map(r => ({ ...r, answers: answerMap[r.id] || {} })));
  });

  // Responses — admin delete
  app.delete("/api/responses/:id", requireAdmin, (req, res) => {
    run("DELETE FROM answers WHERE response_id = ?", [req.params.id]);
    run("DELETE FROM responses WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  });

  // Analytics — admin read
  app.get("/api/analytics", requireAdmin, (req, res) => {
    const questions = all("SELECT id, text FROM questions ORDER BY position ASC");
    const stats = questions.map(q => {
      const yes   = Number(get("SELECT COUNT(*) as n FROM answers WHERE question_id = ? AND value = 'topp'", [q.id])?.n ?? 0);
      const no    = Number(get("SELECT COUNT(*) as n FROM answers WHERE question_id = ? AND value = 'flash'",  [q.id])?.n ?? 0);
      const total = Number(get("SELECT COUNT(*) as n FROM answers WHERE question_id = ? AND value IS NOT NULL", [q.id])?.n ?? 0);
      return { ...q, yes, no, total };
    });
    const totalResponses = Number(get("SELECT COUNT(*) as n FROM responses")?.n ?? 0);
    res.json({ questions: stats, totalResponses });
  });

  // ── START ──────────────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`Survey API running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error("Failed to start:", err);
  process.exit(1);
});
