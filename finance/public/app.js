/* Finch — personal finance dashboard (frontend) */
'use strict';

/* -------------------------------- helpers ------------------------------- */

const $ = (sel, el = document) => el.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.includes('/login') && !path.includes('/status')) {
    showAuth(false);
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* --------------------------------- state -------------------------------- */

const S = {
  settings: { currency: 'USD', locale: 'en-US', name: '' },
  accounts: [], transactions: [], categories: [], budgets: {}, goals: [],
  route: 'dashboard',
  tab: '',
  range: 'last30',
  nwRange: '1M',
  txFilter: { q: '', cat: '', acct: '' },
  spendMode: 'category',
  subscriptions: [], bills: [], wishlist: [], rules: [],
  recurTab: 'manual',
};

const LIABILITY_TYPES = new Set(['credit', 'loan']);
const ACCOUNT_TYPES = [
  ['checking', 'Checking', 'Cash'],
  ['savings', 'Savings', 'Cash'],
  ['cash', 'Cash', 'Cash'],
  ['credit', 'Credit Card', 'Credit Cards'],
  ['investment', 'Investment', 'Investments'],
  ['property', 'Property', 'Real Estate'],
  ['loan', 'Loan', 'Loans'],
  ['other', 'Other', 'Other'],
];
const typeMeta = (t) => ACCOUNT_TYPES.find((a) => a[0] === t) || ACCOUNT_TYPES[7];
const SECTION_ORDER = ['Cash', 'Credit Cards', 'Investments', 'Real Estate', 'Loans', 'Other'];

// Group → categorical color slot. Fixed assignment, never cycled.
const GROUP_COLORS = {
  Income: '--income',
  Savings: '--savings',
  Housing: '--s4',
  Financial: '--s5',
  'Bills & Utilities': '--s1',
  'Food & Dining': '--s2',
  Transportation: '--s3',
  'Travel & Lifestyle': '--s7',
  Shopping: '--s8',
  'Health & Wellness': '--s6',
  Other: '--ink-3',
};
const groupColor = (g) => cssVar(GROUP_COLORS[g] || '--ink-3');
const GROUP_ORDER = ['Housing', 'Financial', 'Bills & Utilities', 'Food & Dining',
  'Transportation', 'Travel & Lifestyle', 'Shopping', 'Health & Wellness', 'Other'];

const ACCT_COLORS = ['--s1', '--s7', '--s3', '--s5', '--s4', '--s2', '--s8', '--s6'];

/* ------------------------------ formatting ------------------------------ */

function fmt(n, opts = {}) {
  const cur = S.settings.currency || 'USD';
  try {
    return new Intl.NumberFormat(S.settings.locale || undefined, {
      style: 'currency', currency: cur,
      maximumFractionDigits: Math.abs(n) >= 10000 ? 0 : 2,
      minimumFractionDigits: Math.abs(n) >= 10000 || Number.isInteger(n) ? 0 : 2,
      ...opts,
    }).format(n);
  } catch { return (n < 0 ? '-' : '') + cur + ' ' + Math.abs(n).toFixed(2); }
}
const fmtSign = (n) => (n > 0 ? '+' : '') + fmt(n);
const fmtPct = (n) => (Math.round(n * 10) / 10).toFixed(1) + '%';

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => (d || '').slice(0, 7);
const thisMonth = () => todayISO().slice(0, 7);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso, withYear) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? ', ' + y : ''}`;
}
function fmtDateLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return `${full[m - 1]} ${d}, ${y}`;
}
const fmtMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

const catById = (id) => S.categories.find((c) => c.id === id);
const acctById = (id) => S.accounts.find((a) => a.id === id);
const catGroup = (id) => catById(id)?.group || 'Other';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ------------------------------ date ranges ----------------------------- */

const RANGES = [
  ['last30', 'Last 30 days'],
  ['thisMonth', 'This month'],
  ['lastMonth', 'Last month'],
  ['last3', 'Last 3 months'],
  ['last6', 'Last 6 months'],
  ['thisYear', 'This year'],
  ['all', 'All time'],
];
const rangeLabel = (k) => (RANGES.find((r) => r[0] === k) || RANGES[0])[1];

function rangeBounds(key = S.range) {
  const now = new Date();
  const Y = now.getFullYear(), M = now.getMonth();
  const iso = (d) => d.toISOString().slice(0, 10);
  const eom = (y, m) => iso(new Date(y, m + 1, 0));
  switch (key) {
    case 'last30': return { start: iso(new Date(Date.now() - 29 * 864e5)), end: iso(now) };
    case 'lastMonth': return { start: iso(new Date(Y, M - 1, 1)), end: eom(Y, M - 1) };
    case 'last3': return { start: iso(new Date(Y, M - 2, 1)), end: eom(Y, M) };
    case 'last6': return { start: iso(new Date(Y, M - 5, 1)), end: eom(Y, M) };
    case 'thisYear': return { start: `${Y}-01-01`, end: `${Y}-12-31` };
    case 'all': return { start: '0000-01-01', end: '9999-12-31' };
    default: return { start: iso(new Date(Y, M, 1)), end: eom(Y, M) };
  }
}

function rangeText(key = S.range) {
  const { start, end } = rangeBounds(key);
  if (key === 'all') {
    const dates = S.transactions.map((t) => t.date).sort();
    if (!dates.length) return 'All time';
    return `${fmtDateLong(dates[0])} – ${fmtDateLong(dates[dates.length - 1])}`;
  }
  return `${fmtDateLong(start)} – ${fmtDateLong(end)}`;
}

function txInRange(key = S.range) {
  const { start, end } = rangeBounds(key);
  return S.transactions.filter((t) => t.date >= start && t.date <= end &&
    (!S.txFilter.acct || t.accountId === S.txFilter.acct));
}

/* -------------------------------- derived ------------------------------- */

const accountSigned = (a) => (LIABILITY_TYPES.has(a.type) ? -Math.abs(a.balance) : a.balance);
const netWorth = () => S.accounts.reduce((s, a) => s + accountSigned(a), 0);

function assetsAndDebts() {
  let assets = 0, debts = 0;
  for (const a of S.accounts) {
    const v = accountSigned(a);
    if (v >= 0) assets += v; else debts += -v;
  }
  return { assets, debts };
}

// Section (Cash / Investments / …) → accounts, in display order.
function accountSections() {
  const map = new Map();
  for (const a of S.accounts) {
    const sec = typeMeta(a.type)[2];
    if (!map.has(sec)) map.set(sec, []);
    map.get(sec).push(a);
  }
  return SECTION_ORDER.filter((s) => map.has(s)).map((s) => [s, map.get(s)]);
}

// Balance of one account on a given date (carry-forward from its history).
function balanceOn(a, date) {
  const hist = a.history || [];
  if (date >= todayISO()) return a.balance;
  let bal = null;
  for (const p of hist) {
    if (p.date <= date) bal = p.balance;
    else break;
  }
  return bal === null ? (hist.length ? hist[0].balance : a.balance) : bal;
}

function netWorthSeries(accounts = S.accounts) {
  const dates = new Set();
  for (const a of accounts) for (const p of a.history || []) dates.add(p.date);
  dates.add(todayISO());
  return [...dates].sort().map((date) => ({
    date,
    value: accounts.reduce((s, a) =>
      s + (LIABILITY_TYPES.has(a.type) ? -Math.abs(balanceOn(a, date)) : balanceOn(a, date)), 0),
  }));
}

function monthAgg(months = 6) {
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let income = 0, expense = 0;
    for (const t of S.transactions) {
      if (monthKey(t.date) !== key) continue;
      if (t.amount > 0) income += t.amount; else expense += -t.amount;
    }
    out.push({ key, label: MONTHS[d.getMonth()], income, expense });
  }
  return out;
}

function totalsFor(txs) {
  let income = 0, expense = 0;
  for (const t of txs) {
    if (t.amount > 0) income += t.amount; else expense += -t.amount;
  }
  return { income, expense, net: income - expense, rate: income ? ((income - expense) / income) * 100 : 0 };
}

// Spending rolled up by category or by group.
function spendBy(txs, mode = 'category') {
  const map = new Map();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const c = catById(t.category);
    const key = mode === 'group' ? (c?.group || 'Other') : (c?.id || 'none');
    const cur = map.get(key) || { total: 0, cat: c, group: c?.group || 'Other', key };
    cur.total += -t.amount;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function incomeBy(txs) {
  const map = new Map();
  for (const t of txs) {
    if (t.amount <= 0) continue;
    const c = catById(t.category);
    const key = c?.id || 'none';
    const cur = map.get(key) || { total: 0, cat: c, key };
    cur.total += t.amount;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// A slice's color: categories inherit their group's hue, stepped by rank so
// same-group categories stay distinguishable in the donut.
function sliceColor(entry, i, mode) {
  if (mode === 'group') return groupColor(entry.key);
  const base = groupColor(entry.group);
  return i % 2 === 0 ? base : shade(base, 0.55);
}
function shade(hex, amt) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return hex;
  const mix = (c) => Math.round(parseInt(c, 16) * amt + 255 * (1 - amt) * 0.72);
  return `rgb(${mix(m[1])},${mix(m[2])},${mix(m[3])})`;
}

// Recurring detection: same merchant seen in 3+ distinct months.
function recurringItems() {
  const map = new Map();
  for (const t of S.transactions) {
    if (t.amount >= 0) continue;
    const k = (t.merchant || '').toLowerCase().trim();
    if (!k) continue;
    if (!map.has(k)) map.set(k, { merchant: t.merchant, months: new Set(), txs: [] });
    const e = map.get(k);
    e.months.add(monthKey(t.date));
    e.txs.push(t);
  }
  return [...map.values()]
    .filter((e) => e.months.size >= 3)
    .map((e) => {
      const amounts = e.txs.map((t) => -t.amount);
      const avg = amounts.reduce((s, x) => s + x, 0) / amounts.length;
      const spread = Math.max(...amounts) - Math.min(...amounts);
      const last = e.txs.map((t) => t.date).sort().pop();
      const d = new Date(last + 'T00:00:00');
      d.setMonth(d.getMonth() + 1);
      return {
        merchant: e.merchant, avg, last, count: e.txs.length,
        category: e.txs[0].category,
        next: d.toISOString().slice(0, 10),
        fixed: spread < Math.max(2, avg * 0.06),
      };
    })
    .sort((a, b) => b.avg - a.avg);
}

/* ------------------------------- chrome --------------------------------- */

const NAV = [
  ['dashboard', 'Dashboard', 'dashboard'],
  ['accounts', 'Accounts', 'accounts'],
  ['transactions', 'Transactions', 'transactions'],
  ['cashflow', 'Cash Flow', 'cashflow'],
  ['reports', 'Reports', 'reports'],
  ['budget', 'Budget', 'budget'],
  ['recurring', 'Recurring', 'recurring'],
  ['bills', 'Left to pay', 'wallet'],
  ['wishlist', 'Wishlist', 'list'],
  ['goals', 'Goals', 'goals'],
  ['investments', 'Investments', 'investments'],
  ['advice', 'Advice', 'advice'],
];
const TABS = [
  ['dashboard', 'Home', 'dashboard'],
  ['accounts', 'Accounts', 'accounts'],
  ['transactions', 'Activity', 'transactions'],
  ['reports', 'Reports', 'reports'],
  ['more', 'More', 'list'],
];
const MORE_ROUTES = ['cashflow', 'budget', 'recurring', 'bills', 'wishlist', 'goals',
  'investments', 'advice', 'settings', 'more'];

const BRAND_SVG = `<svg viewBox="0 0 32 32" width="26" height="26" fill="none" aria-hidden="true">
  <path d="M16 16c-3.6-5.4-8.2-8-11.4-6.2C1.6 11.4 1.7 16.6 4.8 19.4c2.6 2.4 7.2 1.4 11.2-3.4z" fill="currentColor" opacity="0.9"/>
  <path d="M16 16c3.6-5.4 8.2-8 11.4-6.2 3 1.6 2.9 6.8-.2 9.6-2.6 2.4-7.2 1.4-11.2-3.4z" fill="currentColor"/>
  <circle cx="16" cy="16" r="1.9" fill="currentColor"/>
</svg>`;

function buildChrome() {
  $('#brand').innerHTML = BRAND_SVG;
  $('#auth-logo').innerHTML = `<span style="color:var(--accent)">${BRAND_SVG.replace('width="26" height="26"', 'width="44" height="44"')}</span>`;

  const tools = $('#topbar-tools');
  tools.innerHTML = '';
  tools.append(
    h('button', { class: 'icon-btn', title: 'Search transactions', html: icon('search', 19), onclick: () => go('transactions') }),
    h('button', { class: 'icon-btn', title: 'Alerts', html: icon('bell', 19), onclick: showAlerts }),
    h('button', { class: 'icon-btn', title: 'Settings', html: icon('settings', 19), onclick: () => go('settings') }),
    h('button', { class: 'icon-btn', title: 'Toggle sidebar', html: icon('panel', 19), onclick: () => $('#sidebar').classList.toggle('hidden') }),
  );

  const nav = $('#sidebar-nav');
  nav.innerHTML = '';
  for (const [id, label, ic] of NAV) {
    nav.append(h('button', {
      class: 'nav-item' + (S.route === id ? ' active' : ''), type: 'button', onclick: () => go(id),
    }, h('span', { class: 'ic-wrap', html: icon(ic, 19) }), h('span', {}, label)));
  }

  const help = $('#help-btn');
  help.innerHTML = '';
  help.append(h('span', { class: 'ic-wrap', html: icon('help', 19) }), h('span', {}, 'Help & Support'));
  help.onclick = showHelp;

  const chip = $('#user-chip');
  const name = S.settings.name || 'Your account';
  const initials = (S.settings.name || 'You').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  chip.innerHTML = '';
  chip.append(
    h('span', { class: 'avatar' }, initials),
    h('span', {}, name),
    h('span', { class: 'ic-wrap chev', html: icon('chevronDown', 16) }),
  );
  chip.onclick = (e) => openMenu(e.currentTarget, [
    { label: 'Settings', onClick: () => go('settings') },
    { label: 'Export data', onClick: exportData },
    { sep: true },
    { label: 'Log out', onClick: logout },
  ]);

  const tb = $('#tabbar');
  tb.innerHTML = '';
  for (const [id, label, ic] of TABS) {
    const active = S.route === id || (id === 'more' && MORE_ROUTES.includes(S.route));
    tb.append(h('button', {
      class: 'tab-item' + (active ? ' active' : ''), type: 'button', onclick: () => go(id),
    }, h('span', { class: 'ic-wrap', html: icon(ic, 22) }), h('span', {}, label)));
  }

  $('#fab').innerHTML = icon('plus', 24);
}

function setTopbar(title, tabs = [], actions = []) {
  $('#topbar-title').textContent = title;
  const tabsEl = $('#topbar-tabs');
  tabsEl.innerHTML = '';
  for (const [id, label] of tabs) {
    tabsEl.append(h('button', {
      class: 'topbar-tab' + (S.tab === id ? ' active' : ''), type: 'button',
      onclick: () => { S.tab = id; location.hash = `#/${S.route}/${id}`; render(); },
    }, label));
  }
  const act = $('#topbar-actions');
  act.innerHTML = '';
  for (const a of actions) act.append(a);
}

