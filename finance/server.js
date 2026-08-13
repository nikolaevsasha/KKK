#!/usr/bin/env node
/*
 * Finch — self-hosted personal finance dashboard.
 * Zero-dependency Node.js server: static files + JSON API + cookie auth.
 * Run: node server.js   (PORT and DATA_DIR env vars optional)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8484', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 90;

/* ---------------------------------- store --------------------------------- */

const defaultDb = () => ({
  auth: null, // { salt, hash }
  sessions: {}, // token -> expiry epoch ms
  settings: { currency: 'USD', locale: 'en-US', name: '' },
  accounts: [],
  transactions: [],
  categories: [],
  budgets: {}, // categoryId -> monthly amount
  goals: [],
});

let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  db = defaultDb();
}
// Fill any missing top-level keys after upgrades.
for (const [k, v] of Object.entries(defaultDb())) {
  if (db[k] === undefined) db[k] = v;
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 150);
}
process.on('exit', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  }
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

const uid = () => crypto.randomBytes(8).toString('hex');

/* ---------------------------------- auth ---------------------------------- */

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = Date.now() + SESSION_DAYS * 864e5;
  // prune expired
  for (const [t, exp] of Object.entries(db.sessions)) {
    if (exp < Date.now()) delete db.sessions[t];
  }
  save();
  return token;
}

function sessionValid(req) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i).trim(), c.slice(i + 1).trim()];
    })
  );
  const token = cookies.finch_session;
  if (!token || !db.sessions[token]) return false;
  if (db.sessions[token] < Date.now()) {
    delete db.sessions[token];
    save();
    return false;
  }
  return true;
}

let failedLogins = 0;
let lockUntil = 0;

/* ------------------------------- demo data -------------------------------- */

const DEFAULT_CATEGORIES = [
  { name: 'Paycheck', icon: '💼', group: 'income' },
  { name: 'Interest', icon: '🏦', group: 'income' },
  { name: 'Other income', icon: '💰', group: 'income' },
  { name: 'Groceries', icon: '🛒', group: 'expense' },
  { name: 'Restaurants', icon: '🍽️', group: 'expense' },
  { name: 'Coffee', icon: '☕', group: 'expense' },
  { name: 'Transport', icon: '🚕', group: 'expense' },
  { name: 'Gas', icon: '⛽', group: 'expense' },
  { name: 'Rent', icon: '🏠', group: 'expense' },
  { name: 'Utilities', icon: '💡', group: 'expense' },
  { name: 'Internet & phone', icon: '📶', group: 'expense' },
  { name: 'Shopping', icon: '🛍️', group: 'expense' },
  { name: 'Entertainment', icon: '🎬', group: 'expense' },
  { name: 'Subscriptions', icon: '📺', group: 'expense' },
  { name: 'Health', icon: '⚕️', group: 'expense' },
  { name: 'Fitness', icon: '🏋️', group: 'expense' },
  { name: 'Travel', icon: '✈️', group: 'expense' },
  { name: 'Gifts', icon: '🎁', group: 'expense' },
  { name: 'Education', icon: '📚', group: 'expense' },
  { name: 'Fees', icon: '🧾', group: 'expense' },
  { name: 'Other', icon: '📦', group: 'expense' },
];

function ensureCategories() {
  if (db.categories.length === 0) {
    db.categories = DEFAULT_CATEGORIES.map((c) => ({ id: uid(), ...c }));
    save();
  }
}

