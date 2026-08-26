require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const PORT = process.env.PORT || 3000;
const PASSCODE = process.env.PASSCODE || 'changeme';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev-secret-change-me';
const IS_PROD = process.env.NODE_ENV === 'production';
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '7', 10);
const ROOT_FOLDER = 'daily-photos';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CLOUDINARY_CONFIGURED = Boolean(
  process.env.CLOUDINARY_URL ||
    (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

if (!CLOUDINARY_CONFIGURED) {
  console.warn('WARNING: Cloudinary is not configured. Uploads will fail until it is.');
} else if (!process.env.CLOUDINARY_URL) {
  // Not using the combined CLOUDINARY_URL var, so configure from the separate pieces.
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}
// If CLOUDINARY_URL is set, cloudinary.v2 auto-configures itself from it.

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

app.post('/api/upload', upload.array('photos', 30), async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'no images received' });

  const date = DATE_RE.test(req.body.date) ? req.body.date : new Date().toISOString().slice(0, 10);
  const folder = `${ROOT_FOLDER}/${date}`;

  try {
    await Promise.all(files.map((f) => uploadBufferToCloudinary(f.buffer, folder)));
    res.json({ ok: true, count: files.length });
  } catch (err) {
    console.error('Cloudinary upload failed:', err.message);
    res.status(502).json({ error: 'upload to storage failed' });
  }
});

app.get('/api/days', async (req, res) => {
  try {
    const { folders } = await cloudinary.api.sub_folders(ROOT_FOLDER).catch(() => ({ folders: [] }));
    const days = await Promise.all(
      folders
        .filter((f) => DATE_RE.test(f.name))
        .map(async (f) => {
          const result = await cloudinary.search
            .expression(`folder:"${f.path}"`)
            .max_results(1)
            .execute();
          return { date: f.name, count: result.total_count };
        })
    );
    days.sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json({ days: days.filter((d) => d.count > 0) });
  } catch (err) {
    console.error('Failed to list days:', err.message);
    res.status(502).json({ error: 'failed to reach photo storage' });
  }
});

app.get('/api/photos/:date', async (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'bad date' });
  try {
    const result = await cloudinary.search
      .expression(`folder:"${ROOT_FOLDER}/${date}"`)
      .sort_by('created_at', 'asc')
      .max_results(500)
      .execute();
    const photos = (result.resources || []).map((r) => ({
      id: r.asset_id,
      url: r.secure_url,
      uploadedAt: r.created_at,
    }));
    res.json({ date, photos });
  } catch (err) {
    console.error('Failed to list photos:', err.message);
    res.status(502).json({ error: 'failed to reach photo storage' });
  }
});

async function cleanupOldPhotos() {
  try {
    const { folders } = await cloudinary.api.sub_folders(ROOT_FOLDER).catch(() => ({ folders: [] }));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const f of folders) {
      if (DATE_RE.test(f.name) && f.name < cutoffStr) {
        await cloudinary.api.delete_resources_by_prefix(`${f.path}/`);
        await cloudinary.api.delete_folder(f.path).catch(() => {});
        console.log(`Cleaned up photos for ${f.name}`);
      }
    }
  } catch (err) {
    console.error('Cleanup failed:', err.message);
  }
}

if (CLOUDINARY_CONFIGURED) {
  cleanupOldPhotos();
  setInterval(cleanupOldPhotos, 6 * 60 * 60 * 1000); // recheck every 6 hours
}

app.listen(PORT, () => {
  console.log(`Daily Photos running at http://localhost:${PORT}`);
});
