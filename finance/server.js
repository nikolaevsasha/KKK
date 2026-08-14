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
  subscriptions: [], // manually tracked recurring services
  bills: [],         // one-off amounts owed, with due dates
  wishlist: [],      // things to buy later
  rules: [],         // { match, categoryId } merchant -> category, learned on import
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

// Categories belong to a group; groups are what the Sankey and reports roll up to.
const DEFAULT_CATEGORIES = [
  // Income
  { name: 'Paychecks', icon: '💵', type: 'income', group: 'Income' },
  { name: 'Interest', icon: '🏦', type: 'income', group: 'Income' },
  { name: 'Other Income', icon: '💰', type: 'income', group: 'Income' },
  // Housing
  { name: 'Mortgage', icon: '🏡', type: 'expense', group: 'Housing' },
  { name: 'Rent', icon: '🏠', type: 'expense', group: 'Housing' },
  { name: 'Home Improvement', icon: '🔨', type: 'expense', group: 'Housing' },
  // Financial
  { name: 'Loan Repayment', icon: '💸', type: 'expense', group: 'Financial' },
  { name: 'Insurance', icon: '☂️', type: 'expense', group: 'Financial' },
  { name: 'Cash & ATM', icon: '🏧', type: 'expense', group: 'Financial' },
  { name: 'Fees', icon: '🧾', type: 'expense', group: 'Financial' },
  // Bills & Utilities
  { name: 'Garbage', icon: '🗑️', type: 'expense', group: 'Bills & Utilities' },
  { name: 'Water', icon: '🚰', type: 'expense', group: 'Bills & Utilities' },
  { name: 'Gas & Electric', icon: '💡', type: 'expense', group: 'Bills & Utilities' },
  { name: 'Internet & Cable', icon: '📶', type: 'expense', group: 'Bills & Utilities' },
  { name: 'Phone', icon: '📱', type: 'expense', group: 'Bills & Utilities' },
  { name: 'Software & Subscriptions', icon: '💻', type: 'expense', group: 'Bills & Utilities' },
  // Food & Dining
  { name: 'Groceries', icon: '🛒', type: 'expense', group: 'Food & Dining' },
  { name: 'Restaurants & Bars', icon: '🍽️', type: 'expense', group: 'Food & Dining' },
  { name: 'Coffee Shops', icon: '☕', type: 'expense', group: 'Food & Dining' },
  // Transportation
  { name: 'Gas', icon: '⛽', type: 'expense', group: 'Transportation' },
  { name: 'Auto Payment', icon: '🚗', type: 'expense', group: 'Transportation' },
  { name: 'Public Transit', icon: '🚊', type: 'expense', group: 'Transportation' },
  { name: 'Auto Maintenance', icon: '🔧', type: 'expense', group: 'Transportation' },
  // Travel & Lifestyle
  { name: 'Travel & Vacation', icon: '✈️', type: 'expense', group: 'Travel & Lifestyle' },
  { name: 'Entertainment & Recreation', icon: '🎬', type: 'expense', group: 'Travel & Lifestyle' },
  { name: 'Pets', icon: '🐾', type: 'expense', group: 'Travel & Lifestyle' },
  { name: 'Fun Money', icon: '🎉', type: 'expense', group: 'Travel & Lifestyle' },
  // Shopping
  { name: 'Shopping', icon: '🛍️', type: 'expense', group: 'Shopping' },
  { name: 'Clothing', icon: '👕', type: 'expense', group: 'Shopping' },
  { name: 'Electronics', icon: '💻', type: 'expense', group: 'Shopping' },
  { name: 'Gifts', icon: '🎁', type: 'expense', group: 'Shopping' },
  // Health & Wellness
  { name: 'Medical', icon: '⚕️', type: 'expense', group: 'Health & Wellness' },
  { name: 'Dentist', icon: '🦷', type: 'expense', group: 'Health & Wellness' },
  { name: 'Fitness', icon: '🏋️', type: 'expense', group: 'Health & Wellness' },
  // Other
  { name: 'Miscellaneous', icon: '📦', type: 'expense', group: 'Other' },
];

// Group display order — reports and the Sankey follow it.
const GROUP_ORDER = ['Income', 'Housing', 'Financial', 'Bills & Utilities', 'Food & Dining',
  'Transportation', 'Travel & Lifestyle', 'Shopping', 'Health & Wellness', 'Other'];

