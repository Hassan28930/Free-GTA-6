import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analytics } from './analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const CONFIG_PATH = path.join(__dirname, 'config.json');
const HTML_PATH = path.join(__dirname, 'public', 'index.html');

// Admin credentials & brute-force protection
const ADMIN_GMAIL = 'muhammadhassan28930@gmail.com';
const ADMIN_NAME = 'muhammad hassan';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Hassan6909%';
const MAX_WRONG_ATTEMPTS = 3;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
const ADMIN_COOKIE = 'playgta_admin_session';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`playgta-admin-${process.cwd()}`).digest('hex');

// Map<ip, { count: number, lockedUntil: number }>
const loginAttempts = new Map();

const app = express();
app.set('trust proxy', true);
app.use(compression());
app.use(express.json());
app.use(express.text({ type: 'text/plain' })); // support sendBeacon text/plain

let ytCache = { fetchedAt: 0, data: null };

function extractYouTubeId(input = '') {
  const s = String(input).trim();
  if (!s) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || '';
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : '';
    }
    if (host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['live', 'embed', 'shorts', 'v'].includes(parts[0])) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : '';
      }
    }
  } catch {
    return '';
  }
  return '';
}

function loadConfig() {
  const fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const youtubeStreamUrl = process.env.YOUTUBE_VIDEO_URL || fileCfg.youtubeStreamUrl || '';
  const youtubeApiKey = process.env.YOUTUBE_API_KEY || fileCfg.youtubeApiKey || '';
  const shortlinkUrl =
    process.env.SHORTLINK_URL ||
    fileCfg.shortlinkUrl ||
    fileCfg.finalPlayUrl ||
    'https://example.com/shortlink-skip-ad';

  return {
    ...fileCfg,
    youtubeStreamUrl,
    youtubeVideoId: extractYouTubeId(youtubeStreamUrl),
    youtubeApiKey,
    shortlinkUrl,
  };
}

function saveConfigFile(patch) {
  const current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (typeof patch.youtubeStreamUrl === 'string') {
    current.youtubeStreamUrl = patch.youtubeStreamUrl.trim();
  }
  if (typeof patch.youtubeApiKey === 'string') {
    if (patch.youtubeApiKey.trim() === '') {
      current.youtubeApiKey = '';
    } else if (!patch.youtubeApiKey.includes('••••')) {
      current.youtubeApiKey = patch.youtubeApiKey.trim();
    }
  }
  if (typeof patch.streamTitle === 'string' && patch.streamTitle.trim()) {
    current.streamTitle = patch.streamTitle.trim().slice(0, 120);
  }
  if (typeof patch.shortlinkUrl === 'string' && patch.shortlinkUrl.trim()) {
    current.shortlinkUrl = patch.shortlinkUrl.trim();
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2), 'utf8');
  ytCache = { fetchedAt: 0, data: null };
  return loadConfig();
}

async function getYouTubeLiveStats(videoId, apiKey) {
  if (!videoId || !apiKey) return null;
  if (ytCache.data && Date.now() - ytCache.fetchedAt < 30_000) {
    return ytCache.data;
  }
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,liveStreamingDetails');
    url.searchParams.set('id', videoId);
    url.searchParams.set('key', apiKey);
    const res = await fetch(url.toString());
    const json = await res.json();
    const item = json?.items?.[0];
    if (!res.ok || !item) return null;
    const data = {
      title: item.snippet?.title || '',
      concurrentViewers: item.liveStreamingDetails?.concurrentViewers
        ? Number(item.liveStreamingDetails.concurrentViewers)
        : null,
    };
    ytCache = { fetchedAt: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}

function getOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function getClientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}

