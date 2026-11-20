import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const ANALYTICS_PATH = path.join(DATA_DIR, 'analytics.json');

function createInitialAnalytics() {
  const now = Date.now();
  const hourMs = 3600_000;
  const hourly = [];
  const samplePattern = [
    { visits: 32, joins: 18, step4: 11, avgStay: 94 },
    { visits: 41, joins: 24, step4: 14, avgStay: 108 },
    { visits: 38, joins: 22, step4: 13, avgStay: 102 },
    { visits: 54, joins: 31, step4: 19, avgStay: 118 },
    { visits: 63, joins: 39, step4: 24, avgStay: 125 },
    { visits: 71, joins: 44, step4: 27, avgStay: 132 },
  ];

  for (let i = 0; i < 6; i++) {
    const ts = now - (5 - i) * hourMs;
    const d = new Date(ts);
    const label = `${String(d.getHours()).padStart(2, '0')}:00`;
    hourly.push({
      hourKey: `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`,
      label,
      ...samplePattern[i],
    });
  }

  return {
    totals: {
      pageViews: 299,
      uniqueSessions: 299,
      joinQueueClicks: 178,
      adStepsCompleted: {
        1: 152,
        2: 134,
        3: 119,
        4: 108,
      },
      finalPlayClicks: 104,
      totalStaySeconds: 34280,
      staySamples: 299,
    },
    hourly,
    sessions: [
      {
        sessionId: 'vis-9041a',
        startedAt: now - 420_000,
        lastSeenAt: now - 260_000,
        staySeconds: 160,
        clickedJoin: true,
        stepsCompleted: [1, 2, 3, 4],
        clickedFinalPlay: true,
      },
      {
        sessionId: 'vis-9042b',
        startedAt: now - 310_000,
        lastSeenAt: now - 215_000,
        staySeconds: 95,
        clickedJoin: true,
        stepsCompleted: [1, 2],
        clickedFinalPlay: false,
      },
      {
        sessionId: 'vis-9043c',
        startedAt: now - 190_000,
        lastSeenAt: now - 142_000,
        staySeconds: 48,
        clickedJoin: false,
        stepsCompleted: [],
        clickedFinalPlay: false,
      },
    ],
  };
}

class AnalyticsStore {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    this.data = this.load();
    this.saveTimer = null;
  }

  load() {
    try {
      if (fs.existsSync(ANALYTICS_PATH)) {
        return JSON.parse(fs.readFileSync(ANALYTICS_PATH, 'utf8'));
      }
    } catch {
      // fall through
    }
    const fresh = createInitialAnalytics();
    this.writeSync(fresh);
    return fresh;
  }

  writeSync(obj = this.data) {
    try {
      fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(obj), 'utf8');
    } catch (err) {
      console.error('Failed to write analytics.json:', err.message);
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeSync();
    }, 15_000);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.writeSync();
    }
  }

  getCurrentHourBucket() {
    const d = new Date();
    const hourKey = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
    const label = `${String(d.getHours()).padStart(2, '0')}:00`;
    let bucket = this.data.hourly.find((h) => h.hourKey === hourKey);
    if (!bucket) {
      bucket = { hourKey, label, visits: 0, joins: 0, step4: 0, avgStay: 0 };
      this.data.hourly.push(bucket);
      if (this.data.hourly.length > 12) {
        this.data.hourly = this.data.hourly.slice(-12);
      }
    }
    return bucket;
  }

  ensureSession(sessionId) {
    if (!sessionId) return null;
    let sess = this.data.sessions.find((s) => s.sessionId === sessionId);
    if (!sess) {
      sess = {
        sessionId: String(sessionId).slice(0, 32),
        startedAt: Date.now(),
        lastSeenAt: Date.now(),
        staySeconds: 0,
        clickedJoin: false,
        stepsCompleted: [],
        clickedFinalPlay: false,
      };
      this.data.sessions.unshift(sess);
      if (this.data.sessions.length > 100) {
        this.data.sessions = this.data.sessions.slice(0, 100);
      }
      this.data.totals.pageViews += 1;
      this.data.totals.uniqueSessions += 1;
      this.data.totals.staySamples += 1;
      const bucket = this.getCurrentHourBucket();
      bucket.visits += 1;
    }
    return sess;
  }

  trackEvent({ sessionId, event, step, staySeconds }) {
    const sess = this.ensureSession(sessionId);
    if (!sess) return;

    sess.lastSeenAt = Date.now();
    const bucket = this.getCurrentHourBucket();

    if (typeof staySeconds === 'number' && staySeconds > sess.staySeconds) {
      const delta = Math.min(300, Math.round(staySeconds - sess.staySeconds));
      sess.staySeconds += delta;
      this.data.totals.totalStaySeconds += delta;
      const avg = Math.round(
        this.data.totals.totalStaySeconds / Math.max(1, this.data.totals.staySamples)
      );
      bucket.avgStay = avg;
    }

    if (event === 'join_click') {
      if (!sess.clickedJoin) {
        sess.clickedJoin = true;
      }
      this.data.totals.joinQueueClicks += 1;
      bucket.joins += 1;
    } else if (event === 'ad_step_complete' && [1, 2, 3, 4].includes(Number(step))) {
      const sNum = Number(step);
      if (!sess.stepsCompleted.includes(sNum)) {
        sess.stepsCompleted.push(sNum);
        sess.stepsCompleted.sort((a, b) => a - b);
        this.data.totals.adStepsCompleted[sNum] =
          (this.data.totals.adStepsCompleted[sNum] || 0) + 1;
        if (sNum === 4) {
          bucket.step4 += 1;
        }
      }
    } else if (event === 'final_play_click') {
      if (!sess.clickedFinalPlay) {
        sess.clickedFinalPlay = true;
      }
      this.data.totals.finalPlayClicks += 1;
    }

    this.scheduleSave();
  }

  getSummary() {
    const t = this.data.totals;
    const avgStaySeconds = Math.round(
      t.totalStaySeconds / Math.max(1, t.staySamples)
    );
    const joinRate = t.pageViews
      ? Number(((t.joinQueueClicks / t.pageViews) * 100).toFixed(1))
      : 0;
    const completionRate = t.joinQueueClicks
      ? Number(((t.finalPlayClicks / t.joinQueueClicks) * 100).toFixed(1))
      : 0;

    return {
      totals: {
        ...t,
        avgStaySeconds,
        joinRate,
        completionRate,
      },
      hourly: this.data.hourly,
      recentSessions: this.data.sessions.slice(0, 20),
    };
  }
}

export const analytics = new AnalyticsStore();