function dateRangeButton(onPick) {
  return h('button', {
    class: 'btn', type: 'button',
    onclick: (e) => openMenu(e.currentTarget, RANGES.map(([k, label]) => ({
      label, selected: S.range === k,
      onClick: () => { S.range = k; (onPick || render)(); },
    }))),
  }, h('span', { class: 'ic-wrap', html: icon('calendar', 16) }), rangeLabel(S.range));
}

// Account filter shared by Reports and Transactions.
function filtersButton() {
  const active = !!S.txFilter.acct;
  return h('button', {
    class: 'btn' + (active ? ' btn-primary' : ''), type: 'button',
    onclick: (e) => openMenu(e.currentTarget, [
      { label: 'All accounts', selected: !S.txFilter.acct, onClick: () => { S.txFilter.acct = ''; render(); } },
      ...S.accounts.map((a) => ({
        label: a.name, selected: S.txFilter.acct === a.id,
        onClick: () => { S.txFilter.acct = a.id; render(); },
      })),
    ]),
  }, h('span', { class: 'ic-wrap', html: icon('filter', 16) }),
    lbl(active ? (acctById(S.txFilter.acct)?.name || 'Filters') : 'Filters'));
}

function openMenu(anchor, items) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const back = h('div', { class: 'menu-back', onclick: closeMenu });
  const menu = h('div', { class: 'menu' });
  for (const it of items) {
    if (it.sep) { menu.append(h('div', { class: 'menu-sep' })); continue; }
    menu.append(h('button', {
      class: it.selected ? 'sel' : '', type: 'button',
      onclick: () => { closeMenu(); it.onClick(); },
    }, h('span', {}, it.label), it.selected ? h('span', { class: 'ic-wrap', html: icon('check', 15) }) : null));
  }
  document.body.append(back, menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
  const below = r.bottom + 6;
  menu.style.top = (below + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh - 6) : below) + 'px';
  menu._back = back;
}
function closeMenu() {
  document.querySelectorAll('.menu, .menu-back').forEach((e) => e.remove());
}
window.addEventListener('resize', closeMenu);

/* -------------------------------- router -------------------------------- */

function go(route, tab = '') {
  S.route = route;
  S.tab = tab;
  location.hash = '#/' + route + (tab ? '/' + tab : '');
  render();
}

function parseHash() {
  const parts = location.hash.replace(/^#\//, '').split('/');
  return { route: parts[0] || 'dashboard', tab: parts[1] || '' };
}

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#/add')) { handleQuickRoute(); return; }
  const { route, tab } = parseHash();
  if (route !== S.route || tab !== S.tab) { S.route = route; S.tab = tab; render(); }
});

let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  if (Math.abs(window.innerWidth - lastW) < 24) return;
  lastW = window.innerWidth;
  document.querySelectorAll('.chart-wrap').forEach((w) => w._render && w._render());
});

const PAGES = {
  dashboard: pageDashboard, accounts: pageAccounts, transactions: pageTransactions,
  cashflow: pageCashflow, reports: pageReports, budget: pageBudget,
  recurring: pageRecurring, goals: pageGoals, investments: pageInvestments,
  advice: pageAdvice, settings: pageSettings, more: pageMore,
  bills: pageBills, wishlist: pageWishlist,
};

function render() {
  closeMenu();
  hideTip();
  buildChrome();
  const main = $('#main');
  main.innerHTML = '';
  window.scrollTo(0, 0);
  (PAGES[S.route] || pageDashboard)(main);
  $('#fab').classList.toggle('hidden', ['settings', 'more', 'advice'].includes(S.route));
}

/* ------------------------------ shared bits ----------------------------- */

function card(...children) { return h('div', { class: 'card' }, ...children); }

function cardHead(eyebrow, title, ...tools) {
  return h('div', { class: 'card-head' },
    h('div', {}, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, title ? h('h3', {}, title) : null),
    tools.length ? h('div', { class: 'tools' }, ...tools) : null);
}

function kpi(value, label, tone) {
  return h('div', { class: 'kpi' },
    h('div', { class: 'v' + (tone ? ' ' + tone : '') }, value),
    h('div', { class: 'l' }, label));
}

function emptyState(icn, text, btnLabel, onClick) {
  return h('div', { class: 'empty' },
    h('div', { class: 'big' }, icn),
    h('p', {}, text),
    btnLabel ? h('button', { class: 'btn btn-primary', onclick: onClick }, btnLabel) : null);
}

function chartTable(headers, rows) {
  if (!rows.length) return null;
  return h('details', { class: 'chart-table' },
    h('summary', {}, 'View as table'),
    h('table', {},
      h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', {}, x)))),
      h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c)))))));
}

function deltaEl(change, pct, suffix) {
  return h('span', { class: `delta ${change >= 0 ? 'up' : 'down'}` },
    h('span', { class: 'ic-wrap', html: icon(change >= 0 ? 'arrowUp' : 'arrowDown', 14) }),
    `${fmt(Math.abs(change))} (${fmtPct(Math.abs(pct))})`,
    suffix ? h('span', { class: 'vs' }, suffix) : null);
}

function txRow(t, { showDate = true } = {}) {
  const c = catById(t.category);
  const acct = acctById(t.accountId);
  return h('div', { class: 'row clickable', onclick: () => txModal(t) },
    h('div', { class: 'r-icon' }, c?.icon || '💳'),
    h('div', { class: 'r-main' },
      h('div', { class: 'r-title' }, t.merchant || '(no name)'),
      h('div', { class: 'r-sub' }, [c?.name, acct?.name].filter(Boolean).join(' · ') || '—')),
    h('div', { class: 'r-amt' + (t.amount > 0 ? ' amt-pos' : '') }, fmtSign(t.amount),
      showDate ? h('div', { class: 'r-sub' }, fmtDate(t.date)) : null),
    h('span', { class: 'ic-wrap chev', html: icon('chevronRight', 15) }));
}

function acctLogo(a, i) {
  const inst = a.institution || a.name;
  const initials = inst.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return h('div', {
    class: 'acct-logo',
    style: `background:${cssVar(ACCT_COLORS[i % ACCT_COLORS.length])}`,
  }, initials);
}

/* ------------------------------- dashboard ------------------------------ */

function pageDashboard(main) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = S.settings.name ? `, ${S.settings.name.split(' ')[0]}` : '';
  setTopbar('Dashboard', [], [dateRangeButton()]);

  if (!S.accounts.length && !S.transactions.length) {
    main.append(h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, `${greet}${name}`))));
    main.append(card(emptyState('🪺',
      'Welcome to Finch. Add your accounts to start tracking net worth — or explore with demo data first.',
      'Load demo data', async () => {
        Object.assign(S, await api('/api/demo', 'POST'));
        toast('Demo data loaded'); render();
      })));
    main.append(card(cardHead(null, 'Get started'),
      h('div', { class: 'row-list' },
        startRow('accounts', 'Add your accounts', 'Checking, savings, cards, investments', () => go('accounts')),
        startRow('transactions', 'Log transactions', 'Track where the money goes', () => go('transactions')),
        startRow('budget', 'Set a budget', 'Monthly limits per category', () => go('budget')))));
    return;
  }

  main.append(h('div', { class: 'page-head' },
    h('div', {}, h('h2', {}, `${greet}${name}`),
      h('div', { class: 'sub' }, new Date().toLocaleDateString(S.settings.locale || undefined,
        { weekday: 'long', month: 'long', day: 'numeric' })))));

  const txs = txInRange();
  const T = totalsFor(txs);
  main.append(h('div', { class: 'kpi-row' },
    kpi(fmt(netWorth()), 'Net worth'),
    kpi(fmt(T.income), 'Income', 'pos'),
    kpi(fmt(T.expense), 'Expenses', 'neg'),
    kpi(fmtPct(T.rate), 'Savings rate')));

  // Net worth trend
  const series = netWorthSeries();
  if (series.length >= 2) {
    const first = series[0].value, last = series[series.length - 1].value;
    main.append(card(
      cardHead('Net worth', fmt(last),
        h('span', {}, deltaEl(last - first, first ? ((last - first) / Math.abs(first)) * 100 : 0, 'all time'))),
      lineChart(series.map((p) => ({
        value: p.value, label: fmtDate(p.date), tipLabel: fmtDateLong(p.date), display: fmt(p.value),
      })), { height: 200 }),
      chartTable(['Date', 'Net worth'], series.map((p) => [fmtDateLong(p.date), fmt(p.value)]))));
  }

  const spend = spendBy(txs, 'group');
  main.append(h('div', { class: 'grid-2' },
    card(cardHead(rangeLabel(S.range), 'Spending',
      h('a', { href: '#/reports/spending', onclick: (e) => { e.preventDefault(); go('reports', 'spending'); } }, 'Details →')),
      spend.length ? donutWithLegend(spend, 'group', T.expense) : h('div', { class: 'empty' }, h('p', {}, 'No spending in this period.'))),
    card(cardHead(null, 'Budget',
      h('a', { href: '#/budget', onclick: (e) => { e.preventDefault(); go('budget'); } }, 'Edit →')),
      Object.keys(S.budgets).length
        ? budgetList(4)
        : h('div', { class: 'empty' }, h('p', {}, 'No budget set yet.'),
          h('button', { class: 'btn btn-sm', onclick: () => go('budget') }, 'Set a budget')))));

  main.append(h('div', { class: 'grid-2' },
    card(cardHead(null, 'Accounts',
      h('a', { href: '#/accounts', onclick: (e) => { e.preventDefault(); go('accounts'); } }, 'All →')),
      h('div', { class: 'row-list' }, ...S.accounts.slice(0, 5).map((a, i) => accountRow(a, i)))),
    card(cardHead(null, 'Recent transactions',
      h('a', { href: '#/transactions', onclick: (e) => { e.preventDefault(); go('transactions'); } }, 'All →')),
      S.transactions.length
        ? h('div', { class: 'row-list' }, ...S.transactions.slice(0, 6).map((t) => txRow(t)))
        : h('div', { class: 'empty' }, h('p', {}, 'Nothing yet.')))));

  const openBills = S.bills.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const subsMonthly = S.subscriptions.reduce((s2, x) => s2 + monthlyCost(x), 0);
  if (openBills.length || S.subscriptions.length) {
    main.append(h('div', { class: 'grid-2' },
      openBills.length ? card(cardHead(null, 'Left to pay',
        h('a', { href: '#/bills', onclick: (e) => { e.preventDefault(); go('bills'); } }, 'All →')),
        h('div', { class: 'hero-number', style: 'font-size:24px;margin-bottom:8px' },
          fmt(openBills.reduce((s2, b) => s2 + (Number(b.amount) || 0), 0))),
        h('div', { class: 'row-list' }, ...openBills.slice(0, 4).map((b) => {
          const d = daysUntil(b.due);
          return h('div', { class: 'row clickable', onclick: () => go('bills') },
            h('div', { class: 'r-icon' }, catById(b.category)?.icon || '🧾'),
            h('div', { class: 'r-main' },
              h('div', { class: 'r-title' }, b.name),
              h('div', { class: 'r-sub', style: d < 0 ? 'color:var(--neg)' : '' },
                d === null ? 'No due date' : d < 0 ? `${-d} days overdue` : d === 0 ? 'Due today' : `Due in ${d} days`)),
            h('div', { class: 'r-amt' }, fmt(Number(b.amount) || 0)));
        }))) : null,
      S.subscriptions.length ? card(cardHead(null, 'Subscriptions',
        h('a', { href: '#/recurring', onclick: (e) => { e.preventDefault(); go('recurring'); } }, 'All →')),
        h('div', { class: 'hero-number', style: 'font-size:24px;margin-bottom:8px' },
          `${fmt(subsMonthly)} /mo`),
        h('div', { class: 'row-list' }, ...S.subscriptions.slice()
          .sort((a, b) => monthlyCost(b) - monthlyCost(a)).slice(0, 4).map((sub) =>
            h('div', { class: 'row clickable', onclick: () => go('recurring') },
              h('div', { class: 'r-icon' }, catById(sub.category)?.icon || '🔁'),
              h('div', { class: 'r-main' },
                h('div', { class: 'r-title' }, sub.name),
                h('div', { class: 'r-sub' }, freqLabel(sub.frequency))),
              h('div', { class: 'r-amt' }, fmt(Number(sub.amount) || 0)))))) : null));
  }

  if (S.goals.length) {
    main.append(card(cardHead(null, 'Goals',
      h('a', { href: '#/goals', onclick: (e) => { e.preventDefault(); go('goals'); } }, 'All →')),
      ...S.goals.slice(0, 3).map(goalRow)));
  }
}