function signAdminToken(email) {
  const payload = {
    email,
    role: 'admin',
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };
  const enc = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(enc).digest('base64url');
  return `${enc}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [enc, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(enc).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(enc, 'base64url').toString('utf8'));
    if (decoded.exp && Date.now() > decoded.exp) return null;
    if (decoded.role !== 'admin' || decoded.email !== ADMIN_GMAIL) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function getAdminFromRequest(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const t = verifyAdminToken(auth.slice(7).trim());
    if (t) return t;
  }
  const cookies = parseCookies(req.headers.cookie || '');
  return verifyAdminToken(cookies[ADMIN_COOKIE]);
}

function requireAdmin(req, res, next) {
  const admin = getAdminFromRequest(req);
  if (!admin) {
    return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
  }
  req.admin = admin;
  next();
}

const FAQ_ITEMS = [
  {
    q: 'How do I join and play GTA 6 for free?',
    a: 'Watch the live stream player, click the "Join Queue / Play GTA 6 Free" button, and click "Skip ad to continue" to complete the shortlink and open your free GTA VI play link.',
  },
  {
    q: 'When did Grand Theft Auto VI (GTA 6) launch and where is it set?',
    a: 'Rockstar Games released Grand Theft Auto VI on November 19, 2026 for PlayStation 5 and Xbox Series X|S, set across Vice City and the State of Leonida with protagonists Jason Duval and Lucia Caminos.',
  },
  {
    q: 'Is the live watching count updated in real time?',
    a: 'Yes. The live watching badge displays real-time concurrent viewers from the live YouTube stream via the YouTube Data API.',
  },
];

// SEO routes
app.get('/robots.txt', (req, res) => {
  const origin = getOrigin(req);
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      '',
      'User-agent: GPTBot',
      'Allow: /',
      '',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
      `Sitemap: ${origin}/sitemap.xml`,
    ].join('\n')
  );
});

app.get('/sitemap.xml', (req, res) => {
  const origin = getOrigin(req);
  const today = new Date().toISOString().split('T')[0];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>always</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

// Public stream info (API key stays server-side)
app.get('/api/stream-info', async (_req, res) => {
  const cfg = loadConfig();
  const ytStats = await getYouTubeLiveStats(cfg.youtubeVideoId, cfg.youtubeApiKey);
  const liveWatching =
    ytStats?.concurrentViewers ??
    (cfg.liveWatching || 2639) + Math.floor(Math.sin(Date.now() / 10000) * 6);

  res.json({
    siteName: cfg.siteName,
    streamTitle: ytStats?.title || cfg.streamTitle,
    youtubeVideoId: cfg.youtubeVideoId,
    liveWatching,
    shortlinkUrl: cfg.shortlinkUrl,
  });
});

// Lightweight analytics tracking endpoint
app.post('/api/track', (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    analytics.trackEvent({
      sessionId: body.sessionId,
      event: body.event,
      step: body.step,
      staySeconds: body.staySeconds,
    });
  } catch {
    // ignore malformed tracking beacon
  }
  res.json({ ok: true });
});

// ---------------- ADMIN AUTH & DASHBOARD ----------------
app.get('/api/admin/me', (req, res) => {
  const admin = getAdminFromRequest(req);
  res.json({ ok: true, authenticated: Boolean(admin), admin: admin || null });
});

app.post('/api/admin/login', (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  let rec = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };

  // Reset automatically after 10 minutes
  if (rec.lockedUntil && now >= rec.lockedUntil) {
    rec = { count: 0, lockedUntil: 0 };
    loginAttempts.set(ip, rec);
  }

  if (rec.lockedUntil && now < rec.lockedUntil) {
    const remainingSeconds = Math.ceil((rec.lockedUntil - now) / 1000);
    return res.status(429).json({
      ok: false,
      locked: true,
      remainingSeconds,
      error: `Too many wrong attempts (3/3). Please wait ${Math.ceil(remainingSeconds / 60)} min before trying again.`,
    });
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const password = String(req.body?.password || '').trim();

  const valid =
    email === ADMIN_GMAIL &&
    name === ADMIN_NAME &&
    password === ADMIN_PASSWORD;

  if (!valid) {
    rec.count += 1;
    if (rec.count >= MAX_WRONG_ATTEMPTS) {
      rec.lockedUntil = now + LOCKOUT_MS;
      loginAttempts.set(ip, rec);
      return res.status(429).json({
        ok: false,
        locked: true,
        remainingSeconds: Math.ceil(LOCKOUT_MS / 1000),
        error: '3 wrong login attempts reached. Admin login locked for 10 minutes.',
      });
    }
    loginAttempts.set(ip, rec);
    const attemptsLeft = MAX_WRONG_ATTEMPTS - rec.count;
    return res.status(401).json({
      ok: false,
      locked: false,
      attemptsLeft,
      error: `Invalid Admin credentials. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before 10-minute lockout.`,
    });
  }

  // Success — clear attempts and issue HttpOnly cookie + token
  loginAttempts.delete(ip);
  const token = signAdminToken(ADMIN_GMAIL);
  const isHttps = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  const cookieFlags = isHttps
    ? 'Path=/; HttpOnly; SameSite=None; Secure; Max-Age=86400'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=86400';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags}`
  );
  res.json({ ok: true, token, admin: { email: ADMIN_GMAIL, name: 'Muhammad Hassan' } });
});