function ensureCategories() {
  if (db.categories.length === 0) {
    db.categories = DEFAULT_CATEGORIES.map((c) => ({ id: uid(), ...c }));
    save();
    return;
  }
  // Migrate pre-group categories, where `group` held 'income' / 'expense'.
  let changed = false;
  for (const c of db.categories) {
    if (c.type) continue;
    c.type = c.group === 'income' ? 'income' : 'expense';
    c.group = c.type === 'income' ? 'Income' : 'Other';
    changed = true;
  }
  if (changed) save();
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

  // Walk backwards from the account's real balance so the history always ends
  // exactly where the account stands today — otherwise the net-worth line
  // jumps at the last point.
  const mkHistory = (end, drift, vol, points = 13) => {
    const h = [];
    for (let i = 0; i < points; i++) {
      const v = end - drift * i + Math.sin(i * 2.7) * vol;
      h.unshift({ date: iso(daysAgo(i * 30)), balance: Math.max(0, Math.round(v * 100) / 100) });
    }
    return h;
  };

  const checking = { id: uid(), name: 'Everyday Checking', type: 'checking', institution: 'Citi', balance: 15234.75, history: mkHistory(15234.75, 260, 520) };
  const savings = { id: uid(), name: 'Joint Savings', type: 'savings', institution: 'Ally', balance: 50107.55, history: mkHistory(50107.55, 1250, 340) };
  const credit = { id: uid(), name: 'Joint Credit Card', type: 'credit', institution: 'Amex', balance: 2828.99, history: mkHistory(2828.99, 30, 420) };
  const invest = { id: uid(), name: 'Retirement 401k', type: 'investment', institution: 'Fidelity', balance: 180336.73, history: mkHistory(180336.73, 3100, 2600) };
  const brokerage = { id: uid(), name: 'Index Brokerage', type: 'investment', institution: 'Vanguard', balance: 88420.4, history: mkHistory(88420.4, 1500, 1700) };
  const home = { id: uid(), name: 'Primary Residence', type: 'property', institution: 'Zillow', balance: 300625.05, history: mkHistory(300625.05, 900, 0) };
  const car = { id: uid(), name: 'Toyota RAV4', type: 'property', institution: 'KBB', balance: 20739.77, history: mkHistory(20739.77, -320, 0) };
  const mortgage = { id: uid(), name: 'Home Mortgage', type: 'loan', institution: 'Wells Fargo', balance: 197400.5, history: mkHistory(197400.5, -640, 0) };
  const carLoan = { id: uid(), name: 'Auto Loan', type: 'loan', institution: 'Chase', balance: 9800, history: mkHistory(9800, -420, 0) };
  db.accounts = [checking, savings, credit, invest, brokerage, home, car, mortgage, carLoan];

  const rnd = (() => { let s = 42; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();
  const txs = [];
  const add = (date, merchant, category, accountId, amount) =>
    txs.push({ id: uid(), date, merchant, category, accountId, amount, notes: '' });

  // Fixed monthly commitments — these make the Sankey and Recurring page look real.
  const FIXED = [
    [1, 'Acme Corp Payroll', 'Paychecks', checking.id, 2100],
    [15, 'Acme Corp Payroll', 'Paychecks', checking.id, 2100],
    [1, 'Wells Fargo Home Mortgage', 'Mortgage', checking.id, -1385],
    [5, 'Student Loan Payment', 'Loan Repayment', checking.id, -500.23],
    [5, 'State Farm', 'Insurance', checking.id, -90.91],
    [5, 'State Farm', 'Insurance', checking.id, -110.54],
    [5, 'HOA Monthly Dues', 'Garbage', checking.id, -320.47],
    [8, 'City Power & Light', 'Gas & Electric', checking.id, -108],
    [10, 'Comcast Xfinity', 'Internet & Cable', checking.id, -115],
    [12, 'T-Mobile', 'Phone', checking.id, -140],
    [14, 'City Water Dept', 'Water', checking.id, -62.4],
    [18, 'Iron Works Gym', 'Fitness', credit.id, -49],
    [20, 'Netflix', 'Entertainment & Recreation', credit.id, -22.99],
    [22, 'Spotify', 'Entertainment & Recreation', credit.id, -11.99],
    [24, 'Happy Paws Vet Plan', 'Pets', credit.id, -150],
  ];

  // Variable spending — merchant pools per category.
  const VARIABLE = {
    Groceries: [['Whole Harvest Market', 95], ['Corner Grocer', 42], ['FreshMart', 68]],
    'Restaurants & Bars': [['Luna Trattoria', 58], ['Saigon Kitchen', 34], ['The Brass Fork', 72]],
    'Coffee Shops': [['Ritual Coffee', 6.5], ['Bluebird Espresso', 5.25]],
    Gas: [['Shell', 46], ['Chevron', 52]],
    'Public Transit': [['Metro Transit', 12]],
    'Auto Maintenance': [['Pep Boys', 120]],
    Shopping: [['Amazon', 64], ['Target', 88]],
    Clothing: [['Uniqlo', 75]],
    Electronics: [['Best Buy', 100]],
    'Home Improvement': [['Home Depot', 104], ['Ace Hardware', 48]],
    Medical: [['Walgreens', 32]],
    'Travel & Vacation': [['Delta Air Lines', 320], ['Airbnb', 260]],
    'Fun Money': [['Cinema Plaza', 24], ['Steam', 30]],
    'Cash & ATM': [['ATM Withdrawal', 40]],
  };
  const varNames = Object.keys(VARIABLE);

  for (let m = 5; m >= 0; m--) {
    const ms = new Date(today.getFullYear(), today.getMonth() - m, 1);
    const Y = ms.getFullYear(), M = ms.getMonth();
    const dim = m === 0 ? today.getDate() : new Date(Y, M + 1, 0).getDate();

    for (const [day, merchant, cname, acct, amt] of FIXED) {
      if (day > dim) continue;
      add(iso(new Date(Y, M, day)), merchant, cat(cname), acct, amt);
    }
    // Quarterly interest on savings.
    if (M % 3 === 0) add(iso(new Date(Y, M, Math.min(28, dim))), 'Savings Interest', cat('Interest'), savings.id, 31.4);

    // Keep variable spending under the paycheck so the demo shows a positive
    // savings rate, the way a healthy month actually looks.
    const n = 7 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const cname = varNames[Math.floor(rnd() * varNames.length)];
      const pool = VARIABLE[cname];
      const [merchant, base] = pool[Math.floor(rnd() * pool.length)];
      // Travel only shows up occasionally, so it doesn't dominate every month.
      if (cname === 'Travel & Vacation' && rnd() > 0.35) continue;
      add(iso(new Date(Y, M, 1 + Math.floor(rnd() * dim))), merchant, cat(cname),
        rnd() < 0.45 ? credit.id : checking.id,
        -Math.round(base * (0.6 + rnd() * 0.9) * 100) / 100);
    }
  }
  txs.sort((a, b) => b.date.localeCompare(a.date));
  db.transactions = txs;

  db.budgets = {};
  const budgetPlan = {
    Mortgage: 1385, 'Home Improvement': 150, 'Loan Repayment': 500, Insurance: 210,
    Garbage: 320, 'Gas & Electric': 120, 'Internet & Cable': 115, Phone: 140, Water: 70,
    Groceries: 600, 'Restaurants & Bars': 350, 'Coffee Shops': 60,
    Gas: 160, 'Public Transit': 60, Shopping: 300, Clothing: 120, Electronics: 80,
    'Travel & Vacation': 250, 'Entertainment & Recreation': 90, Pets: 150, 'Fun Money': 100,
    Medical: 100, Fitness: 50, 'Cash & ATM': 80,
  };
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
    subscriptions: db.subscriptions,
    bills: db.bills,
    wishlist: db.wishlist,
    rules: db.rules,
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
    db.categories = []; db.subscriptions = []; db.bills = []; db.wishlist = []; db.rules = [];
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
  const collMatch = pathname.match(/^\/api\/(accounts|transactions|goals|categories|subscriptions|bills|wishlist|rules)(?:\/([a-f0-9]+))?$/);
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

  // Bulk transaction insert used by the CSV importer. Skips rows that already
  // exist (same date + amount + merchant) so re-importing a statement is safe.
  if (pathname === '/api/transactions/bulk' && req.method === 'POST') {
    const { transactions = [] } = await readBody(req);
    if (!Array.isArray(transactions)) return json(res, 400, { error: 'Expected a transactions array' });
    const seen = new Set(db.transactions.map((t) =>
      `${t.date}|${Number(t.amount).toFixed(2)}|${(t.merchant || '').trim().toLowerCase()}`));
    const added = [];
    let skipped = 0;
    for (const raw of transactions) {
      const t = {
        id: uid(),
        date: String(raw.date || '').slice(0, 10),
        merchant: String(raw.merchant || '').slice(0, 200),
        amount: Number(raw.amount) || 0,
        category: raw.category || '',
        accountId: raw.accountId || '',
        notes: String(raw.notes || '').slice(0, 500),
      };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !t.amount) { skipped++; continue; }
      const key = `${t.date}|${t.amount.toFixed(2)}|${t.merchant.trim().toLowerCase()}`;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      db.transactions.push(t);
      added.push(t);
    }
    db.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    save();
    return json(res, 200, { added: added.length, skipped, transactions: db.transactions });
  }

  // Mark a bill paid: removes it and optionally records the payment.
  if (pathname === '/api/bills/pay' && req.method === 'POST') {
    const { id, accountId, categoryId, date } = await readBody(req);
    const idx = db.bills.findIndex((b) => b.id === id);
    if (idx === -1) return json(res, 404, { error: 'Not found' });
    const bill = db.bills[idx];
    let tx = null;
    if (accountId) {
      tx = {
        id: uid(),
        date: (date || new Date().toISOString().slice(0, 10)).slice(0, 10),
        merchant: bill.name,
        amount: -Math.abs(Number(bill.amount) || 0),
        category: categoryId || bill.category || '',
        accountId,
        notes: 'Bill payment',
      };
      db.transactions.push(tx);
      db.transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }
    db.bills.splice(idx, 1);
    save();
    return json(res, 200, { ok: true, transaction: tx, bills: db.bills, transactions: db.transactions });
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