function startRow(ic, title, sub, onclick) {
  return h('div', { class: 'row clickable', onclick },
    h('div', { class: 'r-icon', html: icon(ic, 18) }),
    h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, title), h('div', { class: 'r-sub' }, sub)),
    h('span', { class: 'ic-wrap chev', html: icon('chevronRight', 15) }));
}

function donutWithLegend(entries, mode, total, { limit = 12 } = {}) {
  const top = entries.slice(0, limit);
  const rest = entries.slice(limit).reduce((s, x) => s + x.total, 0);
  const slices = top.map((e, i) => ({
    name: mode === 'group' ? e.key : (e.cat?.name || 'Uncategorized'),
    value: e.total, display: fmt(e.total), color: sliceColor(e, i, mode),
  }));
  if (rest > 0) slices.push({ name: 'Everything else', value: rest, display: fmt(rest), color: cssVar('--ink-3') });

  const sum = slices.reduce((s, x) => s + x.value, 0) || 1;
  return h('div', { class: 'donut-layout' },
    donut(slices, { size: 200, centerValue: fmt(total), centerLabel: 'Total' }),
    h('div', { class: 'legend-grid' }, ...slices.map((s) =>
      h('div', { class: 'key' },
        h('span', { class: 'dot', style: `background:${s.color}` }),
        h('div', {}, h('span', { class: 'nm' }, s.name),
          h('span', { class: 'val' }, `${s.display} (${((s.value / sum) * 100).toFixed(1)}%)`))))));
}

/* -------------------------------- accounts ------------------------------ */

function accountRow(a, i) {
  const [, typeLabel] = typeMeta(a.type);
  const v = accountSigned(a);
  const hist = (a.history || []).map((p) => p.balance);
  return h('div', { class: 'row clickable', onclick: () => accountModal(a) },
    acctLogo(a, i),
    h('div', { class: 'r-main' },
      h('div', { class: 'r-title' }, a.name),
      h('div', { class: 'r-sub' }, typeLabel)),
    sparkline(hist.concat(a.balance), { color: cssVar('--ink-3') }),
    h('div', { class: 'r-amt', style: v < 0 ? 'color:var(--neg)' : '' }, fmt(Math.abs(a.balance) * (v < 0 ? -1 : 1))),
    h('span', { class: 'ic-wrap chev', html: icon('chevronRight', 15) }));
}

function pageAccounts(main) {
  setTopbar('Accounts', [], [
    h('button', { class: 'btn', onclick: () => { render(); toast('Balances refreshed'); } },
      h('span', { class: 'ic-wrap', html: icon('refresh', 15) }), lbl('Refresh all')),
    h('button', { class: 'btn btn-primary', onclick: () => accountModal(null) },
      h('span', { class: 'ic-wrap', html: icon('plus', 15) }), lbl('Add account')),
  ]);

  if (!S.accounts.length) {
    main.append(card(emptyState('🏦',
      'No accounts yet. Add checking, savings, cards, investments, and property to see your full picture.',
      'Add account', () => accountModal(null))));
    return;
  }

  // Net worth header chart
  const series = netWorthSeries();
  const nw = netWorth();
  const cutoff = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, ALL: 1e5 }[S.nwRange];
  const from = new Date(Date.now() - cutoff * 864e5).toISOString().slice(0, 10);
  let pts = series.filter((p) => p.date >= from);
  if (pts.length < 2) pts = series.slice(-2);
  const first = pts[0]?.value ?? nw;
  const rangeSeg = h('div', { class: 'seg' }, ...['1M', '3M', '6M', '1Y', 'ALL'].map((r) =>
    h('button', { class: S.nwRange === r ? 'active' : '', onclick: () => { S.nwRange = r; render(); } }, r)));

  main.append(card(
    h('div', { class: 'card-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, 'Net worth'),
        h('div', { class: 'hero-number' }, fmt(nw)),
        pts.length >= 2 ? deltaEl(nw - first, first ? ((nw - first) / Math.abs(first)) * 100 : 0,
          `${S.nwRange === 'ALL' ? 'all time' : S.nwRange} change`) : null),
      h('div', { class: 'tools' }, rangeSeg)),
    pts.length >= 2
      ? lineChart(pts.map((p) => ({ value: p.value, label: fmtDate(p.date), tipLabel: fmtDateLong(p.date), display: fmt(p.value) })), { height: 210 })
      : h('div', { class: 'empty' }, h('p', {}, 'Update balances over time to grow this chart.')),
    chartTable(['Date', 'Net worth'], pts.map((p) => [fmtDateLong(p.date), fmt(p.value)]))));

  // Accounts grouped by section + summary sidebar
  const listCard = card();
  let idx = 0;
  for (const [section, accts] of accountSections()) {
    const total = accts.reduce((s, a) => s + accountSigned(a), 0);
    listCard.append(h('div', { class: 'acct-group' },
      h('span', { class: 'g-name' }, section),
      h('span', { class: 'g-total', style: total < 0 ? 'color:var(--neg)' : '' }, fmt(total))));
    listCard.append(h('div', { class: 'row-list' }, ...accts.map((a) => accountRow(a, idx++))));
  }

  const { assets, debts } = assetsAndDebts();
  const assetSegs = [], debtSegs = [];
  let ci = 0;
  for (const [section, accts] of accountSections()) {
    const total = accts.reduce((s, a) => s + accountSigned(a), 0);
    const color = cssVar(ACCT_COLORS[ci++ % ACCT_COLORS.length]);
    if (total >= 0) assetSegs.push({ name: section, value: total, display: fmt(total), color });
    else debtSegs.push({ name: section, value: -total, display: fmt(-total), color });
  }

  const summary = card(
    cardHead(null, 'Summary'),
    h('div', { class: 'sum-row' }, h('span', { class: 'k' }, 'Assets'), h('span', { class: 'v' }, fmt(assets))),
    assetSegs.length ? stackedBar(assetSegs) : null,
    h('div', { class: 'legend-list' }, ...assetSegs.map((s) =>
      h('div', { class: 'key' }, h('span', { class: 'dot', style: `background:${s.color}` }),
        h('span', { class: 'nm' }, s.name), h('span', { class: 'val' }, s.display)))),
    h('div', { style: 'height:18px' }),
    h('div', { class: 'sum-row' }, h('span', { class: 'k' }, 'Liabilities'), h('span', { class: 'v' }, fmt(debts))),
    debtSegs.length ? stackedBar(debtSegs) : null,
    h('div', { class: 'legend-list' }, ...debtSegs.map((s) =>
      h('div', { class: 'key' }, h('span', { class: 'dot', style: `background:${s.color}` }),
        h('span', { class: 'nm' }, s.name), h('span', { class: 'val' }, s.display)))),
  );

  main.append(h('div', { class: 'grid-side' }, listCard, summary));
}

function accountModal(a) {
  const isNew = !a;
  const d = a ? { ...a } : { name: '', type: 'checking', balance: '', institution: '' };
  const form = h('form', { class: 'form-grid' },
    field('Account name', h('input', { name: 'name', value: d.name, required: true, placeholder: 'e.g. Everyday Checking' })),
    h('div', { class: 'two-col' },
      field('Institution', h('input', { name: 'institution', value: d.institution || '', placeholder: 'e.g. Chase' })),
      field('Type', h('select', { name: 'type' }, ...ACCOUNT_TYPES.map(([v, l]) =>
        h('option', { value: v, selected: d.type === v }, l))))),
    field(LIABILITY_TYPES.has(d.type) ? 'Balance owed' : 'Current balance',
      h('input', { name: 'balance', type: 'number', step: '0.01', inputmode: 'decimal', value: d.balance, required: true, placeholder: '0.00' })),
  );
  openModal(isNew ? 'Add account' : 'Edit account', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'), type: fd.get('type'),
        institution: fd.get('institution'),
        balance: parseFloat(fd.get('balance')) || 0,
      };
      if (isNew) S.accounts.push(await api('/api/accounts', 'POST', body));
      else Object.assign(a, await api('/api/accounts/' + a.id, 'PUT', body));
      toast(isNew ? 'Account added' : 'Account updated');
      render();
    },
    onDelete: isNew ? null : async () => {
      if (!confirm(`Delete "${a.name}"? Its transactions stay but lose their account link.`)) return false;
      await api('/api/accounts/' + a.id, 'DELETE');
      S.accounts = S.accounts.filter((x) => x.id !== a.id);
      toast('Account deleted');
      render();
    },
  });
}

/* ------------------------------ transactions ---------------------------- */

function pageTransactions(main) {
  setTopbar('Transactions', [], [
    dateRangeButton(),
    h('button', { class: 'btn', onclick: importModal },
      h('span', { class: 'ic-wrap', html: icon('upload', 15) }), lbl('Import CSV')),
    h('button', { class: 'btn btn-primary', onclick: () => txModal(null) },
      h('span', { class: 'ic-wrap', html: icon('plus', 15) }), lbl('Add')),
  ]);

  const f = S.txFilter;
  main.append(h('div', { class: 'filters' },
    h('input', { type: 'search', placeholder: 'Search merchant or notes…', value: f.q, oninput: (e) => { f.q = e.target.value; renderList(); } }),
    h('select', { onchange: (e) => { f.cat = e.target.value; renderList(); } },
      h('option', { value: '' }, 'All categories'),
      ...S.categories.map((c) => h('option', { value: c.id, selected: f.cat === c.id }, `${c.icon} ${c.name}`))),
    h('select', { onchange: (e) => { f.acct = e.target.value; renderList(); } },
      h('option', { value: '' }, 'All accounts'),
      ...S.accounts.map((a) => h('option', { value: a.id, selected: f.acct === a.id }, a.name)))));

  const listCard = card();
  listCard.className = 'card card-pad-0';
  const summary = card();
  main.append(h('div', { class: 'grid-side' }, listCard, summary));

  function renderList() {
    const q = f.q.trim().toLowerCase();
    const list = txInRange().filter((t) =>
      (!q || (t.merchant || '').toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q)) &&
      (!f.cat || t.category === f.cat) && (!f.acct || t.accountId === f.acct));

    listCard.innerHTML = '';
    summary.innerHTML = '';

    if (!list.length) {
      listCard.append(h('div', { style: 'padding:18px' },
        emptyState('🧾', S.transactions.length ? 'Nothing matches these filters.' : 'No transactions yet.',
          'Add transaction', () => txModal(null))));
      return;
    }

    // Group by date, with a per-day total in the header.
    const byDate = new Map();
    for (const t of list) {
      if (!byDate.has(t.date)) byDate.set(t.date, []);
      byDate.get(t.date).push(t);
    }
    for (const [date, txs] of byDate) {
      const dayTotal = txs.reduce((s, t) => s + t.amount, 0);
      listCard.append(h('div', { class: 'date-group' },
        h('span', {}, fmtDateLong(date)),
        h('span', { style: dayTotal > 0 ? 'color:var(--pos)' : '' }, fmtSign(dayTotal))));
      const wrap = h('div', { class: 'row-list', style: 'padding:0 14px' });
      for (const t of txs) wrap.append(txRow(t, { showDate: false }));
      listCard.append(wrap);
    }

    const T = totalsFor(list);
    const largest = list.reduce((m, t) => Math.max(m, Math.abs(t.amount)), 0);
    summary.append(cardHead(null, 'Summary'),
      row2('Total transactions', String(list.length)),
      row2('Largest transaction', fmt(largest)),
      row2('Average transaction', fmt(list.reduce((s, t) => s + Math.abs(t.amount), 0) / list.length)),
      row2('Total income', fmt(T.income)),
      row2('Total spending', fmt(T.expense)),
      h('div', { style: 'margin-top:14px' },
        h('button', { class: 'btn btn-sm', onclick: () => downloadCSV(list) }, 'Download CSV')));
  }
  renderList();
}