app.post('/api/admin/logout', (req, res) => {
  const isHttps = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  const cookieFlags = isHttps
    ? 'Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=; ${cookieFlags}`
  );
  res.json({ ok: true });
});

app.get('/api/admin/dashboard', requireAdmin, (_req, res) => {
  const cfg = loadConfig();
  const key = cfg.youtubeApiKey || '';
  res.json({
    ok: true,
    analytics: analytics.getSummary(),
    config: {
      youtubeStreamUrl: cfg.youtubeStreamUrl,
      youtubeVideoId: cfg.youtubeVideoId,
      hasYoutubeApiKey: Boolean(key),
      maskedYoutubeApiKey: key ? `${key.slice(0, 5)}••••••${key.slice(-4)}` : '',
      streamTitle: cfg.streamTitle,
      shortlinkUrl: cfg.shortlinkUrl,
    },
  });
});

app.post('/api/admin/config', requireAdmin, (req, res) => {
  const updated = saveConfigFile(req.body || {});
  const key = updated.youtubeApiKey || '';
  res.json({
    ok: true,
    config: {
      youtubeStreamUrl: updated.youtubeStreamUrl,
      youtubeVideoId: updated.youtubeVideoId,
      hasYoutubeApiKey: Boolean(key),
      maskedYoutubeApiKey: key ? `${key.slice(0, 5)}••••••${key.slice(-4)}` : '',
      streamTitle: updated.streamTitle,
      shortlinkUrl: updated.shortlinkUrl,
    },
  });
});

// Serve SEO-injected index.html
app.get('/', (req, res) => {
  const origin = getOrigin(req);
  const rawHtml = fs.readFileSync(HTML_PATH, 'utf8');
  const title = 'Play GTA 6 Free Live Stream | Watch & Join Queue — PlayGTA';
  const description =
    'Watch the Grand Theft Auto VI (GTA 6) live stream in Vice City & Leonida, see live watching viewers, and click Join Queue / Play GTA 6 Free to unlock access.';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'PlayGTA',
        url: `${origin}/`,
        description,
      },
      {
        '@type': 'VideoGame',
        name: 'Grand Theft Auto VI',
        alternateName: 'GTA 6',
        datePublished: '2026-11-19',
        gamePlatform: ['PlayStation 5', 'Xbox Series X|S'],
        genre: ['Action-adventure', 'Open world'],
        gameLocation: {
          '@type': 'Place',
          name: 'Vice City, State of Leonida',
        },
        publisher: {
          '@type': 'Organization',
          name: 'Rockstar Games',
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ_ITEMS.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.a,
          },
        })),
      },
    ],
  };

  const seoMeta = `
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta name="keywords" content="Play GTA 6 Free, GTA 6 Live Stream, Grand Theft Auto VI Vice City Leonida, Join Queue GTA 6" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href="${origin}/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${origin}/" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

  res.type('html').send(rawHtml.replace('<!--SEO_META-->', seoMeta));
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PlayGTA Simple Stream + Admin Analytics running on http://0.0.0.0:${PORT}`);
});
