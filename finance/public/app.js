/* Finch — personal finance dashboard (frontend) */
'use strict';

/* ------------------------------ helpers ------------------------------ */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

/* ------------------------------- state ------------------------------- */

const S = {
  settings: { currency: 'USD', locale: 'en-US' },
  accounts: [],
  transactions: [],
  categories: [],
  budgets: {},
  goals: [],
  route: 'dashboard',
  nwRange: '6M',
  txFilter: { q: '', cat: '', acct: '', month: '' },
};

const LIABILITY_TYPES = new Set(['credit', 'loan']);
const ACCOUNT_TYPES = [
  ['checking', 'Checking', '🏦'],
  ['savings', 'Savings', '💰'],
  ['cash', 'Cash', '💵'],
  ['investment', 'Investments', '📈'],
  ['credit', 'Credit cards', '💳'],
  ['loan', 'Loans', '📋'],
  ['property', 'Property', '🏠'],
  ['other', 'Other', '📦'],
];
const typeMeta = (t) => ACCOUNT_TYPES.find((a) => a[0] === t) || ACCOUNT_TYPES[7];

function fmt(n, opts = {}) {
  const cur = S.settings.currency || 'USD';
  try {
    return new Intl.NumberFormat(S.settings.locale || undefined, {
      style: 'currency', currency: cur,
      maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
      minimumFractionDigits: Math.abs(n) >= 1000 || Number.isInteger(n) ? 0 : 2,
      ...opts,
    }).format(n);
  } catch { return (n < 0 ? '-' : '') + cur + ' ' + Math.abs(n).toFixed(0); }
}
const fmtSign = (n) => (n > 0 ? '+' : '') + fmt(n);
const fmtCompact = (n) => fmt(n, { notation: Math.abs(n) >= 100000 ? 'compact' : 'standard' });

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => d.slice(0, 7);
const thisMonth = () => todayISO().slice(0, 7);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso, withYear) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? ', ' + y : ''}`;
}
function fmtMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

const catById = (id) => S.categories.find((c) => c.id === id);
const acctById = (id) => S.accounts.find((a) => a.id === id);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ------------------------------- derived ------------------------------ */

function accountSigned(a) {
  return LIABILITY_TYPES.has(a.type) ? -Math.abs(a.balance) : a.balance;
}
function netWorth() {
  return S.accounts.reduce((s, a) => s + accountSigned(a), 0);
}
function assetsAndDebts() {
  let assets = 0, debts = 0;
  for (const a of S.accounts) {
    const v = accountSigned(a);
    if (v >= 0) assets += v; else debts += -v;
  }
  return { assets, debts };
}

// Net-worth time series from account balance histories (carry-forward).
function netWorthSeries() {
  const dates = new Set();
  for (const a of S.accounts) for (const p of a.history || []) dates.add(p.date);
  dates.add(todayISO());
  const sorted = [...dates].sort();
  return sorted.map((date) => {
    let total = 0;
    for (const a of S.accounts) {
      const hist = a.history || [];
      let bal = null;
      for (const p of hist) {
        if (p.date <= date) bal = p.balance;
        else break;
      }
      if (bal === null) bal = hist.length ? hist[0].balance : a.balance;
      if (date === todayISO()) bal = a.balance;
      total += LIABILITY_TYPES.has(a.type) ? -Math.abs(bal) : bal;
    }
    return { date, value: total };
  });
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
    out.push({ key, income, expense });
  }
  return out;
}

function spendingByCategory(mKey) {
  const map = new Map();
  for (const t of S.transactions) {
    if (t.amount >= 0 || monthKey(t.date) !== mKey) continue;
    map.set(t.category, (map.get(t.category) || 0) + -t.amount);
  }
  return [...map.entries()]
    .map(([id, total]) => ({ cat: catById(id) || { name: 'Uncategorized', icon: '❓' }, total }))
    .sort((a, b) => b.total - a.total);
}

/* ------------------------------- charts ------------------------------- */

const tipEl = () => $('#chart-tip');
function showTip(x, y, html) {
  const t = tipEl();
  t.innerHTML = html;
  t.classList.remove('hidden');
  const pad = 8, w = t.offsetWidth;
  let cx = Math.min(Math.max(x, w / 2 + pad), window.innerWidth - w / 2 - pad);
  t.style.left = cx + 'px';
  t.style.top = y + 'px';
}
function hideTip() { tipEl().classList.add('hidden'); }

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Nice round tick values for an axis.
function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}
const fmtTick = (v) => {
  const a = Math.abs(v);
  // Keep one decimal when rounding would misstate the tick (2,500 → "2.5K", not "3K").
  const short = (n, div, suffix) => {
    const q = n / div;
    return (Number.isInteger(q) ? q.toFixed(0) : q.toFixed(1)) + suffix;
  };
  if (a >= 1e6) return short(v, 1e6, 'M');
  if (a >= 1e3) return short(v, 1e3, 'K');
  return String(Math.round(v * 10) / 10);
};

// Line + area chart (net worth). points: [{date, value}]
function lineChart(points, { height = 230 } = {}) {
  const wrap = h('div', { class: 'chart-wrap' });
  const render = () => {
    wrap.innerHTML = '';
    const W = wrap.clientWidth || 600;
    const H = height;
    const padL = 44, padR = 12, padT = 14, padB = 24;
    const iw = W - padL - padR, ih = H - padT - padB;
    const vals = points.map((p) => p.value);
    const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
    const X = (i) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const Y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;

    const grid = cssVar('--grid'), muted = cssVar('--ink-3'), series = cssVar('--s1'), surface = cssVar('--surface');
    let g = '';
    for (const t of ticks) {
      g += `<line x1="${padL}" y1="${Y(t)}" x2="${W - padR}" y2="${Y(t)}" stroke="${grid}" stroke-width="1"/>`;
      g += `<text x="${padL - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="${muted}" style="font-variant-numeric:tabular-nums">${fmtTick(t)}</text>`;
    }
    // x labels: first, middle, last
    const xIdx = points.length > 2 ? [0, Math.floor(points.length / 2), points.length - 1] : points.map((_, i) => i);
    for (const i of xIdx) {
      g += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" font-size="11" fill="${muted}">${fmtDate(points[i].date, true)}</text>`;
    }

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
    const area = line + `L${X(points.length - 1).toFixed(1)},${Y(lo)}L${X(0).toFixed(1)},${Y(lo)}Z`;
    const last = points[points.length - 1];

    const svg = h('div', { html: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Net worth over time">
      ${g}
      <path d="${area}" fill="${series}" opacity="0.1"/>
      <path d="${line}" fill="none" stroke="${series}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(points.length - 1)}" cy="${Y(last.value)}" r="4.5" fill="${series}" stroke="${surface}" stroke-width="2"/>
      <line id="xh" x1="0" y1="${padT}" x2="0" y2="${padT + ih}" stroke="${muted}" stroke-width="1" opacity="0"/>
      <circle id="xd" r="4.5" fill="${series}" stroke="${surface}" stroke-width="2" opacity="0"/>
      <rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent" id="hover"/>
    </svg>` }).firstChild;
    wrap.append(svg);

    const hover = svg.querySelector('#hover'), xh = svg.querySelector('#xh'), xd = svg.querySelector('#xd');
    const onMove = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const idx = Math.round(((px - padL) / iw) * (points.length - 1));
      const i = Math.max(0, Math.min(points.length - 1, idx));
      const p = points[i];
      xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('opacity', '0.5');
      xd.setAttribute('cx', X(i)); xd.setAttribute('cy', Y(p.value)); xd.setAttribute('opacity', '1');
      showTip(r.left + (X(i) / W) * r.width, r.top + (Y(p.value) / H) * r.height,
        `${fmtDate(p.date, true)}<br><b>${fmt(p.value)}</b>`);
    };
    const onLeave = () => { xh.setAttribute('opacity', '0'); xd.setAttribute('opacity', '0'); hideTip(); };
    hover.addEventListener('pointermove', onMove);
    hover.addEventListener('pointerleave', onLeave);
    hover.addEventListener('pointerdown', onMove);
  };
  requestAnimationFrame(render);
  wrap._render = render;
  return wrap;
}

// Grouped bars: income vs expense per month.
function cashflowChart(data, { height = 220 } = {}) {
  const wrap = h('div', { class: 'chart-wrap' });
  const render = () => {
    wrap.innerHTML = '';
    const W = wrap.clientWidth || 600;
    const H = height;
    const padL = 44, padR = 8, padT = 12, padB = 24;
    const iw = W - padL - padR, ih = H - padT - padB;
    const maxV = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
    const { hi, ticks } = niceTicks(0, maxV);
    const Y = (v) => padT + ih - (v / hi) * ih;
    const grid = cssVar('--grid'), muted = cssVar('--ink-3'), baseline = cssVar('--baseline');
    const cInc = cssVar('--income'), cExp = cssVar('--expense');

    const band = iw / data.length;
    const barW = Math.min(24, (band - 18) / 2);
    let g = '';
    for (const t of ticks) {
      if (t === 0) continue;
      g += `<line x1="${padL}" y1="${Y(t)}" x2="${W - padR}" y2="${Y(t)}" stroke="${grid}" stroke-width="1"/>`;
      g += `<text x="${padL - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="${muted}" style="font-variant-numeric:tabular-nums">${fmtTick(t)}</text>`;
    }
    g += `<line x1="${padL}" y1="${Y(0)}" x2="${W - padR}" y2="${Y(0)}" stroke="${baseline}" stroke-width="1"/>`;

    const bars = [];
    data.forEach((d, i) => {
      const cx = padL + band * i + band / 2;
      const [ym, mm] = d.key.split('-');
      g += `<text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="11" fill="${muted}">${MONTHS[+mm - 1]}</text>`;
      for (const [j, [val, color, label]] of [[d.income, cInc, 'Income'], [d.expense, cExp, 'Expenses']].entries()) {
        const x = cx - barW - 1 + j * (barW + 2);
        const y = Y(val), bh = Math.max(0, Y(0) - y);
        const r = Math.min(4, bh);
        bars.push({ x, y, w: barW, h: bh, month: d.key, income: d.income, expense: d.expense });
        if (bh > 0)
          g += `<path d="M${x},${y + r} a${r},${r} 0 0 1 ${r},-${r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${bh - r} h${-barW} Z" fill="${color}"><title>${label}</title></path>`;
      }
    });

    const svg = h('div', { html: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly income and expenses">${g}<rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent" id="hover"/></svg>` }).firstChild;
    wrap.append(svg);

    const hover = svg.querySelector('#hover');
    const onMove = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(data.length - 1, Math.floor((px - padL) / band)));
      const d = data[i];
      const cx = padL + band * i + band / 2;
      showTip(r.left + (cx / W) * r.width, r.top + (padT / H) * r.height + 6,
        `${fmtMonth(d.key)}<br>Income <b>${fmt(d.income)}</b><br>Expenses <b>${fmt(d.expense)}</b><br>Net <b>${fmtSign(d.income - d.expense)}</b>`);
    };
    hover.addEventListener('pointermove', onMove);
    hover.addEventListener('pointerdown', onMove);
    hover.addEventListener('pointerleave', hideTip);
  };
  requestAnimationFrame(render);
  wrap._render = render;
  return wrap;
}

// Donut of top spending categories (top 5 + Other).
function donutChart(items) {
  const total = items.reduce((s, x) => s + x.total, 0);
  const top = items.slice(0, 5);
  const rest = items.slice(5).reduce((s, x) => s + x.total, 0);
  const slices = top.map((x, i) => ({ name: x.cat.name, icon: x.cat.icon, val: x.total, color: cssVar(`--s${i + 1}`) }));
  if (rest > 0) slices.push({ name: 'Other', icon: '•', val: rest, color: cssVar('--ink-3') });

  const size = 150, R = 62, r0 = 40, cx = size / 2, cy = size / 2;
  const surface = cssVar('--surface');
  let a0 = -Math.PI / 2;
  let paths = '';
  const arcs = [];
  for (const s of slices) {
    const frac = s.val / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, R_) => `${(cx + R_ * Math.cos(a)).toFixed(2)},${(cy + R_ * Math.sin(a)).toFixed(2)}`;
    paths += `<path d="M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r0)} A${r0},${r0} 0 ${large} 0 ${p(a0, r0)} Z" fill="${s.color}" stroke="${surface}" stroke-width="2" data-i="${arcs.length}"/>`;
    arcs.push(s);
    a0 = a1;
  }
  const flex = h('div', { class: 'donut-flex' });
  const svgWrap = h('div', {
    html: `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Spending by category">
      ${paths}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="11" fill="${cssVar('--ink-3')}">Total</text>
      <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="14" font-weight="700" fill="${cssVar('--ink')}">${fmtCompact(total)}</text>
    </svg>`,
  });
  const svg = svgWrap.firstChild;
  svg.addEventListener('pointermove', (e) => {
    const t = e.target.closest('path[data-i]');
    if (!t) return hideTip();
    const s = arcs[+t.dataset.i];
    showTip(e.clientX, e.clientY, `${esc(s.name)}<br><b>${fmt(s.val)}</b> · ${Math.round((s.val / total) * 100)}%`);
  });
  svg.addEventListener('pointerleave', hideTip);

  const legend = h('div', { class: 'donut-legend' },
    ...slices.map((s) => h('div', { class: 'key' },
      h('span', { class: 'swatch', style: `background:${s.color}` }),
      h('span', { class: 'nm' }, `${s.icon} ${s.name}`),
      h('span', { class: 'val' }, fmt(s.val)),
    )),
  );
  flex.append(svgWrap, legend);
  return flex;
}

/* -------------------------------- router ------------------------------ */

const NAV = [
  ['dashboard', 'Dashboard', '⌂'],
  ['accounts', 'Accounts', '🏦'],
  ['transactions', 'Transactions', '⇄'],
  ['cashflow', 'Cash flow', '📊'],
  ['budget', 'Budget', '🎯'],
  ['goals', 'Goals', '🚩'],
  ['settings', 'Settings', '⚙'],
];
const TABS = ['dashboard', 'accounts', 'transactions', 'budget', 'more'];
const TAB_META = { dashboard: ['Home', '⌂'], accounts: ['Accounts', '🏦'], transactions: ['Activity', '⇄'], budget: ['Budget', '🎯'], more: ['More', '⋯'] };

function buildNav() {
  const nav = $('#sidebar-nav');
  nav.innerHTML = '';
  for (const [id, label, icon] of NAV) {
    nav.append(h('button', {
      class: 'nav-item' + (S.route === id ? ' active' : ''),
      type: 'button',
      onclick: () => go(id),
    }, h('span', { class: 'nav-icon' }, icon), h('span', {}, label)));
  }
  const tb = $('#tabbar');
  tb.innerHTML = '';
  for (const t of TABS) {
    const [label, icon] = TAB_META[t];
    const active = S.route === t || (t === 'more' && ['cashflow', 'goals', 'settings'].includes(S.route));
    tb.append(h('button', {
      class: 'tab-item' + (active ? ' active' : ''),
      type: 'button',
      onclick: () => go(t),
    }, h('span', { class: 'nav-icon' }, icon), h('span', {}, label)));
  }
}

function go(route) {
  S.route = route;
  location.hash = '#/' + route;
  render();
}

window.addEventListener('hashchange', () => {
  const r = location.hash.replace(/^#\//, '') || 'dashboard';
  if (r !== S.route) { S.route = r; render(); }
});

let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  if (Math.abs(window.innerWidth - lastW) < 24) return;
  lastW = window.innerWidth;
  $$('.chart-wrap').forEach((w) => w._render && w._render());
});

/* -------------------------------- render ------------------------------ */

function render() {
  buildNav();
  const main = $('#main');
  main.innerHTML = '';
  window.scrollTo(0, 0);
  hideTip();
  const pages = {
    dashboard: pageDashboard, accounts: pageAccounts, transactions: pageTransactions,
    cashflow: pageCashflow, budget: pageBudget, goals: pageGoals, settings: pageSettings,
    more: pageMore,
  };
  (pages[S.route] || pageDashboard)(main);
  $('#fab').classList.toggle('hidden', ['settings', 'more'].includes(S.route));
}

function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h2', {}, title), sub ? h('div', { class: 'sub' }, sub) : null),
    actions.length ? h('div', { style: 'display:flex;gap:8px' }, ...actions) : null,
  );
}

function emptyState(icon, text, btnLabel, onClick) {
  return h('div', { class: 'empty' },
    h('div', { class: 'big' }, icon),
    h('p', {}, text),
    btnLabel ? h('button', { class: 'btn btn-primary', onclick: onClick }, btnLabel) : null,
  );
}

/* ------------------------------ dashboard ----------------------------- */

function rangePoints(all, range) {
  if (range === 'ALL' || all.length < 2) return all;
  const days = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366 }[range];
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const pts = all.filter((p) => p.date >= cutoff);
  return pts.length >= 2 ? pts : all.slice(-2);
}

function pageDashboard(main) {
  const greetName = S.settings.name ? `, ${S.settings.name}` : '';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  main.append(pageHead(`${greet}${greetName}`, new Date().toLocaleDateString(S.settings.locale || undefined, { weekday: 'long', month: 'long', day: 'numeric' })));

  if (S.accounts.length === 0 && S.transactions.length === 0) {
    main.append(h('div', { class: 'card' }, emptyState('🪺', 'Welcome to Finch. Add your accounts to start tracking your net worth — or explore with demo data first.', 'Load demo data', async () => {
      Object.assign(S, await api('/api/demo', 'POST'));
      toast('Demo data loaded');
      render();
    })));
    main.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Get started'),
      h('div', { class: 'row-list' },
        startRow('🏦', 'Add your accounts', 'Checking, savings, cards, investments', () => go('accounts')),
        startRow('⇄', 'Log transactions', 'Track where money goes', () => go('transactions')),
        startRow('🎯', 'Set a budget', 'Monthly limits per category', () => go('budget')),
      ),
    ));
    return;
  }

  // Net worth card
  const nw = netWorth();
  const series = netWorthSeries();
  const pts = rangePoints(series, S.nwRange);
  const first = pts[0]?.value ?? nw;
  const change = nw - first;
  const pct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;

  const seg = h('div', { class: 'seg' }, ...['1M', '3M', '6M', '1Y', 'ALL'].map((r) =>
    h('button', { class: S.nwRange === r ? 'active' : '', onclick: () => { S.nwRange = r; render(); } }, r)));

  const nwCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, h('span', {}, 'Net worth'), seg),
    h('div', { class: 'hero-number' }, fmt(nw)),
    h('div', { class: `delta ${change >= 0 ? 'up' : 'down'}` },
      `${change >= 0 ? '▲' : '▼'} ${fmt(Math.abs(change))} (${Math.abs(pct).toFixed(1)}%) `,
      h('span', { class: 'vs' }, `over ${S.nwRange === 'ALL' ? 'all time' : 'the last ' + S.nwRange.replace('M', ' months').replace('Y', ' year').replace('1 months', 'month')}`)),
    pts.length >= 2 ? lineChart(pts) : h('div', { class: 'empty' }, h('p', {}, 'Update account balances over time to grow this chart.')),
    chartTable(['Date', 'Net worth'], pts.map((p) => [fmtDate(p.date, true), fmt(p.value)])),
  );
  main.append(nwCard);

  // Stat tiles
  const { assets, debts } = assetsAndDebts();
  const mk = thisMonth();
  const monthTx = S.transactions.filter((t) => monthKey(t.date) === mk);
  const spent = monthTx.filter((t) => t.amount < 0).reduce((s, t) => s + -t.amount, 0);
  const earned = monthTx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  main.append(h('div', { class: 'stat-row' },
    statTile('Assets', fmt(assets)),
    statTile('Liabilities', fmt(debts)),
    statTile(`Saved in ${fmtMonth(mk).split(' ')[0]}`, fmtSign(earned - spent)),
  ));

  // Two-up: spending donut + budget snapshot
  const spend = spendingByCategory(mk);
  const budgetIds = Object.keys(S.budgets);
  main.append(h('div', { class: 'grid-2' },
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, h('span', {}, `Spending · ${fmtMonth(mk)}`), h('a', { class: 'link', href: '#/cashflow', onclick: (e) => { e.preventDefault(); go('cashflow'); } }, 'See cash flow →')),
      spend.length ? donutChart(spend) : h('div', { class: 'empty' }, h('p', {}, 'No spending recorded this month yet.')),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, h('span', {}, 'Budget'), h('a', { class: 'link', href: '#/budget', onclick: (e) => { e.preventDefault(); go('budget'); } }, 'Edit →')),
      budgetIds.length ? budgetList(3) : h('div', { class: 'empty' }, h('p', {}, 'No budget set yet.'), h('button', { class: 'btn btn-sm', onclick: () => go('budget') }, 'Set a budget')),
    ),
  ));

  // Two-up: accounts + recent transactions
  main.append(h('div', { class: 'grid-2' },
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, h('span', {}, 'Accounts'), h('a', { class: 'link', href: '#/accounts', onclick: (e) => { e.preventDefault(); go('accounts'); } }, 'All →')),
      h('div', { class: 'row-list' }, ...S.accounts.slice(0, 5).map(accountRow)),
    ),
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, h('span', {}, 'Recent transactions'), h('a', { class: 'link', href: '#/transactions', onclick: (e) => { e.preventDefault(); go('transactions'); } }, 'All →')),
      S.transactions.length
        ? h('div', { class: 'row-list' }, ...S.transactions.slice(0, 6).map(txRow))
        : h('div', { class: 'empty' }, h('p', {}, 'Nothing yet.')),
    ),
  ));

  // Goals strip
  if (S.goals.length) {
    main.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, h('span', {}, 'Goals'), h('a', { class: 'link', href: '#/goals', onclick: (e) => { e.preventDefault(); go('goals'); } }, 'All →')),
      ...S.goals.slice(0, 3).map(goalRow),
    ));
  }
}

function startRow(icon, title, sub, onclick) {
  return h('div', { class: 'row clickable', onclick },
    h('div', { class: 'r-icon' }, icon),
    h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, title), h('div', { class: 'r-sub' }, sub)),
    h('div', { style: 'color:var(--ink-3)' }, '›'),
  );
}
function statTile(label, value) {
  return h('div', { class: 'stat-tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
}
function chartTable(headers, rows) {
  if (!rows.length) return null;
  return h('details', { class: 'chart-table' },
    h('summary', {}, 'View as table'),
    h('table', {},
      h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', {}, x)))),
      h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c))))),
    ),
  );
}

/* ------------------------------ accounts ------------------------------ */

function accountRow(a) {
  const [, typeLabel, icon] = typeMeta(a.type);
  const v = accountSigned(a);
  return h('div', { class: 'row clickable', onclick: () => accountModal(a) },
    h('div', { class: 'r-icon' }, icon),
    h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, a.name), h('div', { class: 'r-sub' }, typeLabel)),
    h('div', { class: 'r-amt' + (v < 0 ? '' : '') }, h('div', { style: v < 0 ? 'color:var(--neg)' : '' }, fmt(v))),
  );
}

function pageAccounts(main) {
  main.append(pageHead('Accounts', `${S.accounts.length} account${S.accounts.length === 1 ? '' : 's'}`,
    h('button', { class: 'btn btn-primary', onclick: () => accountModal(null) }, '+ Add account')));

  if (!S.accounts.length) {
    main.append(h('div', { class: 'card' }, emptyState('🏦', 'No accounts yet. Add your checking, savings, cards, and investments to see your full picture.', '+ Add account', () => accountModal(null))));
    return;
  }

  const nw = netWorth();
  const { assets, debts } = assetsAndDebts();
  main.append(h('div', { class: 'stat-row' },
    statTile('Net worth', fmt(nw)), statTile('Assets', fmt(assets)), statTile('Liabilities', fmt(debts))));

  const card = h('div', { class: 'card' });
  for (const [type, label] of ACCOUNT_TYPES) {
    const accts = S.accounts.filter((a) => a.type === type);
    if (!accts.length) continue;
    const total = accts.reduce((s, a) => s + accountSigned(a), 0);
    card.append(
      h('div', { class: 'acct-group-head' }, h('span', {}, label), h('span', { class: 'g-total' }, fmt(total))),
      h('div', { class: 'row-list' }, ...accts.map(accountRow)),
    );
  }
  main.append(card);
}

function accountModal(a) {
  const isNew = !a;
  const data = a ? { ...a } : { name: '', type: 'checking', balance: '' };
  const form = h('form', { class: 'form-grid' },
    field('Name', h('input', { name: 'name', value: data.name, required: true, placeholder: 'e.g. Everyday Checking' })),
    field('Type', h('select', { name: 'type' }, ...ACCOUNT_TYPES.map(([v, l, ic]) => h('option', { value: v, selected: data.type === v }, `${ic} ${l}`)))),
    field(LIABILITY_TYPES.has(data.type) ? 'Balance owed' : 'Current balance',
      h('input', { name: 'balance', type: 'number', step: '0.01', inputmode: 'decimal', value: data.balance, required: true, placeholder: '0.00' })),
  );
  openModal(isNew ? 'Add account' : 'Edit account', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = { name: fd.get('name'), type: fd.get('type'), balance: parseFloat(fd.get('balance')) || 0 };
      if (isNew) {
        const item = await api('/api/accounts', 'POST', body);
        S.accounts.push(item);
      } else {
        const item = await api('/api/accounts/' + a.id, 'PUT', body);
        Object.assign(a, item);
      }
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

/* ---------------------------- transactions ---------------------------- */

function txRow(t) {
  const c = catById(t.category);
  const acct = acctById(t.accountId);
  return h('div', { class: 'row clickable', onclick: () => txModal(t) },
    h('div', { class: 'r-icon' }, c?.icon || '💳'),
    h('div', { class: 'r-main' },
      h('div', { class: 'r-title' }, t.merchant || '(no name)'),
      h('div', { class: 'r-sub' }, [c?.name, acct?.name].filter(Boolean).join(' · ') || '—')),
    h('div', { class: 'r-amt' + (t.amount > 0 ? ' amt-pos' : '') }, fmtSign(t.amount),
      h('div', { class: 'r-sub' }, fmtDate(t.date))),
  );
}

function pageTransactions(main) {
  main.append(pageHead('Transactions', null,
    h('button', { class: 'btn btn-primary', onclick: () => txModal(null) }, '+ Add')));

  const f = S.txFilter;
  const months = [...new Set(S.transactions.map((t) => monthKey(t.date)))].sort().reverse();
  const filters = h('div', { class: 'filters' },
    h('input', { type: 'search', placeholder: 'Search merchant or notes…', value: f.q, oninput: (e) => { f.q = e.target.value; renderList(); } }),
    h('select', { onchange: (e) => { f.month = e.target.value; renderList(); } },
      h('option', { value: '' }, 'All months'),
      ...months.map((m) => h('option', { value: m, selected: f.month === m }, fmtMonth(m)))),
    h('select', { onchange: (e) => { f.cat = e.target.value; renderList(); } },
      h('option', { value: '' }, 'All categories'),
      ...S.categories.map((c) => h('option', { value: c.id, selected: f.cat === c.id }, `${c.icon} ${c.name}`))),
    h('select', { onchange: (e) => { f.acct = e.target.value; renderList(); } },
      h('option', { value: '' }, 'All accounts'),
      ...S.accounts.map((a) => h('option', { value: a.id, selected: f.acct === a.id }, a.name))),
  );
  main.append(filters);

  const card = h('div', { class: 'card' });
  main.append(card);

  function renderList() {
    const q = f.q.trim().toLowerCase();
    let list = S.transactions.filter((t) =>
      (!q || (t.merchant || '').toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q)) &&
      (!f.month || monthKey(t.date) === f.month) &&
      (!f.cat || t.category === f.cat) &&
      (!f.acct || t.accountId === f.acct));
    card.innerHTML = '';
    if (!list.length) {
      card.append(emptyState('🧾', S.transactions.length ? 'Nothing matches these filters.' : 'No transactions yet. Add your first one.', '+ Add transaction', () => txModal(null)));
      return;
    }
    const spentSum = list.filter((t) => t.amount < 0).reduce((s, t) => s + -t.amount, 0);
    const inSum = list.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    card.append(h('div', { class: 'r-sub', style: 'padding:2px 2px 6px;color:var(--ink-2)' },
      `${list.length} transactions · in ${fmt(inSum)} · out ${fmt(spentSum)}`));
    let lastDate = '';
    const cap = 400;
    for (const t of list.slice(0, cap)) {
      if (t.date !== lastDate) {
        lastDate = t.date;
        card.append(h('div', { class: 'date-group' }, fmtDate(t.date, true)));
      }
      card.append(txRow(t));
    }
    if (list.length > cap) card.append(h('div', { class: 'r-sub', style: 'padding:10px 2px;color:var(--ink-3)' }, `Showing first ${cap}. Use filters to narrow down.`));
  }
  renderList();
}

function txModal(t) {
  const isNew = !t;
  const data = t ? { ...t } : { date: todayISO(), merchant: '', category: '', accountId: S.accounts[0]?.id || '', amount: '', notes: '' };
  let sign = (t && t.amount > 0) ? 1 : -1;

  const expBtn = h('button', { type: 'button' }, 'Expense');
  const incBtn = h('button', { type: 'button' }, 'Income');
  const syncSign = () => {
    expBtn.className = sign < 0 ? 'active-exp' : '';
    incBtn.className = sign > 0 ? 'active-inc' : '';
  };
  expBtn.onclick = () => { sign = -1; syncSign(); };
  incBtn.onclick = () => { sign = 1; syncSign(); };
  syncSign();

  const expCats = S.categories.filter((c) => c.group !== 'income');
  const incCats = S.categories.filter((c) => c.group === 'income');
  const form = h('form', { class: 'form-grid' },
    h('div', { class: 'sign-toggle' }, expBtn, incBtn),
    field('Amount', h('input', { name: 'amount', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true, value: t ? Math.abs(t.amount) : '', placeholder: '0.00' })),
    field('Merchant / description', h('input', { name: 'merchant', value: data.merchant, required: true, placeholder: 'e.g. Whole Foods' })),
    h('div', { class: 'two-col' },
      field('Date', h('input', { name: 'date', type: 'date', value: data.date, required: true })),
      field('Account', h('select', { name: 'accountId' },
        h('option', { value: '' }, '— none —'),
        ...S.accounts.map((a) => h('option', { value: a.id, selected: data.accountId === a.id }, a.name)))),
    ),
    field('Category', h('select', { name: 'category' },
      h('optgroup', { label: 'Spending' }, ...expCats.map((c) => h('option', { value: c.id, selected: data.category === c.id }, `${c.icon} ${c.name}`))),
      h('optgroup', { label: 'Income' }, ...incCats.map((c) => h('option', { value: c.id, selected: data.category === c.id }, `${c.icon} ${c.name}`))),
    )),
    field('Notes', h('input', { name: 'notes', value: data.notes || '', placeholder: 'Optional' })),
  );

  openModal(isNew ? 'Add transaction' : 'Edit transaction', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = {
        date: fd.get('date'),
        merchant: fd.get('merchant'),
        category: fd.get('category'),
        accountId: fd.get('accountId'),
        amount: sign * Math.abs(parseFloat(fd.get('amount')) || 0),
        notes: fd.get('notes'),
      };
      if (isNew) {
        const item = await api('/api/transactions', 'POST', body);
        S.transactions.push(item);
      } else {
        const item = await api('/api/transactions/' + t.id, 'PUT', body);
        Object.assign(t, item);
      }
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

/* ------------------------------ cash flow ----------------------------- */

function pageCashflow(main) {
  main.append(pageHead('Cash flow', 'Money in vs money out'));

  const agg = monthAgg(6);
  const cur = agg[agg.length - 1];
  const net = cur.income - cur.expense;
  main.append(h('div', { class: 'stat-row' },
    statTile(`Income · ${fmtMonth(cur.key)}`, fmt(cur.income)),
    statTile(`Expenses · ${fmtMonth(cur.key)}`, fmt(cur.expense)),
    statTile('Net', fmtSign(net)),
  ));

  const hasData = agg.some((d) => d.income || d.expense);
  const card = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'Last 6 months'),
    hasData ? cashflowChart(agg) : emptyState('📊', 'Add transactions to see income vs expenses here.', '+ Add transaction', () => txModal(null)),
  );
  if (hasData) {
    card.append(
      h('div', { class: 'legend' },
        h('span', { class: 'key' }, h('span', { class: 'swatch', style: 'background:var(--income)' }), 'Income'),
        h('span', { class: 'key' }, h('span', { class: 'swatch', style: 'background:var(--expense)' }), 'Expenses'),
      ),
      chartTable(['Month', 'Income', 'Expenses', 'Net'], agg.map((d) => [fmtMonth(d.key), fmt(d.income), fmt(d.expense), fmtSign(d.income - d.expense)])),
    );
  }
  main.append(card);

  // Category breakdown for selected month
  const months = [...new Set(S.transactions.map((t) => monthKey(t.date)))].sort().reverse();
  let selMonth = thisMonth();
  const sel = h('select', { onchange: (e) => { selMonth = e.target.value; renderBreak(); } },
    ...(months.length ? months : [thisMonth()]).map((m) => h('option', { value: m, selected: m === selMonth }, fmtMonth(m))));
  const breakCard = h('div', { class: 'card' });
  main.append(breakCard);

  function renderBreak() {
    breakCard.innerHTML = '';
    breakCard.append(h('div', { class: 'card-title' }, h('span', {}, 'Spending by category'), sel));
    const spend = spendingByCategory(selMonth);
    if (!spend.length) { breakCard.append(h('div', { class: 'empty' }, h('p', {}, 'No spending this month.'))); return; }
    const total = spend.reduce((s, x) => s + x.total, 0);
    breakCard.append(donutChart(spend));
    breakCard.append(h('div', { class: 'row-list', style: 'margin-top:14px' },
      ...spend.map(({ cat, total: v }) => h('div', { class: 'row' },
        h('div', { class: 'r-icon' }, cat.icon),
        h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, cat.name),
          h('div', { class: 'meter', style: 'max-width:220px' }, h('i', { class: 'ok', style: `width:${Math.round((v / total) * 100)}%` }))),
        h('div', { class: 'r-amt' }, fmt(v), h('div', { class: 'r-sub' }, Math.round((v / total) * 100) + '%')),
      ))));
  }
  renderBreak();
}

/* ------------------------------- budget ------------------------------- */

function budgetList(limit) {
  const mk = thisMonth();
  const spend = new Map(spendingByCategory(mk).map((x) => [x.cat.id, x.total]));
  let entries = Object.entries(S.budgets)
    .map(([id, amt]) => ({ cat: catById(id), amt, spent: spend.get(id) || 0 }))
    .filter((x) => x.cat)
    .sort((a, b) => (b.spent / b.amt) - (a.spent / a.amt));
  if (limit) entries = entries.slice(0, limit);
  return h('div', {}, ...entries.map(({ cat, amt, spent }) => {
    const pctN = Math.min(100, (spent / amt) * 100);
    const over = spent > amt;
    const left = amt - spent;
    return h('div', { class: 'budget-row' },
      h('div', { class: 'b-top' },
        h('div', { class: 'b-name' }, h('span', {}, cat.icon), h('span', {}, cat.name)),
        h('div', { class: 'b-nums' }, h('b', {}, fmt(spent)), ` of ${fmt(amt)}`)),
      h('div', { class: 'meter' }, h('i', { class: over ? 'over' : pctN > 85 ? '' : 'ok', style: `width:${pctN}%` })),
      h('div', { class: 'r-sub', style: `margin-top:4px;color:${over ? 'var(--neg)' : 'var(--ink-3)'}` },
        over ? `⚠ ${fmt(-left)} over budget` : `${fmt(left)} left`),
    );
  }));
}

function pageBudget(main) {
  const mk = thisMonth();
  main.append(pageHead('Budget', fmtMonth(mk),
    h('button', { class: 'btn btn-primary', onclick: budgetEditModal }, 'Edit budget')));

  const entries = Object.entries(S.budgets).map(([id, amt]) => ({ id, amt })).filter((x) => catById(x.id));
  const spend = new Map(spendingByCategory(mk).map((x) => [x.cat.id, x.total]));
  const totalBudget = entries.reduce((s, x) => s + x.amt, 0);
  const totalSpent = entries.reduce((s, x) => s + (spend.get(x.id) || 0), 0);

  if (!entries.length) {
    main.append(h('div', { class: 'card' }, emptyState('🎯', 'Set monthly limits per category, and Finch will track how you are doing against them.', 'Set up budget', budgetEditModal)));
    return;
  }

  main.append(h('div', { class: 'stat-row' },
    statTile('Budgeted', fmt(totalBudget)),
    statTile('Spent so far', fmt(totalSpent)),
    statTile('Remaining', fmt(totalBudget - totalSpent)),
  ));
  main.append(h('div', { class: 'card' }, budgetList()));
}

function budgetEditModal() {
  const expCats = S.categories.filter((c) => c.group !== 'income');
  const form = h('form', { class: 'form-grid' },
    ...expCats.map((c) => h('div', { class: 'two-col', style: 'align-items:center' },
      h('div', { style: 'font-weight:600;font-size:14.5px' }, `${c.icon} ${c.name}`),
      h('input', { name: c.id, type: 'number', min: '0', step: '1', inputmode: 'decimal', value: S.budgets[c.id] || '', placeholder: '—' }),
    )),
  );
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

/* -------------------------------- goals ------------------------------- */

function goalRow(g) {
  const pct = Math.min(100, (g.saved / g.target) * 100 || 0);
  return h('div', { class: 'budget-row goal-card clickable', style: 'cursor:pointer', onclick: () => goalModal(g) },
    h('div', { class: 'goal-emoji' }, g.icon || '🚩'),
    h('div', { class: 'goal-info' },
      h('div', { class: 'b-top' },
        h('div', { class: 'b-name' }, g.name),
        h('div', { class: 'goal-pct' }, Math.round(pct) + '%')),
      h('div', { class: 'meter' }, h('i', { class: 'ok', style: `width:${pct}%` })),
      h('div', { class: 'r-sub', style: 'margin-top:4px' },
        `${fmt(g.saved)} of ${fmt(g.target)}` + (g.targetDate ? ` · by ${fmtDate(g.targetDate, true)}` : '')),
    ),
  );
}

function pageGoals(main) {
  main.append(pageHead('Goals', 'Save toward what matters',
    h('button', { class: 'btn btn-primary', onclick: () => goalModal(null) }, '+ Add goal')));
  if (!S.goals.length) {
    main.append(h('div', { class: 'card' }, emptyState('🚩', 'Create savings goals — a trip, an emergency fund, a new laptop — and track progress.', '+ Add goal', () => goalModal(null))));
    return;
  }
  main.append(h('div', { class: 'card' }, ...S.goals.map(goalRow)));
}

function goalModal(g) {
  const isNew = !g;
  const data = g ? { ...g } : { name: '', icon: '🚩', target: '', saved: '', targetDate: '' };
  const form = h('form', { class: 'form-grid' },
    h('div', { class: 'two-col' },
      field('Emoji', h('input', { name: 'icon', value: data.icon, maxlength: '4' })),
      field('Name', h('input', { name: 'name', value: data.name, required: true, placeholder: 'e.g. Japan trip' }))),
    h('div', { class: 'two-col' },
      field('Target amount', h('input', { name: 'target', type: 'number', min: '1', step: '0.01', inputmode: 'decimal', required: true, value: data.target })),
      field('Saved so far', h('input', { name: 'saved', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: data.saved }))),
    field('Target date (optional)', h('input', { name: 'targetDate', type: 'date', value: data.targetDate || '' })),
  );
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

/* ------------------------------ more / settings ------------------------ */

function pageMore(main) {
  main.append(pageHead('More'));
  main.append(h('div', { class: 'card' },
    h('div', { class: 'row-list' },
      startRow('📊', 'Cash flow', 'Income vs expenses over time', () => go('cashflow')),
      startRow('🚩', 'Goals', 'Savings goals and progress', () => go('goals')),
      startRow('⚙', 'Settings', 'Currency, categories, security', () => go('settings')),
    )));
}

function pageSettings(main) {
  main.append(pageHead('Settings'));

  const CURRENCIES = ['USD', 'EUR', 'GBP', 'RUB', 'UAH', 'KZT', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'TRY', 'AED', 'INR', 'BRL'];
  main.append(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'General'),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Your name'), h('div', { class: 's-sub' }, 'Used in the greeting')),
      h('input', { class: 'input', style: 'max-width:160px', value: S.settings.name || '', placeholder: 'Optional', onchange: async (e) => { S.settings = await api('/api/settings', 'PUT', { name: e.target.value }); toast('Saved'); } })),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Currency'), h('div', { class: 's-sub' }, 'Display currency for all amounts')),
      h('select', { class: 'input', onchange: async (e) => { S.settings = await api('/api/settings', 'PUT', { currency: e.target.value }); toast('Saved'); render(); } },
        ...CURRENCIES.map((c) => h('option', { value: c, selected: S.settings.currency === c }, c)))),
  ));

  main.append(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'Categories'),
    h('div', { class: 'row-list' },
      ...S.categories.map((c) => h('div', { class: 'row clickable', onclick: () => categoryModal(c) },
        h('div', { class: 'r-icon' }, c.icon),
        h('div', { class: 'r-main' }, h('div', { class: 'r-title' }, c.name), h('div', { class: 'r-sub' }, c.group === 'income' ? 'Income' : 'Spending')),
        h('div', { style: 'color:var(--ink-3)' }, '›')))),
    h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn btn-sm', onclick: () => categoryModal(null) }, '+ Add category')),
  ));

  main.append(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'Security'),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Change password'), h('div', { class: 's-sub' }, 'Signs out all other devices')),
      h('button', { class: 'btn btn-sm', onclick: passwordModal }, 'Change')),
  ));

  main.append(h('div', { class: 'card' },
    h('div', { class: 'card-title' }, 'Data'),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Export data'), h('div', { class: 's-sub' }, 'Download everything as JSON')),
      h('button', { class: 'btn btn-sm', onclick: exportData }, 'Export')),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Load demo data'), h('div', { class: 's-sub' }, 'Replaces current data with a sample dataset')),
      h('button', { class: 'btn btn-sm', onclick: async () => { if (!confirm('Replace current data with demo data?')) return; Object.assign(S, await api('/api/demo', 'POST')); toast('Demo data loaded'); render(); } }, 'Load')),
    h('div', { class: 'settings-row' },
      h('div', {}, h('div', { class: 's-label' }, 'Erase all data'), h('div', { class: 's-sub' }, 'Deletes accounts, transactions, budgets, goals')),
      h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { if (!confirm('Erase ALL data? This cannot be undone.')) return; Object.assign(S, await api('/api/wipe', 'POST')); toast('All data erased'); render(); } }, 'Erase')),
  ));
}

function categoryModal(c) {
  const isNew = !c;
  const data = c ? { ...c } : { name: '', icon: '🏷️', group: 'expense' };
  const form = h('form', { class: 'form-grid' },
    h('div', { class: 'two-col' },
      field('Emoji', h('input', { name: 'icon', value: data.icon, maxlength: '4' })),
      field('Name', h('input', { name: 'name', value: data.name, required: true }))),
    field('Type', h('select', { name: 'group' },
      h('option', { value: 'expense', selected: data.group !== 'income' }, 'Spending'),
      h('option', { value: 'income', selected: data.group === 'income' }, 'Income'))),
  );
  openModal(isNew ? 'Add category' : 'Edit category', form, {
    onSave: async () => {
      const fd = new FormData(form);
      const body = { name: fd.get('name'), icon: fd.get('icon') || '🏷️', group: fd.get('group') };
      if (isNew) S.categories.push(await api('/api/categories', 'POST', body));
      else Object.assign(c, await api('/api/categories/' + c.id, 'PUT', body));
      toast('Saved');
      render();
    },
    onDelete: isNew ? null : async () => {
      if (!confirm(`Delete category "${c.name}"?`)) return false;
      await api('/api/categories/' + c.id, 'DELETE');
      S.categories = S.categories.filter((x) => x.id !== c.id);
      delete S.budgets[c.id];
      toast('Deleted');
      render();
    },
  });
}

function passwordModal() {
  const form = h('form', { class: 'form-grid' },
    field('Current password', h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
    field('New password', h('input', { name: 'next', type: 'password', required: true, minlength: '6', autocomplete: 'new-password' })),
  );
  openModal('Change password', form, {
    saveLabel: 'Update',
    onSave: async () => {
      const fd = new FormData(form);
      await api('/api/password', 'PUT', { current: fd.get('current'), next: fd.get('next') });
      toast('Password changed');
    },
  });
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
}

/* -------------------------------- modal ------------------------------- */

function field(label, input) {
  return h('div', {}, h('label', {}, label), input);
}

function openModal(title, form, { onSave, onDelete, saveLabel = 'Save' }) {
  const root = $('#modal-root');
  const close = () => { root.innerHTML = ''; };
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, saveLabel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    try { await onSave(); close(); }
    catch (err) { toast(err.message || 'Something went wrong'); saveBtn.disabled = false; }
  });
  const actions = h('div', { class: 'modal-actions' },
    onDelete ? h('button', {
      class: 'btn btn-danger', type: 'button',
      onclick: async () => {
        try { const r = await onDelete(); if (r !== false) close(); }
        catch (err) { toast(err.message || 'Failed'); }
      },
    }, 'Delete') : null,
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, 'Cancel'),
    saveBtn,
  );
  form.append(actions);
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'modal' }, h('h3', {}, title), form));
  root.append(back);
  const firstInput = form.querySelector('input, select');
  if (firstInput && window.innerWidth > 860) firstInput.focus();
}

/* --------------------------------- auth ------------------------------- */

function showAuth(needsSetup) {
  $('#app').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
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
  S.route = location.hash.replace(/^#\//, '') || 'dashboard';
  $('#app').classList.remove('hidden');
  render();
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
    $('#auth-password').value = ''; $('#auth-password2').value = '';
    await startApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', 'POST');
  showAuth(false);
});
$('#fab').addEventListener('click', () => txModal(null));

(async function init() {
  try {
    const st = await api('/api/status');
    if (st.needsSetup) showAuth(true);
    else if (!st.authed) showAuth(false);
    else await startApp();
  } catch {
    showAuth(false);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