function row2(k, v) {
  return h('div', { class: 'sum-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
}

function downloadCSV(list) {
  const esc2 = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Date', 'Merchant', 'Category', 'Account', 'Amount', 'Notes'].join(',')];
  for (const t of list) {
    lines.push([t.date, esc2(t.merchant), esc2(catById(t.category)?.name || ''),
      esc2(acctById(t.accountId)?.name || ''), t.amount, esc2(t.notes)].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `finch-transactions-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function txModal(t) {
  const isNew = !t;
  const d = t ? { ...t } : {
    date: todayISO(), merchant: '', category: '',
    accountId: S.accounts[0]?.id || '', amount: '', notes: '',
  };
  let sign = t && t.amount > 0 ? 1 : -1;
  const expBtn = h('button', { type: 'button' }, 'Expense');
  const incBtn = h('button', { type: 'button' }, 'Income');
  const sync = () => {
    expBtn.className = sign < 0 ? 'active-exp' : '';
    incBtn.className = sign > 0 ? 'active-inc' : '';
  };
  expBtn.onclick = () => { sign = -1; sync(); };
  incBtn.onclick = () => { sign = 1; sync(); };
  sync();

  const byGroup = new Map();
  for (const c of S.categories) {
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push(c);
  }
  const optGroups = [...byGroup.entries()].map(([g, cats]) =>
    h('optgroup', { label: g }, ...cats.map((c) =>
      h('option', { value: c.id, selected: d.category === c.id }, `${c.icon} ${c.name}`))));

  const form = h('form', { class: 'form-grid' },
    h('div', { class: 'sign-toggle' }, expBtn, incBtn),
    field('Amount', h('input', {
      name: 'amount', type: 'number', step: '0.01', min: '0', inputmode: 'decimal',
      required: true, value: t ? Math.abs(t.amount) : '', placeholder: '0.00',
    })),
    field('Merchant / description', h('input', { name: 'merchant', value: d.merchant, required: true, placeholder: 'e.g. Whole Foods' })),
    h('div', { class: 'two-col' },
      field('Date', h('input', { name: 'date', type: 'date', value: d.date, required: true })),
      field('Account', h('select', { name: 'accountId' },
        h('option', { value: '' }, '— none —'),
        ...S.accounts.map((a) => h('option', { value: a.id, selected: d.accountId === a.id }, a.name))))),
    field('Category', h('select', { name: 'category' }, ...optGroups)),
    field('Notes', h('input', { name: 'notes', value: d.notes || '', placeholder: 'Optional' })),
  );

  openModal(isNew ? 'Add transaction' : 'Edit transaction', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = {
        date: fd.get('date'), merchant: fd.get('merchant'), category: fd.get('category'),
        accountId: fd.get('accountId'), notes: fd.get('notes'),
        amount: sign * Math.abs(parseFloat(fd.get('amount')) || 0),
      };
      if (isNew) S.transactions.push(await api('/api/transactions', 'POST', body));
      else Object.assign(t, await api('/api/transactions/' + t.id, 'PUT', body));
      S.transactions.sort((a, b) => b.date.localeCompare(a.date));
      toast(isNew ? 'Transaction added' : 'Saved');
      render();
    },
    onDelete: isNew ? null : async () => {
      await api('/api/transactions/' + t.id, 'DELETE');
      S.transactions = S.transactions.filter((x) => x.id !== t.id);
      toast('Deleted');
      render();
    },
  });
}

/* -------------------------------- cash flow ----------------------------- */

function pageCashflow(main) {
  setTopbar('Cash Flow', [], [dateRangeButton()]);
  const agg = monthAgg(6);
  const T = totalsFor(txInRange());

  main.append(h('div', { class: 'kpi-row' },
    kpi(fmt(T.income), 'Total income', 'pos'),
    kpi(fmt(T.expense), 'Total expenses', 'neg'),
    kpi(fmt(T.net), 'Net income'),
    kpi(fmtPct(T.rate), 'Savings rate')));

  const hasData = agg.some((d) => d.income || d.expense);
  const c = card(cardHead('Cash flow', 'Income vs expenses · last 6 months'));
  if (hasData) {
    c.append(
      groupedBars(agg, [
        { key: 'income', name: 'Income', color: '--income' },
        { key: 'expense', name: 'Expenses', color: '--expense' },
      ], { height: 250, fmtValue: fmt }),
      h('div', { class: 'legend' },
        h('span', { class: 'key' }, h('span', { class: 'swatch', style: 'background:var(--income)' }), 'Income'),
        h('span', { class: 'key' }, h('span', { class: 'swatch', style: 'background:var(--expense)' }), 'Expenses')),
      chartTable(['Month', 'Income', 'Expenses', 'Net'],
        agg.map((d) => [fmtMonth(d.key), fmt(d.income), fmt(d.expense), fmtSign(d.income - d.expense)])));
  } else {
    c.append(emptyState('📊', 'Add transactions to see income vs expenses.', 'Add transaction', () => txModal(null)));
  }
  main.append(c);

  // Net savings per month
  if (hasData) {
    main.append(card(cardHead(null, 'Net savings by month'),
      h('div', { class: 'row-list' }, ...agg.slice().reverse().map((d) => {
        const net = d.income - d.expense;
        return h('div', { class: 'row' },
          h('div', { class: 'r-main' },
            h('div', { class: 'r-title' }, fmtMonth(d.key)),
            h('div', { class: 'r-sub' }, `In ${fmt(d.income)} · out ${fmt(d.expense)}`)),
          h('div', { class: 'r-amt', style: net >= 0 ? 'color:var(--pos)' : 'color:var(--neg)' }, fmtSign(net)));
      }))));
  }
}

/* --------------------------------- reports ------------------------------ */

function pageReports(main) {
  const tabs = [['cashflow', 'Cash Flow'], ['spending', 'Spending'], ['income', 'Income']];
  if (!S.tab || !tabs.some((t) => t[0] === S.tab)) S.tab = 'cashflow';
  setTopbar('Reports', tabs, [dateRangeButton(), filtersButton()]);

  const txs = txInRange();
  const T = totalsFor(txs);
  main.append(h('div', { class: 'kpi-row' },
    kpi(fmt(T.income), 'Total income', 'pos'),
    kpi(fmt(T.expense), 'Total expenses', 'neg'),
    kpi(fmt(T.net), 'Total net income'),
    kpi(fmtPct(T.rate), 'Savings rate')));

  if (S.tab === 'cashflow') reportCashFlow(main, txs, T);
  else if (S.tab === 'spending') reportSpending(main, txs, T);
  else reportIncome(main, txs, T);
}

// Sankey: income categories → Income → savings + expense groups → categories.
function reportCashFlow(main, txs, T) {
  const c = card(cardHead('Cash flow', rangeText()));
  if (!T.income && !T.expense) {
    c.append(emptyState('🌊', 'No activity in this period. Pick a wider date range or add transactions.',
      'Add transaction', () => txModal(null)));
    main.append(c);
    return;
  }

  const nodes = [], links = [];
  const pct = (v) => `${fmt(v)} (${((v / (T.income || 1)) * 100).toFixed(2)}%)`;
  // On a phone the four-column diagram is unreadable, so stop at the group
  // column; the per-category split stays available on Spending and in the table.
  const compact = window.innerWidth < 760;

  // Column 0: income sources.
  const incomes = incomeBy(txs);
  for (const e of incomes) {
    const id = 'in_' + e.key;
    nodes.push({
      id, col: 0, label: `${e.cat?.icon || '💰'} ${e.cat?.name || 'Income'}`,
      display: pct(e.total), color: cssVar('--income'),
    });
    links.push({ source: id, target: 'income', value: e.total, display: pct(e.total), color: cssVar('--income') });
  }
  // Column 1: the income hub.
  nodes.push({ id: 'income', col: 1, label: 'Income', display: pct(T.income), color: cssVar('--income') });

  // Column 2: savings + expense groups. Column 3: categories.
  const byCat = spendBy(txs, 'category');
  const groups = new Map();
  for (const e of byCat) {
    const g = e.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }

  if (T.net > 0) {
    nodes.push({ id: 'savings', col: 2, label: 'Savings', display: pct(T.net), color: cssVar('--savings') });
    links.push({ source: 'income', target: 'savings', value: T.net, display: pct(T.net), color: cssVar('--savings') });
  }

  for (const g of GROUP_ORDER) {
    const entries = groups.get(g);
    if (!entries) continue;
    const gTotal = entries.reduce((s, e) => s + e.total, 0);
    const gid = 'g_' + g.replace(/\W/g, '');
    const color = groupColor(g);
    nodes.push({ id: gid, col: 2, label: g, display: pct(gTotal), color });
    links.push({ source: 'income', target: gid, value: gTotal, display: pct(gTotal), color });
    if (compact) continue;
    for (const e of entries) {
      const cid = 'c_' + e.key;
      nodes.push({
        id: cid, col: 3, label: `${e.cat?.icon || ''} ${e.cat?.name || 'Uncategorized'}`.trim(),
        display: pct(e.total), color,
      });
      links.push({ source: gid, target: cid, value: e.total, display: pct(e.total), color });
    }
  }

  const leafCount = nodes.filter((n) => n.col === (compact ? 2 : 3)).length;
  const height = compact
    ? Math.max(360, leafCount * 58 + 80)
    : Math.max(420, Math.min(1100, leafCount * 46 + 120));
  const chart = sankey(nodes, links, { height });
  if (compact) chart.classList.add('compact');
  c.append(h('div', { class: 'sankey-scroll' }, chart));
  c.append(chartTable(['Flow', 'Amount'],
    links.map((l) => [`${nodes.find((n) => n.id === l.source).label} → ${nodes.find((n) => n.id === l.target).label}`, fmt(l.value)])));
  main.append(c);
}

function reportSpending(main, txs, T) {
  const mode = S.spendMode;
  const entries = spendBy(txs, mode);
  const c = card(
    h('div', { class: 'card-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, 'Spending by ' + mode),
        h('h3', {}, rangeText())),
      h('div', { class: 'tools' },
        h('div', { class: 'seg' },
          h('button', { class: mode === 'category' ? 'active' : '', onclick: () => { S.spendMode = 'category'; render(); } }, 'By category'),
          h('button', { class: mode === 'group' ? 'active' : '', onclick: () => { S.spendMode = 'group'; render(); } }, 'By group'))))
  );

  if (!entries.length) {
    c.append(emptyState('🧾', 'No spending in this period.', 'Add transaction', () => txModal(null)));
    main.append(c);
    return;
  }
  c.append(donutWithLegend(entries, mode, T.expense));
  c.append(chartTable([mode === 'group' ? 'Group' : 'Category', 'Amount', 'Share'],
    entries.map((e) => [mode === 'group' ? e.key : (e.cat?.name || 'Uncategorized'),
      fmt(e.total), fmtPct((e.total / (T.expense || 1)) * 100)])));
  main.append(c);

  // Transactions + summary underneath, like the reference layout.
  const spendTx = txs.filter((t) => t.amount < 0).sort((a, b) => b.date.localeCompare(a.date));
  const listCard = h('div', { class: 'card card-pad-0' });
  const byDate = new Map();
  for (const t of spendTx.slice(0, 120)) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  listCard.append(h('div', { style: 'padding:16px 16px 0' }, cardHead(null, 'Transactions')));
  for (const [date, list] of byDate) {
    listCard.append(h('div', { class: 'date-group' },
      h('span', {}, fmtDateLong(date)),
      h('span', {}, fmt(list.reduce((s, t) => s + -t.amount, 0)))));
    const wrap = h('div', { class: 'row-list', style: 'padding:0 14px' });
    for (const t of list) wrap.append(txRow(t, { showDate: false }));
    listCard.append(wrap);
  }

  const amounts = spendTx.map((t) => -t.amount);
  const summary = card(cardHead(null, 'Summary'),
    row2('Total transactions', String(spendTx.length)),
    row2('Largest transaction', fmt(Math.max(0, ...amounts))),
    row2('Average transaction', fmt(amounts.length ? amounts.reduce((s, x) => s + x, 0) / amounts.length : 0)),
    row2('Total spending', fmt(T.expense)),
    h('div', { style: 'margin-top:14px' },
      h('button', { class: 'btn btn-sm', onclick: () => downloadCSV(spendTx) }, 'Download CSV')));

  main.append(h('div', { class: 'grid-side' }, listCard, summary));
}

function reportIncome(main, txs, T) {
  const entries = incomeBy(txs);
  const c = card(cardHead('Income by category', rangeText()));
  if (!entries.length) {
    c.append(emptyState('💰', 'No income recorded in this period.', 'Add transaction', () => txModal(null)));
    main.append(c);
    return;
  }
  const slices = entries.map((e, i) => ({
    name: e.cat?.name || 'Income', value: e.total, display: fmt(e.total),
    color: i === 0 ? cssVar('--income') : cssVar(ACCT_COLORS[i % ACCT_COLORS.length]),
  }));
  const sum = T.income || 1;
  c.append(h('div', { class: 'donut-layout' },
    donut(slices, { size: 200, centerValue: fmt(T.income), centerLabel: 'Total' }),
    h('div', { class: 'legend-grid' }, ...slices.map((s) =>
      h('div', { class: 'key' },
        h('span', { class: 'dot', style: `background:${s.color}` }),
        h('div', {}, h('span', { class: 'nm' }, s.name),
          h('span', { class: 'val' }, `${s.display} (${((s.value / sum) * 100).toFixed(1)}%)`)))))));
  c.append(chartTable(['Category', 'Amount'], entries.map((e) => [e.cat?.name || 'Income', fmt(e.total)])));
  main.append(c);

  const incomeTx = txs.filter((t) => t.amount > 0).sort((a, b) => b.date.localeCompare(a.date));
  main.append(card(cardHead(null, 'Income transactions'),
    h('div', { class: 'row-list' }, ...incomeTx.slice(0, 40).map((t) => txRow(t)))));
}

/* --------------------------------- budget -------------------------------- */

function budgetList(limit) {
  const mk = thisMonth();
  const spend = new Map(spendBy(S.transactions.filter((t) => monthKey(t.date) === mk), 'category')
    .map((x) => [x.key, x.total]));
  let entries = Object.entries(S.budgets)
    .map(([id, amt]) => ({ cat: catById(id), amt, spent: spend.get(id) || 0 }))
    .filter((x) => x.cat)
    .sort((a, b) => b.spent / b.amt - a.spent / a.amt);
  if (limit) entries = entries.slice(0, limit);
  return h('div', {}, ...entries.map(({ cat, amt, spent }) => {
    const pctN = Math.min(100, (spent / amt) * 100);
    const over = spent > amt;
    return h('div', { class: 'budget-row' },
      h('div', { class: 'b-top' },
        h('div', { class: 'b-name' }, h('span', {}, cat.icon), h('span', {}, cat.name)),
        h('div', { class: 'b-nums' }, h('b', {}, fmt(spent)), ` of ${fmt(amt)}`)),
      h('div', { class: 'meter' }, h('i', { class: over ? 'over' : pctN > 85 ? '' : 'ok', style: `width:${pctN}%` })),
      h('div', { class: 'r-sub', style: `margin-top:4px;color:${over ? 'var(--neg)' : 'var(--ink-3)'}` },
        over ? `${fmt(spent - amt)} over budget` : `${fmt(amt - spent)} left`));
  }));
}

function pageBudget(main) {
  const mk = thisMonth();
  setTopbar('Budget', [], [h('button', { class: 'btn btn-primary', onclick: budgetEditModal }, 'Edit budget')]);

  const entries = Object.entries(S.budgets).map(([id, amt]) => ({ id, amt, cat: catById(id) })).filter((x) => x.cat);
  if (!entries.length) {
    main.append(card(emptyState('🎯',
      'Set monthly limits per category and Finch tracks how you are doing against them.',
      'Set up budget', budgetEditModal)));
    return;
  }

  const spend = new Map(spendBy(S.transactions.filter((t) => monthKey(t.date) === mk), 'category')
    .map((x) => [x.key, x.total]));
  const totalBudget = entries.reduce((s, x) => s + x.amt, 0);
  const totalSpent = entries.reduce((s, x) => s + (spend.get(x.id) || 0), 0);

  main.append(h('div', { class: 'kpi-row' },
    kpi(fmt(totalBudget), 'Budgeted'),
    kpi(fmt(totalSpent), 'Spent so far'),
    kpi(fmt(totalBudget - totalSpent), 'Remaining', totalBudget - totalSpent < 0 ? 'neg' : 'pos'),
    kpi(fmtMonth(mk), 'Period')));

  // Grouped like the category tree.
  const byGroup = new Map();
  for (const e of entries) {
    const g = e.cat.group || 'Other';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(e);
  }
  const c = card();
  for (const g of GROUP_ORDER) {
    const list = byGroup.get(g);
    if (!list) continue;
    const gBudget = list.reduce((s, x) => s + x.amt, 0);
    const gSpent = list.reduce((s, x) => s + (spend.get(x.id) || 0), 0);
    c.append(h('div', { class: 'group-head' },
      h('span', { style: `color:${groupColor(g)}` }, g),
      h('span', { class: 'gt' }, `${fmt(gSpent)} of ${fmt(gBudget)}`)));
    for (const { cat, amt, id } of list.sort((a, b) => (spend.get(b.id) || 0) - (spend.get(a.id) || 0))) {
      const spent = spend.get(id) || 0;
      const pctN = Math.min(100, (spent / amt) * 100);
      const over = spent > amt;
      c.append(h('div', { class: 'budget-row' },
        h('div', { class: 'b-top' },
          h('div', { class: 'b-name' }, h('span', {}, cat.icon), h('span', {}, cat.name)),
          h('div', { class: 'b-nums' }, h('b', {}, fmt(spent)), ` of ${fmt(amt)}`)),
        h('div', { class: 'meter' }, h('i', { class: over ? 'over' : pctN > 85 ? '' : 'ok', style: `width:${pctN}%` })),
        h('div', { class: 'r-sub', style: `margin-top:4px;color:${over ? 'var(--neg)' : 'var(--ink-3)'}` },
          over ? `${fmt(spent - amt)} over budget` : `${fmt(amt - spent)} left`)));
    }
  }
  main.append(c);
}

function budgetEditModal() {
  const expCats = S.categories.filter((c) => c.type !== 'income');
  const form = h('form', { class: 'form-grid' });
  const byGroup = new Map();
  for (const c of expCats) {
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push(c);
  }
  for (const [g, cats] of byGroup) {
    form.append(h('div', { class: 'group-head' }, h('span', { style: `color:${groupColor(g)}` }, g)));
    for (const c of cats) {
      form.append(h('div', { class: 'two-col', style: 'align-items:center' },
        h('div', { style: 'font-weight:600;font-size:14px' }, `${c.icon} ${c.name}`),
        h('input', {
          name: c.id, type: 'number', min: '0', step: '1', inputmode: 'decimal',
          value: S.budgets[c.id] || '', placeholder: '—',
        })));
    }
  }
  openModal('Monthly budget', form, {
    saveLabel: 'Save budget',
    onSave: async () => {
      const fd = new FormData(form);
      const body = {};
      for (const c of expCats) body[c.id] = parseFloat(fd.get(c.id)) || 0;
      S.budgets = await api('/api/budgets', 'PUT', body);
      toast('Budget saved');
      render();
    },
  });
}

/* -------------------------------- recurring ------------------------------ */

function pageRecurring(main) {
  setTopbar('Recurring', [], []);
  const items = recurringItems();
  if (!items.length) {
    main.append(card(emptyState('🔁',
      'Finch spots recurring payments automatically once a merchant shows up in three or more months.',
      'Add transaction', () => txModal(null))));
    return;
  }
  const monthly = items.reduce((s, x) => s + x.avg, 0);
  const fixed = items.filter((x) => x.fixed);
  main.append(h('div', { class: 'kpi-row' },
    kpi(String(items.length), 'Recurring merchants'),
    kpi(fmt(monthly), 'Est. monthly total'),
    kpi(fmt(monthly * 12), 'Est. yearly total'),
    kpi(String(fixed.length), 'Fixed amount')));

  main.append(card(
    cardHead(null, 'Detected recurring payments'),
    h('div', { class: 'row-list' }, ...items.map((it) => {
      const c = catById(it.category);
      return h('div', { class: 'row' },
        h('div', { class: 'r-icon' }, c?.icon || '🔁'),
        h('div', { class: 'r-main' },
          h('div', { class: 'r-title' }, it.merchant),
          h('div', { class: 'r-sub' },
            `${c?.name || 'Uncategorized'} · ${it.fixed ? 'fixed' : 'variable'} · next ~${fmtDate(it.next, true)}`)),
        h('div', { class: 'r-amt' }, fmt(it.avg),
          h('div', { class: 'r-sub' }, `${it.count} payments`)));
    }))));
}

/* ---------------------------------- goals -------------------------------- */

function goalRow(g) {
  const pct = Math.min(100, (g.saved / g.target) * 100 || 0);
  return h('div', { class: 'budget-row goal-card', style: 'cursor:pointer', onclick: () => goalModal(g) },
    h('div', { class: 'goal-emoji' }, g.icon || '🚩'),
    h('div', { class: 'goal-info' },
      h('div', { class: 'b-top' },
        h('div', { class: 'b-name' }, g.name),
        h('div', { class: 'goal-pct' }, Math.round(pct) + '%')),
      h('div', { class: 'meter' }, h('i', { class: 'ok', style: `width:${pct}%` })),
      h('div', { class: 'r-sub', style: 'margin-top:4px' },
        `${fmt(g.saved)} of ${fmt(g.target)}` + (g.targetDate ? ` · by ${fmtDate(g.targetDate, true)}` : ''))));
}

function pageGoals(main) {
  setTopbar('Goals', [], [h('button', { class: 'btn btn-primary', onclick: () => goalModal(null) },
    h('span', { class: 'ic-wrap', html: icon('plus', 15) }), lbl('Add goal'))]);
  if (!S.goals.length) {
    main.append(card(emptyState('🚩',
      'Create savings goals — a trip, an emergency fund, a new laptop — and track progress.',
      'Add goal', () => goalModal(null))));
    return;
  }
  const target = S.goals.reduce((s, g) => s + g.target, 0);
  const saved = S.goals.reduce((s, g) => s + g.saved, 0);
  main.append(h('div', { class: 'kpi-row' },
    kpi(String(S.goals.length), 'Active goals'),
    kpi(fmt(saved), 'Saved'),
    kpi(fmt(target), 'Target'),
    kpi(fmtPct(target ? (saved / target) * 100 : 0), 'Progress')));
  main.append(card(...S.goals.map(goalRow)));
}

function goalModal(g) {
  const isNew = !g;
  const d = g ? { ...g } : { name: '', icon: '🚩', target: '', saved: '', targetDate: '' };
  const form = h('form', { class: 'form-grid' },
    h('div', { class: 'two-col' },
      field('Emoji', h('input', { name: 'icon', value: d.icon, maxlength: '4' })),
      field('Name', h('input', { name: 'name', value: d.name, required: true, placeholder: 'e.g. Japan trip' }))),
    h('div', { class: 'two-col' },
      field('Target amount', h('input', { name: 'target', type: 'number', min: '1', step: '0.01', inputmode: 'decimal', required: true, value: d.target })),
      field('Saved so far', h('input', { name: 'saved', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: d.saved }))),
    field('Target date (optional)', h('input', { name: 'targetDate', type: 'date', value: d.targetDate || '' })));
  openModal(isNew ? 'Add goal' : 'Edit goal', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'), icon: fd.get('icon') || '🚩',
        target: parseFloat(fd.get('target')) || 0,
        saved: parseFloat(fd.get('saved')) || 0,
        targetDate: fd.get('targetDate'),
      };
      if (isNew) S.goals.push(await api('/api/goals', 'POST', body));
      else Object.assign(g, await api('/api/goals/' + g.id, 'PUT', body));
      toast(isNew ? 'Goal added' : 'Saved');
      render();
    },
    onDelete: isNew ? null : async () => {
      await api('/api/goals/' + g.id, 'DELETE');
      S.goals = S.goals.filter((x) => x.id !== g.id);
      toast('Goal deleted');
      render();
    },
  });
}

/* ------------------------------- investments ----------------------------- */

function pageInvestments(main) {
  setTopbar('Investments', [], []);
  const accts = S.accounts.filter((a) => a.type === 'investment');
  if (!accts.length) {
    main.append(card(emptyState('📈',
      'Add an investment account to track portfolio value over time.',
      'Add account', () => accountModal(null))));
    return;
  }
  const total = accts.reduce((s, a) => s + a.balance, 0);
  const series = netWorthSeries(accts);
  const first = series[0]?.value || total;
  const change = total - first;

  main.append(h('div', { class: 'kpi-row' },
    kpi(fmt(total), 'Portfolio value'),
    kpi(fmtSign(change), 'Change', change >= 0 ? 'pos' : 'neg'),
    kpi(fmtPct(first ? (change / first) * 100 : 0), 'Return'),
    kpi(String(accts.length), 'Accounts')));

  if (series.length >= 2) {
    main.append(card(cardHead(null, 'Portfolio value'),
      lineChart(series.map((p) => ({
        value: p.value, label: fmtDate(p.date), tipLabel: fmtDateLong(p.date), display: fmt(p.value),
      })), { height: 220, color: cssVar('--s3') }),
      chartTable(['Date', 'Value'], series.map((p) => [fmtDateLong(p.date), fmt(p.value)]))));
  }

  const segs = accts.map((a, i) => ({
    name: a.name, value: a.balance, display: fmt(a.balance),
    color: cssVar(ACCT_COLORS[i % ACCT_COLORS.length]),
  }));
  main.append(h('div', { class: 'grid-side' },
    card(cardHead(null, 'Holdings'),
      h('div', { class: 'row-list' }, ...accts.map((a, i) => accountRow(a, i)))),
    card(cardHead(null, 'Allocation'),
      stackedBar(segs),
      h('div', { class: 'legend-list' }, ...segs.map((s) =>
        h('div', { class: 'key' },
          h('span', { class: 'dot', style: `background:${s.color}` }),
          h('span', { class: 'nm' }, s.name),
          h('span', { class: 'val' }, `${((s.value / total) * 100).toFixed(1)}%`)))))));
}

/* ---------------------------------- advice ------------------------------- */

function pageAdvice(main) {
  setTopbar('Advice', [], []);
  const mk = thisMonth();
  const monthTx = S.transactions.filter((t) => monthKey(t.date) === mk);
  const T = totalsFor(monthTx);
  const items = [];

  if (T.income) {
    items.push(T.rate >= 20
      ? { tone: 'good', ic: 'check', t: `You are saving ${fmtPct(T.rate)} of your income`, d: 'That is a healthy rate. Consider moving the surplus into your goals or investments.' }
      : { tone: 'warn', ic: 'warning', t: `Your savings rate is ${fmtPct(T.rate)}`, d: 'Aiming for 20% is a common target. The categories below are the biggest levers.' });
  }

  const spend = new Map(spendBy(monthTx, 'category').map((x) => [x.key, x.total]));
  const over = Object.entries(S.budgets)
    .map(([id, amt]) => ({ cat: catById(id), amt, spent: spend.get(id) || 0 }))
    .filter((x) => x.cat && x.spent > x.amt)
    .sort((a, b) => b.spent - b.amt - (a.spent - a.amt));
  for (const o of over.slice(0, 3)) {
    items.push({
      tone: 'warn', ic: 'warning',
      t: `${o.cat.name} is ${fmt(o.spent - o.amt)} over budget`,
      d: `You have spent ${fmt(o.spent)} against a ${fmt(o.amt)} limit this month.`,
    });
  }

  const rec = recurringItems();
  if (rec.length) {
    const monthly = rec.reduce((s, x) => s + x.avg, 0);
    items.push({
      tone: 'info', ic: 'recurring',
      t: `${fmt(monthly)} per month in recurring payments`,
      d: `That is ${fmt(monthly * 12)} a year across ${rec.length} merchants. Cancelling the smallest three would free ${fmt(rec.slice(-3).reduce((s, x) => s + x.avg, 0) * 12)} a year.`,
    });
  }

  const { debts } = assetsAndDebts();
  if (debts > 0) {
    items.push({
      tone: 'info', ic: 'wallet',
      t: `${fmt(debts)} in liabilities`,
      d: 'Paying down the highest-rate balance first usually beats spreading extra payments evenly.',
    });
  }

  // Biggest month-over-month category swing.
  const prevKey = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const prev = new Map(spendBy(S.transactions.filter((t) => monthKey(t.date) === prevKey), 'category').map((x) => [x.key, x.total]));
  let biggest = null;
  for (const [id, amt] of spend) {
    const delta = amt - (prev.get(id) || 0);
    if (!biggest || delta > biggest.delta) biggest = { id, delta, amt };
  }
  if (biggest && biggest.delta > 0 && prev.size) {
    const c = catById(biggest.id);
    items.push({
      tone: 'info', ic: 'cashflow',
      t: `${c?.name || 'Spending'} is up ${fmt(biggest.delta)} vs last month`,
      d: `You have spent ${fmt(biggest.amt)} there this month.`,
    });
  }

  if (S.goals.length) {
    for (const g of S.goals) {
      if (!g.targetDate) continue;
      const monthsLeft = Math.max(1, Math.round((new Date(g.targetDate) - new Date()) / (30 * 864e5)));
      const need = Math.max(0, g.target - g.saved) / monthsLeft;
      items.push({
        tone: 'info', ic: 'goals',
        t: `Set aside ${fmt(need)} a month for ${g.name}`,
        d: `${fmt(g.target - g.saved)} to go with about ${monthsLeft} month${monthsLeft === 1 ? '' : 's'} left.`,
      });
    }
  }

  if (!items.length) {
    main.append(card(emptyState('💡', 'Add transactions, budgets, and goals and Finch will suggest things here.',
      'Load demo data', async () => { Object.assign(S, await api('/api/demo', 'POST')); render(); })));
    return;
  }

  main.append(card(cardHead(null, `Insights for ${fmtMonth(mk)}`),
    ...items.map((it) => h('div', { class: `insight ${it.tone}` },
      h('span', { class: 'ic-wrap', html: icon(it.ic, 17) }),
      h('div', {}, h('div', { class: 't' }, it.t), h('div', { class: 'd' }, it.d))))));
}

/* --------------------------------- more/settings ------------------------- */

function pageMore(main) {
  setTopbar('More', [], []);
  main.append(card(h('div', { class: 'row-list' },
    ...[['cashflow', 'Cash Flow', 'Income vs expenses over time'],
      ['budget', 'Budget', 'Monthly limits per category'],
      ['recurring', 'Recurring', 'Subscriptions and fixed bills'],
      ['bills', 'Left to pay', 'What you still owe, by due date'],
      ['wishlist', 'Wishlist', 'Things to buy later'],
      ['goals', 'Goals', 'Savings goals and progress'],
      ['investments', 'Investments', 'Portfolio value and allocation'],
      ['advice', 'Advice', 'Insights from your data'],
      ['settings', 'Settings', 'Currency, categories, security']]
      .map(([r, label, sub]) => startRow(NAV.find((n) => n[0] === r)?.[2] || 'list', label, sub, () => go(r))))));
}

function pageSettings(main) {
  setTopbar('Settings', [], []);
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'RUB', 'UAH', 'KZT', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'TRY', 'AED', 'INR', 'BRL'];

  main.append(card(cardHead(null, 'General'),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Your name'), h('div', { class: 's-sub' }, 'Shown in the greeting and sidebar')),
      h('input', {
        class: 'input', style: 'max-width:170px', value: S.settings.name || '', placeholder: 'Optional',
        onchange: async (e) => { S.settings = await api('/api/settings', 'PUT', { name: e.target.value }); toast('Saved'); buildChrome(); },
      })),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Currency'), h('div', { class: 's-sub' }, 'Display currency for all amounts')),
      h('select', {
        class: 'input',
        onchange: async (e) => { S.settings = await api('/api/settings', 'PUT', { currency: e.target.value }); toast('Saved'); render(); },
      }, ...CURRENCIES.map((c) => h('option', { value: c, selected: S.settings.currency === c }, c))))));

  // Categories grouped
  const byGroup = new Map();
  for (const c of S.categories) {
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push(c);
  }
  const catCard = card(cardHead(null, 'Categories'));
  for (const [g, cats] of byGroup) {
    catCard.append(h('div', { class: 'group-head' }, h('span', { style: `color:${groupColor(g)}` }, g)));
    catCard.append(h('div', { class: 'row-list' }, ...cats.map((c) =>
      h('div', { class: 'row clickable', onclick: () => categoryModal(c) },
        h('div', { class: 'r-icon' }, c.icon),
        h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, c.name),
          h('div', { class: 'r-sub' }, c.type === 'income' ? 'Income' : 'Spending')),
        h('span', { class: 'ic-wrap chev', html: icon('chevronRight', 15) })))));
  }
  catCard.append(h('div', { style: 'margin-top:12px' },
    h('button', { class: 'btn btn-sm', onclick: () => categoryModal(null) }, '+ Add category')));
  main.append(catCard);

  main.append(card(cardHead(null, 'Security'),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Change password'), h('div', { class: 's-sub' }, 'Signs out all other devices')),
      h('button', { class: 'btn btn-sm', onclick: passwordModal }, 'Change')),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Log out'), h('div', { class: 's-sub' }, 'End the session on this device')),
      h('button', { class: 'btn btn-sm', onclick: logout }, 'Log out'))));

  main.append(card(cardHead(null, 'Data'),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Import bank statement'),
        h('div', { class: 's-sub' }, 'Load a CSV export from your bank')),
      h('button', { class: 'btn btn-sm', onclick: importModal }, 'Import CSV')),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Export data'), h('div', { class: 's-sub' }, 'Download everything as JSON')),
      h('button', { class: 'btn btn-sm', onclick: exportData }, 'Export')),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Load demo data'), h('div', { class: 's-sub' }, 'Replaces current data with a sample dataset')),
      h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          if (!confirm('Replace current data with demo data?')) return;
          Object.assign(S, await api('/api/demo', 'POST'));
          toast('Demo data loaded'); render();
        },
      }, 'Load')),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Erase all data'), h('div', { class: 's-sub' }, 'Deletes accounts, transactions, budgets, goals')),
      h('button', {
        class: 'btn btn-sm btn-danger',
        onclick: async () => {
          if (!confirm('Erase ALL data? This cannot be undone.')) return;
          Object.assign(S, await api('/api/wipe', 'POST'));
          toast('All data erased'); render();
        },
      }, 'Erase'))));
}

function categoryModal(c) {
  const isNew = !c;
  const d = c ? { ...c } : { name: '', icon: '🏷️', type: 'expense', group: 'Other' };
  const groups = [...new Set(['Income', ...GROUP_ORDER, ...S.categories.map((x) => x.group)])];
  const form = h('form', { class: 'form-grid' },
    h('div', { class: 'two-col' },
      field('Emoji', h('input', { name: 'icon', value: d.icon, maxlength: '4' })),
      field('Name', h('input', { name: 'name', value: d.name, required: true }))),
    h('div', { class: 'two-col' },
      field('Type', h('select', { name: 'type' },
        h('option', { value: 'expense', selected: d.type !== 'income' }, 'Spending'),
        h('option', { value: 'income', selected: d.type === 'income' }, 'Income'))),
      field('Group', h('select', { name: 'group' },
        ...groups.map((g) => h('option', { value: g, selected: d.group === g }, g))))));
  openModal(isNew ? 'Add category' : 'Edit category', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'), icon: fd.get('icon') || '🏷️',
        type: fd.get('type'), group: fd.get('group'),
      };
      if (isNew) S.categories.push(await api('/api/categories', 'POST', body));
      else Object.assign(c, await api('/api/categories/' + c.id, 'PUT', body));
      toast('Saved'); render();
    },
    onDelete: isNew ? null : async () => {
      if (!confirm(`Delete category "${c.name}"?`)) return false;
      await api('/api/categories/' + c.id, 'DELETE');
      S.categories = S.categories.filter((x) => x.id !== c.id);
      delete S.budgets[c.id];
      toast('Deleted'); render();
    },
  });
}

function passwordModal() {
  const form = h('form', { class: 'form-grid' },
    field('Current password', h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
    field('New password', h('input', { name: 'next', type: 'password', required: true, minlength: '6', autocomplete: 'new-password' })));
  openModal('Change password', form, {
    saveLabel: 'Update',
    onSave: async () => {
      const fd = new FormData(form);
      await api('/api/password', 'PUT', { current: fd.get('current'), next: fd.get('next') });
      toast('Password changed');
    },
  });
}

function showAlerts() {
  const mk = thisMonth();
  const spend = new Map(spendBy(S.transactions.filter((t) => monthKey(t.date) === mk), 'category').map((x) => [x.key, x.total]));
  const over = Object.entries(S.budgets)
    .map(([id, amt]) => ({ cat: catById(id), amt, spent: spend.get(id) || 0 }))
    .filter((x) => x.cat && x.spent > x.amt);
  const body = h('div', { class: 'row-list' },
    ...(over.length ? over.map((o) => h('div', { class: 'row' },
      h('div', { class: 'r-icon' }, o.cat.icon),
      h('div', { class: 'r-main' },
        h('div', { class: 'r-title' }, `${o.cat.name} over budget`),
        h('div', { class: 'r-sub' }, `${fmt(o.spent)} spent of ${fmt(o.amt)}`)),
      h('div', { class: 'r-amt', style: 'color:var(--neg)' }, fmtSign(o.amt - o.spent))))
      : [h('div', { class: 'empty' }, h('p', {}, 'Nothing needs your attention. Budgets are all on track.'))]));
  openModal('Alerts', h('form', { class: 'form-grid' }, body), { saveLabel: 'Done', onSave: async () => {} });
}

function showHelp() {
  const body = h('div', {},
    h('p', { style: 'margin-bottom:12px;color:var(--ink-2);font-size:14px' },
      'Finch runs entirely on your own server. Nothing leaves it.'),
    h('div', { class: 'row-list' },
      startRow('plus', 'Add a transaction', 'Use the + button or the Add button on Transactions', () => { closeModal(); txModal(null); }),
      startRow('accounts', 'Update a balance', 'Tap an account and edit it — the change is recorded for the net-worth chart', () => { closeModal(); go('accounts'); }),
      startRow('reports', 'Read the Sankey', 'Reports → Cash Flow shows income flowing into each category', () => { closeModal(); go('reports', 'cashflow'); }),
      startRow('settings', 'Back up your data', 'Settings → Export downloads everything as JSON', () => { closeModal(); go('settings'); })));
  openModal('Help & Support', h('form', { class: 'form-grid' }, body), { saveLabel: 'Done', onSave: async () => {} });
}

function exportData() {
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(),
    settings: S.settings, accounts: S.accounts, transactions: S.transactions,
    categories: S.categories, budgets: S.budgets, goals: S.goals,
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `finch-export-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported');
}

/* --------------------------------- modal --------------------------------- */

function field(label, input) {
  return h('div', {}, h('label', {}, label), input);
}

// Top-bar button text that collapses to just the icon on a phone.
function lbl(text) { return h('span', { class: 'lbl' }, text); }

function closeModal() { $('#modal-root').innerHTML = ''; }

function openModal(title, form, { onSave, onDelete, saveLabel = 'Save' }) {
  const root = $('#modal-root');
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, saveLabel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    try { await onSave(); closeModal(); }
    catch (err) { toast(err.message || 'Something went wrong'); saveBtn.disabled = false; }
  });
  form.append(h('div', { class: 'modal-actions' },
    onDelete ? h('button', {
      class: 'btn btn-danger', type: 'button',
      onclick: async () => {
        try { const r = await onDelete(); if (r !== false) closeModal(); }
        catch (err) { toast(err.message || 'Failed'); }
      },
    }, 'Delete') : null,
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: closeModal }, 'Cancel'),
    saveBtn));
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) closeModal(); } },
    h('div', { class: 'modal' }, h('h3', {}, title), form));
  root.append(back);
  const first = form.querySelector('input, select');
  if (first && window.innerWidth > 900) first.focus();
}