function seedDemo() {
  ensureCategories();
  const cat = (name) => db.categories.find((c) => c.name === name)?.id || db.categories[0].id;
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };

  const mkHistory = (start, drift, vol, points = 12) => {
    const h = [];
    let v = start;
    for (let i = points - 1; i >= 0; i--) {
      v = Math.max(0, v + drift + (Math.sin(i * 2.7) * vol));
      h.push({ date: iso(daysAgo(i * 30)), balance: Math.round(v) });
    }
    return h;
  };

  const checking = { id: uid(), name: 'Everyday Checking', type: 'checking', balance: 4820, history: mkHistory(3200, 140, 260) };
  const savings = { id: uid(), name: 'High-Yield Savings', type: 'savings', balance: 21500, history: mkHistory(14000, 640, 120) };
  const credit = { id: uid(), name: 'Travel Rewards Card', type: 'credit', balance: 1240, history: mkHistory(900, 25, 300) };
  const invest = { id: uid(), name: 'Index Portfolio', type: 'investment', balance: 38600, history: mkHistory(26000, 1050, 900) };
  const loan = { id: uid(), name: 'Car Loan', type: 'loan', balance: 9800, history: mkHistory(13400, -300, 0) };
  db.accounts = [checking, savings, credit, invest, loan];

  const merchants = {
    Groceries: ['Whole Harvest Market', 'Corner Grocer', 'FreshMart'],
    Restaurants: ['Luna Trattoria', 'Saigon Kitchen', 'The Brass Fork'],
    Coffee: ['Ritual Coffee', 'Bluebird Espresso'],
    Transport: ['Metro Transit', 'CityRide'],
    Gas: ['Shell', 'Chevron'],
    Shopping: ['Amazon', 'Uniqlo', 'REI'],
    Entertainment: ['Cinema Plaza', 'Steam'],
    Subscriptions: ['Netflix', 'Spotify', 'iCloud'],
    Health: ['Walgreens', 'City Dental'],
    Fitness: ['Iron Works Gym'],
    Utilities: ['City Power & Water'],
    'Internet & phone': ['Comcast', 'T-Mobile'],
    Travel: ['Delta Air Lines', 'Airbnb'],
  };
  const txs = [];
  const rnd = (() => { let s = 42; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();
  for (let m = 0; m < 6; m++) {
    const monthStart = new Date(today.getFullYear(), today.getMonth() - m, 1);
    const dim = m === 0 ? today.getDate() : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    // income
    txs.push({ id: uid(), date: iso(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)), merchant: 'Acme Corp Payroll', category: cat('Paycheck'), accountId: checking.id, amount: 4650, notes: '' });
    if (dim >= 15) txs.push({ id: uid(), date: iso(new Date(monthStart.getFullYear(), monthStart.getMonth(), 15)), merchant: 'Acme Corp Payroll', category: cat('Paycheck'), accountId: checking.id, amount: 4650, notes: '' });
    // rent + utilities
    txs.push({ id: uid(), date: iso(new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(2, dim))), merchant: 'Oakwood Apartments', category: cat('Rent'), accountId: checking.id, amount: -2350, notes: '' });
    if (dim >= 8) txs.push({ id: uid(), date: iso(new Date(monthStart.getFullYear(), monthStart.getMonth(), 8)), merchant: 'City Power & Water', category: cat('Utilities'), accountId: checking.id, amount: -Math.round(90 + rnd() * 60), notes: '' });
    // scattered spending
    const catNames = Object.keys(merchants);
    const n = 22 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) {
      const cname = catNames[Math.floor(rnd() * catNames.length)];
      const ms = merchants[cname];
      const day = 1 + Math.floor(rnd() * dim);
      const base = { Groceries: 60, Restaurants: 45, Coffee: 7, Transport: 18, Gas: 48, Shopping: 70, Entertainment: 25, Subscriptions: 12, Health: 35, Fitness: 45, Utilities: 60, 'Internet & phone': 55, Travel: 220 }[cname] || 30;
      txs.push({
        id: uid(),
        date: iso(new Date(monthStart.getFullYear(), monthStart.getMonth(), day)),
        merchant: ms[Math.floor(rnd() * ms.length)],
        category: cat(cname),
        accountId: rnd() < 0.4 ? credit.id : checking.id,
        amount: -Math.round(base * (0.5 + rnd() * 1.4) * 100) / 100,
        notes: '',
      });
    }
  }
  txs.sort((a, b) => b.date.localeCompare(a.date));
  db.transactions = txs;

  db.budgets = {};
  const budgetPlan = { Groceries: 600, Restaurants: 350, Coffee: 60, Transport: 120, Gas: 160, Rent: 2350, Utilities: 160, 'Internet & phone': 120, Shopping: 300, Entertainment: 120, Subscriptions: 60, Health: 100, Fitness: 60, Travel: 250 };
  for (const [name, amt] of Object.entries(budgetPlan)) db.budgets[cat(name)] = amt;

  db.goals = [
    { id: uid(), name: 'Emergency fund', icon: '🛟', target: 25000, saved: 21500, targetDate: iso(new Date(today.getFullYear() + 1, 5, 1)) },
    { id: uid(), name: 'Japan trip', icon: '🗾', target: 6000, saved: 2400, targetDate: iso(new Date(today.getFullYear() + 1, 2, 1)) },
    { id: uid(), name: 'New MacBook', icon: '💻', target: 2500, saved: 900, targetDate: iso(new Date(today.getFullYear(), today.getMonth() + 4, 1)) },
  ];
  save();
}

/* ---------------------------------- api ----------------------------------- */

