// Kino-Abend – Server: Express + SQLite (libSQL) + sharp (Bild verkleinern)
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const PORT = process.env.PORT || 3000;

// Lokal: Datei data/kino.db. Online: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN setzen,
// dann liegen alle Daten in einer kostenlosen, dauerhaften Cloud-Datenbank.
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./data/kino.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const RATING_KEYS = ['story', 'acting', 'chem', 'side', 'music', 'trash', 'budget'];
const TEST_REVIEW_ID = 1;
const TEXT_KEYS = ['description', 'rike', 'hanna', 'parents_dead', 'stay_together', 'insider', 'budget_rike', 'budget_hanna'];

async function initDb() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS images (
       id INTEGER PRIMARY KEY AUTOINCREMENT, mime TEXT NOT NULL, data BLOB NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS reviews (
       id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, image_id INTEGER,
       ${TEXT_KEYS.map(k => k + ' TEXT').join(', ')},
       ${RATING_KEYS.map(k => 'r_' + k + ' REAL DEFAULT 0').join(', ')},
       created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS watchlist (
       id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, image_id INTEGER,
       seen INTEGER NOT NULL DEFAULT 0, seen_at INTEGER, created_at INTEGER NOT NULL)`,
  ], 'write');
}

// ---------- Hilfsfunktionen ----------
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
// Sterne: auf 0–10 begrenzen, in 0,5er-Schritten
const rating = v => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.min(10, Math.max(0, Math.round(n * 2) / 2)) : 0;
};
const plain = row => ({ ...row });
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

// Bild verkleinern (max. 800×1200 px, WebP) und in der Datenbank speichern
async function saveImage(file) {
  if (!file) return null;
  let buf;
  try {
    buf = await sharp(file.buffer).rotate()
      .resize({ width: 800, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 }).toBuffer();
  } catch {
    throw Object.assign(new Error('Das Bild konnte nicht gelesen werden. Versuch es mit JPG oder PNG.'), { status: 400 });
  }
  const r = await db.execute({ sql: 'INSERT INTO images (mime, data) VALUES (?, ?)', args: ['image/webp', buf] });
  return Number(r.lastInsertRowid);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true)
      : cb(Object.assign(new Error('Bitte nur Bilddateien hochladen.'), { status: 400 })),
});

// ---------- App ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Bild ausliefern (wird vom Browser lange zwischengespeichert)
app.get('/api/images/:id', wrap(async (req, res) => {
  const r = await db.execute({ sql: 'SELECT mime, data FROM images WHERE id = ?', args: [req.params.id] });
  if (!r.rows.length) return res.sendStatus(404);
  res.set({ 'Content-Type': r.rows[0].mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(Buffer.from(r.rows[0].data));
}));

// --- Bewertungen ---
app.get('/api/reviews', wrap(async (req, res) => {
  const r = await db.execute('SELECT id, title, image_id FROM reviews ORDER BY id DESC'); // neueste zuerst
  res.json(r.rows.map(plain));
}));

app.get('/api/reviews/:id', wrap(async (req, res) => {
  const r = await db.execute({ sql: 'SELECT * FROM reviews WHERE id = ?', args: [req.params.id] });
  if (!r.rows.length) return res.status(404).json({ error: 'Bewertung nicht gefunden.' });
  res.json(plain(r.rows[0]));
}));

// Ausschließlich die festgelegte Test-Bewertung löschen
app.delete('/api/reviews/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);

  if (id !== TEST_REVIEW_ID) {
    return res.status(403).json({
      error: 'Diese Bewertung darf nicht gelöscht werden.'
    });
  }

  const result = await db.execute({
    sql: 'DELETE FROM reviews WHERE id = ?',
    args: [TEST_REVIEW_ID]
  });

  if (result.rowsAffected === 0) {
    return res.status(404).json({
      error: 'Test-Bewertung nicht gefunden.'
    });
  }

  res.json({ ok: true });
}));

app.post('/api/reviews', upload.single('image'), wrap(async (req, res) => {
  const b = req.body;
  const title = txt(b.title, 200);
  if (!title) return res.status(400).json({ error: 'Bitte gib einen Filmnamen ein.' });
  const cols = { title, image_id: await saveImage(req.file) };
  TEXT_KEYS.forEach(k => (cols[k] = txt(b[k], 5000)));
  RATING_KEYS.forEach(k => (cols['r_' + k] = rating(b['r_' + k])));
  const keys = Object.keys(cols);
  const r = await db.execute({
    sql: `INSERT INTO reviews (${keys.join(', ')}, created_at) VALUES (${keys.map(() => '?').join(', ')}, ?)`,
    args: [...Object.values(cols), Date.now()],
  });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

// --- Watchlist ---
// Ungesehene oben (neueste zuerst), gesehene unten (zuletzt gesehener ganz am Ende)
app.get('/api/watchlist', wrap(async (req, res) => {
  const r = await db.execute(
    'SELECT id, title, image_id, seen FROM watchlist ORDER BY seen ASC, CASE seen WHEN 0 THEN -id ELSE seen_at END ASC');
  res.json(r.rows.map(plain));
}));

app.post('/api/watchlist', upload.single('image'), wrap(async (req, res) => {
  const title = txt(req.body.title, 200);
  if (!title) return res.status(400).json({ error: 'Bitte gib einen Titel ein.' });
  const imageId = await saveImage(req.file);
  const r = await db.execute({
    sql: 'INSERT INTO watchlist (title, image_id, created_at) VALUES (?, ?, ?)',
    args: [title, imageId, Date.now()],
  });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

app.post('/api/watchlist/:id/seen', wrap(async (req, res) => {
  const seen = req.body.seen ? 1 : 0;
  await db.execute({
    sql: 'UPDATE watchlist SET seen = ?, seen_at = ? WHERE id = ?',
    args: [seen, seen ? Date.now() : null, req.params.id],
  });
  res.json({ ok: true });
}));

// Fehler einheitlich als JSON zurückgeben
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500;
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Das Bild ist zu groß (max. 15 MB).'
    : status < 500 ? err.message : 'Serverfehler – bitte versuch es gleich nochmal.';
  res.status(status).json({ error: msg });
});

initDb().then(() => app.listen(PORT, () => console.log(`Kino-Abend läuft auf http://localhost:${PORT}`)))
  .catch(e => { console.error('Datenbank-Start fehlgeschlagen:', e); process.exit(1); });