/* ---------------------------------- auth --------------------------------- */

function showAuth(needsSetup) {
  $('#app').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  $('#auth-logo').innerHTML = `<span style="color:var(--accent)">${BRAND_SVG.replace('width="26" height="26"', 'width="44" height="44"')}</span>`;
  $('#auth-title').textContent = needsSetup ? 'Set up Finch' : 'Welcome back';
  $('#auth-sub').textContent = needsSetup
    ? 'Create a password to protect your dashboard.'
    : 'Enter your password to continue.';
  $('#auth-password2').classList.toggle('hidden', !needsSetup);
  $('#auth-password').autocomplete = needsSetup ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = needsSetup ? 'Create & continue' : 'Log in';
  $('#auth-form').dataset.mode = needsSetup ? 'setup' : 'login';
}

async function startApp() {
  $('#auth-screen').classList.add('hidden');
  Object.assign(S, await api('/api/state'));
  $('#app').classList.remove('hidden');
  if (handleQuickRoute()) return;
  const { route, tab } = parseHash();
  S.route = route; S.tab = tab;
  render();
}

async function logout() {
  await api('/api/logout', 'POST');
  showAuth(false);
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#auth-error');
  errEl.classList.add('hidden');
  const mode = e.target.dataset.mode;
  const pw = $('#auth-password').value;
  try {
    if (mode === 'setup') {
      if (pw !== $('#auth-password2').value) throw new Error('Passwords do not match');
      await api('/api/setup', 'POST', { password: pw });
    } else {
      await api('/api/login', 'POST', { password: pw });
    }
    $('#auth-password').value = '';
    $('#auth-password2').value = '';
    await startApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

$('#fab').addEventListener('click', () => quickAdd());

(async function init() {
  try {
    const st = await api('/api/status');
    if (st.needsSetup) showAuth(true);
    else if (!st.authed) showAuth(false);
    else await startApp();
  } catch {
    showAuth(false);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();

/* ============================ subscriptions ============================== */
/* Manually tracked recurring services — the "Recurring" sheet.              */

const FREQ = [['monthly', 'Monthly', 1], ['yearly', 'Yearly', 1 / 12],
  ['weekly', 'Weekly', 52 / 12], ['quarterly', 'Quarterly', 1 / 3]];
const freqFactor = (f) => (FREQ.find((x) => x[0] === f) || FREQ[0])[2];
const freqLabel = (f) => (FREQ.find((x) => x[0] === f) || FREQ[0])[1];
const monthlyCost = (sub) => (Number(sub.amount) || 0) * freqFactor(sub.frequency);

function subscriptionModal(sub) {
  const isNew = !sub;
  const d = sub ? { ...sub } : {
    name: '', amount: '', frequency: 'monthly', category: '', accountId: '', dayOfMonth: '', notes: '',
  };
  const byGroup = new Map();
  for (const c of S.categories) {
    if (c.type === 'income') continue;
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push(c);
  }
  const form = h('form', { class: 'form-grid' },
    field('Service', h('input', { name: 'name', value: d.name, required: true, placeholder: 'e.g. Contabo VPS' })),
    h('div', { class: 'two-col' },
      field('Amount', h('input', {
        name: 'amount', type: 'number', step: '0.01', min: '0', inputmode: 'decimal',
        required: true, value: d.amount, placeholder: '0.00',
      })),
      field('Billing', h('select', { name: 'frequency' },
        ...FREQ.map(([v, l]) => h('option', { value: v, selected: d.frequency === v }, l))))),
    h('div', { class: 'two-col' },
      field('Renews on day', h('input', {
        name: 'dayOfMonth', type: 'number', min: '1', max: '31', inputmode: 'numeric',
        value: d.dayOfMonth || '', placeholder: 'e.g. 15',
      })),
      field('Paid from', h('select', { name: 'accountId' },
        h('option', { value: '' }, '— none —'),
        ...S.accounts.map((a) => h('option', { value: a.id, selected: d.accountId === a.id }, a.name))))),
    field('Category', h('select', { name: 'category' },
      h('option', { value: '' }, '— none —'),
      ...[...byGroup.entries()].map(([g, cats]) =>
        h('optgroup', { label: g }, ...cats.map((c) =>
          h('option', { value: c.id, selected: d.category === c.id }, `${c.icon} ${c.name}`)))))),
    field('Notes', h('input', { name: 'notes', value: d.notes || '', placeholder: 'Optional' })),
  );
  openModal(isNew ? 'Add subscription' : 'Edit subscription', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'), amount: parseFloat(fd.get('amount')) || 0,
        frequency: fd.get('frequency'), category: fd.get('category'),
        accountId: fd.get('accountId'), notes: fd.get('notes'),
        dayOfMonth: parseInt(fd.get('dayOfMonth'), 10) || null,
      };
      if (isNew) S.subscriptions.push(await api('/api/subscriptions', 'POST', body));
      else Object.assign(sub, await api('/api/subscriptions/' + sub.id, 'PUT', body));
      toast(isNew ? 'Subscription added' : 'Saved');
      render();
    },
    onDelete: isNew ? null : async () => {
      await api('/api/subscriptions/' + sub.id, 'DELETE');
      S.subscriptions = S.subscriptions.filter((x) => x.id !== sub.id);
      toast('Removed');
      render();
    },
  });
}

function pageRecurring(main) {
  const tabs = [['manual', 'Subscriptions'], ['detected', 'Detected']];
  // The top bar marks the active tab from S.tab, so settle it before rendering.
  if (!tabs.some(([id]) => id === S.tab)) S.tab = 'manual';
  S.recurTab = S.tab;
  setTopbar('Recurring', tabs,
    [h('button', { class: 'btn btn-primary', onclick: () => subscriptionModal(null) },
      h('span', { class: 'ic-wrap', html: icon('plus', 15) }), lbl('Add subscription'))]);

  const subs = S.subscriptions.slice().sort((a, b) => monthlyCost(b) - monthlyCost(a));
  const monthly = subs.reduce((s, x) => s + monthlyCost(x), 0);

  main.append(h('div', { class: 'kpi-row' },
    kpi(String(subs.length), 'Subscriptions'),
    kpi(fmt(monthly), 'Per month'),
    kpi(fmt(monthly * 12), 'Per year'),
    kpi(fmt(subs.reduce((s, x) => s + (x.frequency === 'yearly' ? Number(x.amount) || 0 : 0), 0)), 'Billed yearly')));

  if (S.recurTab === 'detected') {
    const items = recurringItems();
    const c = card(cardHead(null, 'Detected from your transactions'));
    if (!items.length) {
      c.append(emptyState('🔁', 'Nothing detected yet — a merchant needs to appear in three or more months.',
        'Add a subscription', () => subscriptionModal(null)));
    } else {
      c.append(h('div', { class: 'row-list' }, ...items.map((it) => {
        const cat = catById(it.category);
        const known = S.subscriptions.some((s2) =>
          s2.name.toLowerCase().trim() === it.merchant.toLowerCase().trim());
        return h('div', { class: 'row' },
          h('div', { class: 'r-icon' }, cat?.icon || '🔁'),
          h('div', { class: 'r-main' },
            h('div', { class: 'r-title' }, it.merchant),
            h('div', { class: 'r-sub' },
              `${cat?.name || 'Uncategorised'} · ${it.fixed ? 'fixed' : 'variable'} · next ~${fmtDate(it.next, true)}`)),
          h('div', { class: 'r-amt' }, fmt(it.avg), h('div', { class: 'r-sub' }, `${it.count} payments`)),
          known ? h('span', { class: 'ic-wrap', style: 'color:var(--pos)', html: icon('check', 16) })
            : h('button', {
              class: 'btn btn-sm', onclick: async () => {
                const item = await api('/api/subscriptions', 'POST', {
                  name: it.merchant, amount: Math.round(it.avg * 100) / 100,
                  frequency: 'monthly', category: it.category, notes: 'Added from detected',
                });
                S.subscriptions.push(item);
                toast('Tracked');
                render();
              },
            }, 'Track'));
      })));
    }
    main.append(c);
    return;
  }

  if (!subs.length) {
    main.append(card(emptyState('🔁',
      'Track what you pay every month — hosting, phone, streaming, rent — and see the true monthly and yearly cost.',
      'Add subscription', () => subscriptionModal(null))));
    return;
  }

  const listCard = card(cardHead(null, 'Your subscriptions'),
    h('div', { class: 'row-list' }, ...subs.map((sub) => {
      const cat = catById(sub.category);
      const mc = monthlyCost(sub);
      return h('div', { class: 'row clickable', onclick: () => subscriptionModal(sub) },
        h('div', { class: 'r-icon' }, cat?.icon || '🔁'),
        h('div', { class: 'r-main' },
          h('div', { class: 'r-title' }, sub.name),
          h('div', { class: 'r-sub' }, [
            freqLabel(sub.frequency),
            sub.dayOfMonth ? `day ${sub.dayOfMonth}` : null,
            cat?.name, acctById(sub.accountId)?.name,
          ].filter(Boolean).join(' · '))),
        h('div', { class: 'r-amt' }, fmt(Number(sub.amount) || 0),
          sub.frequency !== 'monthly' ? h('div', { class: 'r-sub' }, `${fmt(mc)}/mo`) : null),
        h('span', { class: 'ic-wrap chev', html: icon('chevronRight', 15) }));
    })));

  const segs = subs.slice(0, 8).map((sub, i) => ({
    name: sub.name, value: monthlyCost(sub), display: fmt(monthlyCost(sub)),
    color: cssVar(ACCT_COLORS[i % ACCT_COLORS.length]),
  }));
  const side = card(cardHead(null, 'Monthly split'),
    stackedBar(segs),
    h('div', { class: 'legend-list' }, ...segs.map((s2) =>
      h('div', { class: 'key' },
        h('span', { class: 'dot', style: `background:${s2.color}` }),
        h('span', { class: 'nm' }, s2.name),
        h('span', { class: 'val' }, s2.display)))),
    h('div', { style: 'margin-top:14px' }, row2('Total per month', fmt(monthly))),
    row2('Total per year', fmt(monthly * 12)));

  main.append(h('div', { class: 'grid-side' }, listCard, side));
}

/* =============================== bills =================================== */
/* One-off amounts owed with due dates — the "Left2Pay" sheet.               */

function billModal(bill) {
  const isNew = !bill;
  const d = bill ? { ...bill } : { name: '', amount: '', due: todayISO(), category: '', notes: '' };
  const expCats = S.categories.filter((c) => c.type !== 'income');
  const form = h('form', { class: 'form-grid' },
    field('Who / what', h('input', { name: 'name', value: d.name, required: true, placeholder: 'e.g. Chase' })),
    h('div', { class: 'two-col' },
      field('Amount owed', h('input', {
        name: 'amount', type: 'number', step: '0.01', min: '0', inputmode: 'decimal',
        required: true, value: d.amount, placeholder: '0.00',
      })),
      field('Due date', h('input', { name: 'due', type: 'date', value: d.due || todayISO() }))),
    field('Category', h('select', { name: 'category' },
      h('option', { value: '' }, '— none —'),
      ...expCats.map((c) => h('option', { value: c.id, selected: d.category === c.id }, `${c.icon} ${c.name}`)))),
    field('Notes', h('input', { name: 'notes', value: d.notes || '', placeholder: 'Optional' })),
  );
  openModal(isNew ? 'Add bill' : 'Edit bill', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'), amount: parseFloat(fd.get('amount')) || 0,
        due: fd.get('due'), category: fd.get('category'), notes: fd.get('notes'),
      };
      if (isNew) S.bills.push(await api('/api/bills', 'POST', body));
      else Object.assign(bill, await api('/api/bills/' + bill.id, 'PUT', body));
      toast(isNew ? 'Bill added' : 'Saved');
      render();
    },
    onDelete: isNew ? null : async () => {
      await api('/api/bills/' + bill.id, 'DELETE');
      S.bills = S.bills.filter((x) => x.id !== bill.id);
      toast('Removed');
      render();
    },
  });
}