function json(res, code, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

function publicState() {
  return {
    settings: db.settings,
    accounts: db.accounts,
    transactions: db.transactions,
    categories: db.categories,
    budgets: db.budgets,
    goals: db.goals,
  };
}

async function handleApi(req, res, pathname) {
  const secure = (req.headers['x-forwarded-proto'] === 'https');
  const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` + (secure ? '; Secure' : '');

  if (pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, { needsSetup: !db.auth, authed: sessionValid(req) });
  }

  if (pathname === '/api/setup' && req.method === 'POST') {
    if (db.auth) return json(res, 400, { error: 'Already set up' });
    const { password } = await readBody(req);
    if (!password || password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.auth = { salt, hash: hashPassword(password, salt) };
    ensureCategories();
    const token = createSession();
    return json(res, 200, { ok: true }, { 'Set-Cookie': `finch_session=${token}; ${cookieFlags}` });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    if (Date.now() < lockUntil) return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
    const { password } = await readBody(req);
    if (!db.auth) return json(res, 400, { error: 'Not set up yet' });
    const attempt = hashPassword(password || '', db.auth.salt);
    const ok = attempt.length === db.auth.hash.length &&
      crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(db.auth.hash));
    if (!ok) {
      failedLogins++;
      if (failedLogins >= 5) { lockUntil = Date.now() + 60000; failedLogins = 0; }
      return json(res, 401, { error: 'Wrong password' });
    }
    failedLogins = 0;
    const token = createSession();
    return json(res, 200, { ok: true }, { 'Set-Cookie': `finch_session=${token}; ${cookieFlags}` });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const cookies = req.headers.cookie || '';
    const m = cookies.match(/finch_session=([a-f0-9]+)/);
    if (m) { delete db.sessions[m[1]]; save(); }
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'finch_session=; Path=/; Max-Age=0' });
  }

  // Everything below requires auth.
  if (!sessionValid(req)) return json(res, 401, { error: 'Unauthorized' });

  if (pathname === '/api/state' && req.method === 'GET') {
    ensureCategories();
    return json(res, 200, publicState());
  }

  if (pathname === '/api/demo' && req.method === 'POST') {
    seedDemo();
    return json(res, 200, publicState());
  }

  if (pathname === '/api/wipe' && req.method === 'POST') {
    db.accounts = []; db.transactions = []; db.goals = []; db.budgets = {};
    db.categories = [];
    ensureCategories();
    return json(res, 200, publicState());
  }

  if (pathname === '/api/settings' && req.method === 'PUT') {
    const body = await readBody(req);
    db.settings = { ...db.settings, ...body };
    save();
    return json(res, 200, db.settings);
  }

  if (pathname === '/api/password' && req.method === 'PUT') {
    const { current, next } = await readBody(req);
    const attempt = hashPassword(current || '', db.auth.salt);
    if (!crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(db.auth.hash)))
      return json(res, 401, { error: 'Current password is wrong' });
    if (!next || next.length < 6) return json(res, 400, { error: 'New password must be at least 6 characters' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.auth = { salt, hash: hashPassword(next, salt) };
    db.sessions = {};
    const token = createSession();
    return json(res, 200, { ok: true }, { 'Set-Cookie': `finch_session=${token}; ${cookieFlags}` });
  }

  // Collection CRUD: /api/{accounts|transactions|goals|categories}[/:id]
  const collMatch = pathname.match(/^\/api\/(accounts|transactions|goals|categories)(?:\/([a-f0-9]+))?$/);
  if (collMatch) {
    const [, coll, id] = collMatch;
    const list = db[coll];
    if (req.method === 'POST' && !id) {
      const body = await readBody(req);
      const item = { ...body, id: uid() };
      if (coll === 'accounts') {
        item.balance = Number(item.balance) || 0;
        item.history = [{ date: new Date().toISOString().slice(0, 10), balance: item.balance }];
      }
      list.push(item);
      if (coll === 'transactions') list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      save();
      return json(res, 200, item);
    }
    if (req.method === 'PUT' && id) {
      const idx = list.findIndex((x) => x.id === id);
      if (idx === -1) return json(res, 404, { error: 'Not found' });
      const body = await readBody(req);
      delete body.id;
      const prev = list[idx];
      const updated = { ...prev, ...body };
      if (coll === 'accounts') {
        updated.balance = Number(updated.balance) || 0;
        if (updated.balance !== prev.balance) {
          const today = new Date().toISOString().slice(0, 10);
          const h = (updated.history || []).filter((p) => p.date !== today);
          h.push({ date: today, balance: updated.balance });
          h.sort((a, b) => a.date.localeCompare(b.date));
          updated.history = h;
        }
      }
      list[idx] = updated;
      if (coll === 'transactions') list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      save();
      return json(res, 200, updated);
    }
    if (req.method === 'DELETE' && id) {
      const idx = list.findIndex((x) => x.id === id);
      if (idx === -1) return json(res, 404, { error: 'Not found' });
      list.splice(idx, 1);
      if (coll === 'categories') delete db.budgets[id];
      save();
      return json(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/budgets' && req.method === 'PUT') {
    const body = await readBody(req);
    for (const [k, v] of Object.entries(body)) {
      const n = Number(v);
      if (!n) delete db.budgets[k];
      else db.budgets[k] = n;
    }
    save();
    return json(res, 200, db.budgets);
  }

  return json(res, 404, { error: 'Not found' });
}

/* --------------------------------- static --------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback for client-side routes
      if (!path.extname(rel)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          res.end(d2);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(file);
    const longCache = ['.png', '.svg', '.ico', '.woff2'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(data);
  });
}

/* --------------------------------- server --------------------------------- */

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  } catch (e) {
    return json(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Finch running at http://${HOST}:${PORT}`);
  console.log(`Data stored in ${DB_FILE}`);
});
