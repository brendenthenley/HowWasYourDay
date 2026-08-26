require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.PASSCODE || 'changeme';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev-secret-change-me';
const IS_PROD = process.env.NODE_ENV === 'production';

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ photos: [] }, null, 2));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));

function requireAuth(req, res, next) {
  if (req.signedCookies && req.signedCookies.auth === 'ok') return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
}

// Public: login page + login API
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'style.css'));
});

app.post('/api/login', (req, res) => {
  const { passcode } = req.body || {};
  if (typeof passcode === 'string' && passcode === PASSCODE) {
    res.cookie('auth', 'ok', {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'wrong passcode' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('auth');
  res.json({ ok: true });
});

// Everything below requires auth
app.use(requireAuth);

app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded photo files (protected)
app.get('/photos/:date/:filename', (req, res) => {
  const { date, filename } = req.params;
  if (!DATE_RE.test(date) || filename.includes('..') || filename.includes('/')) {
    return res.status(400).end();
  }
  const filePath = path.join(UPLOADS_DIR, date, filename);
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const date = DATE_RE.test(req.body.date) ? req.body.date : new Date().toISOString().slice(0, 10);
    const dir = path.join(UPLOADS_DIR, date);
    fs.mkdirSync(dir, { recursive: true });
    req._uploadDate = date;
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

app.post('/api/upload', upload.array('photos', 30), (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'no images received' });

  const date = req._uploadDate;
  const db = readDB();
  const now = new Date().toISOString();
  const created = files.map((f) => {
    const record = {
      id: crypto.randomUUID(),
      date,
      filename: f.filename,
      originalName: f.originalname,
      uploadedAt: now,
    };
    db.photos.push(record);
    return record;
  });
  writeDB(db);
  res.json({ ok: true, count: created.length });
});

app.get('/api/days', (req, res) => {
  const db = readDB();
  const counts = {};
  for (const p of db.photos) counts[p.date] = (counts[p.date] || 0) + 1;
  const days = Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json({ days });
});

app.get('/api/photos/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'bad date' });
  const db = readDB();
  const photos = db.photos
    .filter((p) => p.date === date)
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1))
    .map((p) => ({
      id: p.id,
      url: `/photos/${p.date}/${p.filename}`,
      originalName: p.originalName,
      uploadedAt: p.uploadedAt,
    }));
  res.json({ date, photos });
});

const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '7', 10);

function cleanupOldPhotos() {
  const db = readDB();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const keep = [];
  const staleDates = new Set();
  for (const p of db.photos) {
    if (p.date < cutoffStr) {
      staleDates.add(p.date);
      fs.unlink(path.join(UPLOADS_DIR, p.date, p.filename), () => {});
    } else {
      keep.push(p);
    }
  }

  if (keep.length === db.photos.length) return;
  db.photos = keep;
  writeDB(db);
  for (const date of staleDates) {
    const dir = path.join(UPLOADS_DIR, date);
    fs.readdir(dir, (err, files) => {
      if (!err && files.length === 0) fs.rmdir(dir, () => {});
    });
  }
  console.log(`Cleaned up photos older than ${cutoffStr}`);
}

cleanupOldPhotos();
setInterval(cleanupOldPhotos, 6 * 60 * 60 * 1000); // recheck every 6 hours

app.listen(PORT, () => {
  console.log(`Daily Photos running at http://localhost:${PORT}`);
});