function payBillModal(bill) {
  const expCats = S.categories.filter((c) => c.type !== 'income');
  const form = h('form', { class: 'form-grid' },
    h('p', { style: 'color:var(--ink-2);font-size:14px' },
      `Marking ${bill.name} (${fmt(bill.amount)}) as paid.`),
    field('Record payment from', h('select', { name: 'accountId' },
      h('option', { value: '' }, "Don't record a transaction"),
      ...S.accounts.map((a) => h('option', { value: a.id }, a.name)))),
    h('div', { class: 'two-col' },
      field('Paid on', h('input', { name: 'date', type: 'date', value: todayISO() })),
      field('Category', h('select', { name: 'categoryId' },
        h('option', { value: '' }, '— none —'),
        ...expCats.map((c) => h('option', { value: c.id, selected: bill.category === c.id }, `${c.icon} ${c.name}`))))),
  );
  openModal('Mark as paid', form, {
    saveLabel: 'Mark paid',
    onSave: async () => {
      const fd = new FormData(form);
      const r = await api('/api/bills/pay', 'POST', {
        id: bill.id, accountId: fd.get('accountId'),
        categoryId: fd.get('categoryId'), date: fd.get('date'),
      });
      S.bills = r.bills;
      S.transactions = r.transactions;
      toast(r.transaction ? 'Paid and recorded' : 'Marked paid');
      render();
    },
  });
}

function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 864e5);
}

function pageBills(main) {
  setTopbar('Left to pay', [], [
    h('button', { class: 'btn btn-primary', onclick: () => billModal(null) },
      h('span', { class: 'ic-wrap', html: icon('plus', 15) }), lbl('Add bill')),
  ]);

  const bills = S.bills.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  if (!bills.length) {
    main.append(card(emptyState('🧾',
      'Track what you still owe and when it is due. Marking a bill paid can record the payment for you.',
      'Add bill', () => billModal(null))));
    return;
  }

  const total = bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const overdue = bills.filter((b) => daysUntil(b.due) < 0);
  const week = bills.filter((b) => { const d = daysUntil(b.due); return d >= 0 && d <= 7; });
  main.append(h('div', { class: 'kpi-row' },
    kpi(fmt(total), 'Total owed', 'neg'),
    kpi(String(bills.length), 'Open bills'),
    kpi(fmt(overdue.reduce((s, b) => s + b.amount, 0)), 'Overdue', overdue.length ? 'neg' : null),
    kpi(fmt(week.reduce((s, b) => s + b.amount, 0)), 'Due within 7 days')));

  const c = card(cardHead(null, 'Bills by due date'));
  c.append(h('div', { class: 'row-list' }, ...bills.map((b) => {
    const d = daysUntil(b.due);
    const cat = catById(b.category);
    const when = d === null ? 'No due date'
      : d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue`
        : d === 0 ? 'Due today' : `Due in ${d} day${d === 1 ? '' : 's'}`;
    return h('div', { class: 'row' },
      h('div', { class: 'r-icon' }, cat?.icon || '🧾'),
      h('div', { class: 'r-main clickable', style: 'cursor:pointer', onclick: () => billModal(b) },
        h('div', { class: 'r-title' }, b.name),
        h('div', { class: 'r-sub', style: d < 0 ? 'color:var(--neg)' : '' },
          `${b.due ? fmtDate(b.due, true) + ' · ' : ''}${when}`)),
      h('div', { class: 'r-amt' }, fmt(Number(b.amount) || 0)),
      h('button', { class: 'btn btn-sm', onclick: () => payBillModal(b) }, 'Pay'));
  })));
  main.append(c);
}

/* ============================== wishlist ================================= */
/* Things to buy later — the "Things to purchase" sheet.                     */

function wishModal(item) {
  const isNew = !item;
  const d = item ? { ...item } : {
    name: '', category: '', notes: '', link: '', price: '', priority: 'normal', bought: false,
  };
  const cats = [...new Set(S.wishlist.map((w) => w.category).filter(Boolean))];
  const form = h('form', { class: 'form-grid' },
    field('Item', h('input', { name: 'name', value: d.name, required: true, placeholder: 'e.g. Merino Wool Polo' })),
    h('div', { class: 'two-col' },
      field('Category', h('input', {
        name: 'category', value: d.category || '', list: 'wish-cats', placeholder: 'e.g. Tops',
      })),
      field('Price (optional)', h('input', {
        name: 'price', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: d.price || '',
      }))),
    h('datalist', { id: 'wish-cats' }, ...cats.map((c) => h('option', { value: c }))),
    field('Specifics / notes', h('input', { name: 'notes', value: d.notes || '', placeholder: 'e.g. Black, oversized' })),
    field('Link', h('input', { name: 'link', type: 'url', value: d.link || '', placeholder: 'https://…' })),
    field('Priority', h('select', { name: 'priority' },
      ...[['high', 'High'], ['normal', 'Normal'], ['low', 'Someday']].map(([v, l]) =>
        h('option', { value: v, selected: (d.priority || 'normal') === v }, l)))),
  );
  openModal(isNew ? 'Add to wishlist' : 'Edit item', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = {
        name: fd.get('name'), category: fd.get('category'), notes: fd.get('notes'),
        link: fd.get('link'), priority: fd.get('priority'),
        price: parseFloat(fd.get('price')) || 0, bought: d.bought || false,
      };
      if (isNew) S.wishlist.push(await api('/api/wishlist', 'POST', body));
      else Object.assign(item, await api('/api/wishlist/' + item.id, 'PUT', body));
      toast('Saved');
      render();
    },
    onDelete: isNew ? null : async () => {
      await api('/api/wishlist/' + item.id, 'DELETE');
      S.wishlist = S.wishlist.filter((x) => x.id !== item.id);
      toast('Removed');
      render();
    },
  });
}

function pageWishlist(main) {
  setTopbar('Wishlist', [], [
    h('button', { class: 'btn btn-primary', onclick: () => wishModal(null) },
      h('span', { class: 'ic-wrap', html: icon('plus', 15) }), lbl('Add item')),
  ]);

  if (!S.wishlist.length) {
    main.append(card(emptyState('🛍️',
      'Keep a running list of things you want to buy, grouped by category, with notes and links.',
      'Add item', () => wishModal(null))));
    return;
  }

  const open = S.wishlist.filter((w) => !w.bought);
  const bought = S.wishlist.filter((w) => w.bought);
  const priced = open.filter((w) => Number(w.price) > 0);
  main.append(h('div', { class: 'kpi-row' },
    kpi(String(open.length), 'Items to buy'),
    kpi(fmt(priced.reduce((s, w) => s + Number(w.price), 0)), 'Estimated cost'),
    kpi(String(open.filter((w) => w.priority === 'high').length), 'High priority'),
    kpi(String(bought.length), 'Bought')));

  const byCat = new Map();
  for (const w of open) {
    const k = w.category || 'Uncategorised';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(w);
  }
  const PRI = { high: 0, normal: 1, low: 2 };
  const c = card();
  for (const [catName, items] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sum = items.reduce((s, w) => s + (Number(w.price) || 0), 0);
    c.append(h('div', { class: 'group-head' },
      h('span', {}, catName),
      h('span', { class: 'gt' }, sum ? fmt(sum) : `${items.length} item${items.length === 1 ? '' : 's'}`)));
    items.sort((a, b) => (PRI[a.priority] ?? 1) - (PRI[b.priority] ?? 1));
    c.append(h('div', { class: 'row-list' }, ...items.map((w) => h('div', { class: 'row' },
      h('button', {
        class: 'wish-check', title: 'Mark as bought',
        onclick: async () => {
          Object.assign(w, await api('/api/wishlist/' + w.id, 'PUT', { ...w, bought: true }));
          toast('Marked as bought');
          render();
        },
      }, h('span', { class: 'ic-wrap', html: icon('check', 14) })),
      h('div', { class: 'r-main clickable', style: 'cursor:pointer', onclick: () => wishModal(w) },
        h('div', { class: 'r-title' },
          w.name,
          w.priority === 'high' ? h('span', { class: 'pill pill-hot' }, 'High') : null),
        h('div', { class: 'r-sub' }, w.notes || '')),
      Number(w.price) > 0 ? h('div', { class: 'r-amt' }, fmt(Number(w.price))) : null,
      w.link ? h('a', {
        class: 'btn btn-sm', href: w.link, target: '_blank', rel: 'noopener noreferrer',
        onclick: (e) => e.stopPropagation(),
      }, 'Open') : null))));
  }
  main.append(c);

  if (bought.length) {
    main.append(card(cardHead(null, `Bought (${bought.length})`),
      h('div', { class: 'row-list' }, ...bought.map((w) => h('div', { class: 'row' },
        h('span', { class: 'ic-wrap', style: 'color:var(--pos)', html: icon('check', 16) }),
        h('div', { class: 'r-main' },
          h('div', { class: 'r-title', style: 'color:var(--ink-3)' }, w.name),
          h('div', { class: 'r-sub' }, [w.category, w.notes].filter(Boolean).join(' · '))),
        h('button', {
          class: 'btn btn-sm', onclick: async () => {
            Object.assign(w, await api('/api/wishlist/' + w.id, 'PUT', { ...w, bought: false }));
            render();
          },
        }, 'Undo'))))));
  }
}

/* ============================== CSV import =============================== */

function importModal() {
  const state = { rows: null, analysis: null, dayFirst: false, flipSign: false, accountId: S.accounts[0]?.id || '' };
  const body = h('div', {});
  const form = h('form', { class: 'form-grid' }, body);

  const fileInput = h('input', {
    type: 'file', accept: '.csv,.txt,text/csv,text/plain', style: 'display:none',
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const text = await f.text();
      state.rows = parseCSV(text);
      state.analysis = analyse(state.rows);
      if (state.analysis) state.dayFirst = false;
      renderStep();
    },
  });

  function renderStep() {
    body.innerHTML = '';
    if (!state.analysis) {
      body.append(
        h('p', { style: 'color:var(--ink-2);font-size:14px;margin-bottom:14px' },
          'Export a CSV from your bank, then pick it here. Finch works out which columns hold the date, description and amount, skips rows you already have, and guesses categories.'),
        h('button', {
          class: 'btn btn-primary btn-block', type: 'button', onclick: () => fileInput.click(),
        }, 'Choose CSV file'),
        fileInput);
      return;
    }

    const A = state.analysis;
    const colOptions = (sel) => [
      h('option', { value: '-1', selected: sel === -1 }, '— none —'),
      ...A.headers.map((hd, i) => h('option', { value: String(i), selected: sel === i }, hd || `Column ${i + 1}`)),
    ];
    const setMap = (key) => (e) => { A.map[key] = parseInt(e.target.value, 10); renderStep(); };

    const preview = buildRows(A, {
      dayFirst: state.dayFirst, flipSign: state.flipSign,
      categories: S.categories, rules: S.rules, existing: S.transactions,
    });
    const good = preview.filter((r) => r.ok && !r.dupe);
    const dupes = preview.filter((r) => r.ok && r.dupe).length;
    const bad = preview.filter((r) => !r.ok).length;
    state.preview = good;

    body.append(
      h('div', { class: 'sum-row' },
        h('span', { class: 'k' }, `${A.body.length} rows in file`),
        h('span', { class: 'v' }, `${good.length} to import`)),
      h('div', { class: 'r-sub', style: 'margin-bottom:12px' },
        `${dupes} already in Finch, ${bad} unreadable`),
      h('div', { class: 'two-col' },
        field('Date column', h('select', { onchange: setMap('date') }, ...colOptions(A.map.date))),
        field('Description', h('select', { onchange: setMap('desc') }, ...colOptions(A.map.desc)))),
      h('div', { class: 'two-col' },
        field('Amount', h('select', { onchange: setMap('amount') }, ...colOptions(A.map.amount))),
        field('Category (optional)', h('select', { onchange: setMap('category') }, ...colOptions(A.map.category)))),
      A.map.amount === -1 ? h('div', { class: 'two-col' },
        field('Money out', h('select', { onchange: setMap('debit') }, ...colOptions(A.map.debit))),
        field('Money in', h('select', { onchange: setMap('credit') }, ...colOptions(A.map.credit)))) : null,
      field('Import into account', h('select', {
        onchange: (e) => { state.accountId = e.target.value; },
      }, h('option', { value: '' }, '— none —'),
        ...S.accounts.map((a) => h('option', { value: a.id, selected: state.accountId === a.id }, a.name)))),
      A.ambiguousDate ? h('label', { class: 'check-line' },
        h('input', {
          type: 'checkbox', checked: state.dayFirst,
          onchange: (e) => { state.dayFirst = e.target.checked; renderStep(); },
        }), h('span', {}, 'Dates are day/month (European order)')) : null,
      h('label', { class: 'check-line' },
        h('input', {
          type: 'checkbox', checked: state.flipSign,
          onchange: (e) => { state.flipSign = e.target.checked; renderStep(); },
        }), h('span', {}, 'Flip signs (file lists spending as positive)')),
      h('div', { class: 'eyebrow', style: 'margin-top:6px' }, 'Preview'),
      h('div', { class: 'import-preview' }, ...good.slice(0, 8).map((r) => {
        const c = catById(r.category);
        return h('div', { class: 'row' },
          h('div', { class: 'r-icon' }, c?.icon || '💳'),
          h('div', { class: 'r-main' },
            h('div', { class: 'r-title' }, r.merchant || '(no description)'),
            h('div', { class: 'r-sub' }, `${fmtDate(r.date, true)} · ${c?.name || 'Uncategorised'}`)),
          h('div', { class: 'r-amt' + (r.amount > 0 ? ' amt-pos' : '') }, fmtSign(r.amount)));
      }), good.length > 8 ? h('div', { class: 'r-sub', style: 'padding:8px 2px' },
        `+ ${good.length - 8} more`) : null),
      fileInput);
  }
  renderStep();

  openModal('Import bank statement', form, {
    saveLabel: 'Import',
    onSave: async () => {
      if (!state.preview || !state.preview.length) throw new Error('Nothing to import — check the column mapping');
      const payload = state.preview.map((r) => ({
        date: r.date, merchant: r.merchant, amount: r.amount,
        category: r.category, accountId: state.accountId, notes: '',
      }));
      const r = await api('/api/transactions/bulk', 'POST', { transactions: payload });
      S.transactions = r.transactions;
      toast(`Imported ${r.added}${r.skipped ? `, skipped ${r.skipped}` : ''}`);
      render();
    },
  });
}

/* ============================= quick add ================================= */
/* Reached from the iOS home-screen shortcut and from ?add= deep links.      */

function quickAdd(prefill = {}) {
  const sign = prefill.type === 'income' ? 1 : -1;
  const amountInput = h('input', {
    type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true,
    value: prefill.amount || '', placeholder: '0.00', class: 'quick-amount', autofocus: true,
  });
  const merchantInput = h('input', {
    value: prefill.merchant || '', required: true, placeholder: 'Where?', autocomplete: 'off', list: 'quick-merchants',
  });
  // Recent merchants make repeat entry a single tap.
  const recent = [...new Set(S.transactions.slice(0, 200).map((t) => t.merchant).filter(Boolean))].slice(0, 20);

  let cat = prefill.category || '';
  // Reuse the category last used for this merchant.
  const syncCat = () => {
    const m = merchantInput.value.trim().toLowerCase();
    if (!m) return;
    const hit = S.transactions.find((t) => (t.merchant || '').toLowerCase() === m);
    if (hit && hit.category) { cat = hit.category; catSelect.value = cat; }
  };
  merchantInput.addEventListener('change', syncCat);
  merchantInput.addEventListener('blur', syncCat);

  const cats = S.categories.filter((c) => (sign > 0 ? c.type === 'income' : c.type !== 'income'));
  const catSelect = h('select', {},
    h('option', { value: '' }, '— category —'),
    ...cats.map((c) => h('option', { value: c.id, selected: cat === c.id }, `${c.icon} ${c.name}`)));

  const form = h('form', { class: 'form-grid' },
    h('div', { class: 'quick-row' },
      h('span', { class: 'quick-sign' }, sign > 0 ? '+' : '−'),
      amountInput),
    merchantInput,
    h('datalist', { id: 'quick-merchants' }, ...recent.map((m) => h('option', { value: m }))),
    h('div', { class: 'two-col' },
      catSelect,
      h('select', { name: 'accountId' },
        h('option', { value: '' }, '— account —'),
        ...S.accounts.map((a) => h('option', { value: a.id, selected: S.accounts[0]?.id === a.id }, a.name)))),
    h('input', { type: 'date', name: 'date', value: prefill.date || todayISO() }),
  );

  openModal(sign > 0 ? 'Quick add income' : 'Quick add expense', form, {
    saveLabel: 'Save',
    onSave: async () => {
      const fd = new FormData(form);
      const item = await api('/api/transactions', 'POST', {
        date: fd.get('date') || todayISO(),
        merchant: merchantInput.value,
        amount: sign * Math.abs(parseFloat(amountInput.value) || 0),
        category: catSelect.value,
        accountId: fd.get('accountId'),
        notes: '',
      });
      S.transactions.push(item);
      S.transactions.sort((a, b) => b.date.localeCompare(a.date));
      toast('Added');
      render();
    },
  });
  setTimeout(() => amountInput.focus(), 60);
}

// #/add?amount=12.5&merchant=Coffee&type=expense — used by home-screen
// shortcuts and iOS Shortcuts automations.
function handleQuickRoute() {
  const hash = location.hash;
  const qi = hash.indexOf('?');
  if (!hash.startsWith('#/add')) return false;
  const params = new URLSearchParams(qi > -1 ? hash.slice(qi + 1) : '');
  const prefill = {
    amount: params.get('amount') || '',
    merchant: params.get('merchant') || '',
    type: params.get('type') === 'income' ? 'income' : 'expense',
    date: params.get('date') || todayISO(),
  };
  const catName = params.get('category');
  if (catName) {
    const c = S.categories.find((x) => x.name.toLowerCase() === catName.toLowerCase());
    if (c) prefill.category = c.id;
  }
  S.route = 'dashboard';
  S.tab = '';
  history.replaceState(null, '', '#/dashboard');
  render();
  quickAdd(prefill);
  return true;
}
