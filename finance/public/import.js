/* CSV bank-statement import: parse, guess columns, categorise, dedupe. */
'use strict';

/* --------------------------------- parsing ------------------------------- */

// RFC4180-ish parser: quoted fields, embedded commas/newlines, doubled quotes.
function parseCSV(text, delim) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!delim) delim = guessDelimiter(text);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''));
}

function guessDelimiter(text) {
  const head = text.split('\n').slice(0, 5).join('\n');
  const counts = [',', ';', '\t', '|'].map((d) => [d, (head.match(new RegExp('\\' + d, 'g')) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/* ------------------------------ value coercion --------------------------- */

const DATE_HEADERS = ['date', 'transaction date', 'posted date', 'posting date', 'trans date',
  'date posted', 'value date', 'booking date', 'completed date', 'started date', 'дата'];
const DESC_HEADERS = ['description', 'merchant', 'name', 'payee', 'details', 'memo', 'narrative',
  'transaction', 'reference', 'particulars', 'описание', 'назначение'];
const AMOUNT_HEADERS = ['amount', 'value', 'transaction amount', 'amt', 'sum', 'сумма'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'expense', 'charge'];
const CREDIT_HEADERS = ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'income'];
const CATEGORY_HEADERS = ['category', 'categories', 'type', 'classification'];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zа-я ]/gi, ' ').replace(/\s+/g, ' ').trim();

function headerScore(header, candidates) {
  const n = norm(header);
  if (!n) return 0;
  if (candidates.includes(n)) return 3;
  if (candidates.some((c) => n === c.replace(/\s/g, ''))) return 3;
  if (candidates.some((c) => n.includes(c))) return 2;
  if (candidates.some((c) => c.includes(n) && n.length >= 3)) return 1;
  return 0;
}

// Parse a date cell. Ambiguous D/M vs M/D is resolved by the caller's hint.
function parseDate(raw, dayFirst) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
    let day = dayFirst ? a : b, mon = dayFirst ? b : a;
    if (Number(mon) > 12 && Number(day) <= 12) [day, mon] = [mon, day]; // obvious swap
    return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // "12 Jan 2025", "Jan 12, 2025"
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-]+(\d{4})/i);
  if (m && MON.includes(m[2].toLowerCase()))
    return `${m[3]}-${String(MON.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^([a-z]{3})[a-z]*[\s-]+(\d{1,2}),?[\s-]+(\d{4})/i);
  if (m && MON.includes(m[1].toLowerCase()))
    return `${m[3]}-${String(MON.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

// Would this column be ambiguous between D/M and M/D? True when every row's
// first number is <= 12, so we cannot tell from the data alone.
function needsDayFirstHint(values) {
  let sawSlash = false;
  for (const v of values) {
    const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    sawSlash = true;
    if (Number(m[1]) > 12 || Number(m[2]) > 12) return false; // data settles it
  }
  return sawSlash;
}

// Handles "1,234.56", "1.234,56", "(45.00)", "45.00 CR", "-$12", "USD 12.00".
function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bcr\b/i.test(s)) sign = 1;
  if (/\bdr\b/i.test(s)) sign = -1;
  s = s.replace(/[^\d.,\-+]/g, '');
  if (s.startsWith('-')) { sign *= -1; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A lone comma is a decimal separator only when it looks like one.
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : sign * n;
}

/* ------------------------------ column guessing -------------------------- */

function analyse(rows) {
  if (!rows.length) return null;
  // A header row is one whose cells are mostly non-numeric text.
  const first = rows[0];
  const numericish = first.filter((c) => parseAmount(c) !== null && /\d/.test(c)).length;
  const hasHeader = numericish <= Math.max(0, Math.floor(first.length / 3));
  const headers = hasHeader ? first : first.map((_, i) => `Column ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;

  const cols = headers.map((hdr, i) => {
    const vals = body.slice(0, 60).map((r) => r[i] ?? '');
    const dates = vals.filter((v) => parseDate(v, false)).length;
    // A date is not an amount, even though "2025-03-04" parses as a number.
    const amounts = vals.filter((v) => parseAmount(v) !== null && /\d/.test(v) && !parseDate(v, false)).length;
    const nonEmpty = vals.filter((v) => v !== '').length || 1;
    return {
      index: i, header: hdr, values: vals,
      dateRatio: dates / nonEmpty,
      amountRatio: amounts / nonEmpty,
      textRatio: vals.filter((v) => v && parseAmount(v) === null).length / nonEmpty,
      avgLen: vals.reduce((s, v) => s + String(v).length, 0) / nonEmpty,
    };
  });

  const pick = (candidates, extra) => {
    let best = null, bestScore = 0;
    for (const c of cols) {
      const score = headerScore(c.header, candidates) * 10 + (extra ? extra(c) : 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return bestScore > 0 ? best.index : -1;
  };

  let dateCol = pick(DATE_HEADERS, (c) => c.dateRatio * 8);
  let descCol = pick(DESC_HEADERS, (c) => c.textRatio * 5 + Math.min(c.avgLen / 8, 4));
  const catCol = pick(CATEGORY_HEADERS, (c) => (c.textRatio > 0.7 ? 2 : 0));
  let amountCol = pick(AMOUNT_HEADERS, (c) => c.amountRatio * 6);
  const debitCol = pick(DEBIT_HEADERS, (c) => c.amountRatio * 4);
  const creditCol = pick(CREDIT_HEADERS, (c) => c.amountRatio * 4);

  // Headerless exports (and unrecognised header names) fall back to what the
  // column actually contains.
  const best = (score, exclude) => {
    const cand = cols.filter((c) => !exclude.includes(c.index))
      .map((c) => [c, score(c)]).filter(([, v]) => v > 0.6)
      .sort((a, b) => b[1] - a[1]);
    return cand.length ? cand[0][0].index : -1;
  };
  if (dateCol === -1) dateCol = best((c) => c.dateRatio, []);
  if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
    amountCol = best((c) => c.amountRatio, [dateCol]);
  }
  if (descCol === -1) descCol = best((c) => c.textRatio, [dateCol, amountCol, debitCol, creditCol]);
  if (debitCol !== -1 && creditCol !== -1 && debitCol !== creditCol) amountCol = -1;

  const dateVals = dateCol > -1 ? cols[dateCol].values : [];
  return {
    headers, body, cols,
    map: { date: dateCol, desc: descCol, amount: amountCol, debit: debitCol, credit: creditCol, category: catCol },
    ambiguousDate: needsDayFirstHint(dateVals),
  };
}

/* ---------------------------- row -> transaction ------------------------- */

function buildRows(analysis, opts) {
  const { map, body } = analysis;
  const { dayFirst, flipSign, accountId, categories, rules, existing } = opts;
  const seen = new Set((existing || []).map((t) =>
    `${t.date}|${Number(t.amount).toFixed(2)}|${(t.merchant || '').trim().toLowerCase()}`));

  const out = [];
  for (const r of body) {
    const date = parseDate(r[map.date], dayFirst);
    const merchant = cleanMerchant(map.desc > -1 ? r[map.desc] : '');
    let amount = null;
    if (map.amount > -1) {
      amount = parseAmount(r[map.amount]);
      if (amount !== null && flipSign) amount = -amount;
    } else {
      const debit = map.debit > -1 ? parseAmount(r[map.debit]) : null;
      const credit = map.credit > -1 ? parseAmount(r[map.credit]) : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    if (!date || amount === null || !amount) {
      out.push({ ok: false, reason: !date ? 'no date' : 'no amount', raw: r });
      continue;
    }
    const key = `${date}|${amount.toFixed(2)}|${merchant.toLowerCase()}`;
    const dupe = seen.has(key);
    if (!dupe) seen.add(key);
    const csvCat = map.category > -1 ? r[map.category] : '';
    out.push({
      ok: true, dupe, date, merchant, amount,
      category: guessCategory(merchant, csvCat, amount, categories, rules),
    });
  }
  return out;
}

// Strip the noise banks add: card numbers, dates, reference ids, POS prefixes.
function cleanMerchant(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  // Banks stack these ("POS PURCHASE ..."), so strip until none remain.
  const PREFIX = /^(pos|purchase|payment|debit card|credit card|card|visa|mastercard|ach|eft|sq|tst|pp|recurring)\b\s*[*#:-]?\s*/i;
  while (PREFIX.test(s)) s = s.replace(PREFIX, '');
  s = s.replace(/\b\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\b/g, '');
  s = s.replace(/\b(x{2,}|\*{2,})\d{2,}\b/gi, '');
  s = s.replace(/\b\d{6,}\b/g, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/[\s*#-]+$/, '').trim();
  if (!s) return String(raw || '').trim();
  // Title-case shouty bank text, leaving mixed-case names alone.
  if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) {
    s = s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return s.slice(0, 80);
}

// Keyword fallbacks used when nothing has been learned for a merchant yet.
const KEYWORD_RULES = [
  [/uber eats|doordash|grubhub|deliveroo|restaurant|pizza|sushi|grill|cafe|bar\b|diner|mcdonald|burger|taco|kfc|subway rest/i, 'Restaurants & Bars'],
  [/starbucks|coffee|espresso|dunkin|peet|blue bottle/i, 'Coffee Shops'],
  [/grocer|market|supermarket|whole foods|trader joe|safeway|kroger|aldi|lidl|costco|walmart|target/i, 'Groceries'],
  [/uber(?!\s*eats)|lyft|taxi|cab\b|metro|transit|mta|subway trans|bus\b|train|rail/i, 'Public Transit'],
  [/shell|chevron|exxon|bp\b|texaco|gas station|fuel|petrol/i, 'Gas'],
  [/rent|landlord|apartment|property mgmt/i, 'Rent'],
  [/mortgage/i, 'Mortgage'],
  [/electric|power|energy|coned|con edison|utility|water dept|gas co/i, 'Gas & Electric'],
  [/comcast|xfinity|spectrum|verizon fios|internet|broadband|cable/i, 'Internet & Cable'],
  [/t-?mobile|at&t|sprint|vodafone|mobile|wireless|phone/i, 'Phone'],
  [/netflix|spotify|hulu|disney|youtube|prime video|hbo|apple\.com\/bill|itunes|patreon|twitch/i, 'Entertainment & Recreation'],
  [/amazon|ebay|etsy|aliexpress|shop|store/i, 'Shopping'],
  [/uniqlo|zara|h&m|nike|adidas|clothing|apparel|cos\b|charles tyrwhitt/i, 'Clothing'],
  [/best buy|apple store|newegg|micro center|electronics/i, 'Electronics'],
  [/pharmacy|walgreens|cvs|doctor|clinic|hospital|medical|dental|dentist/i, 'Medical'],
  [/gym|fitness|planet|equinox|yoga|crossfit/i, 'Fitness'],
  [/airline|air\b|delta|united|jetblue|ryanair|hotel|airbnb|booking\.com|expedia|hostel/i, 'Travel & Vacation'],
  [/vet|petco|petsmart|chewy/i, 'Pets'],
  [/insurance|geico|state farm|allstate|progressive/i, 'Insurance'],
  [/atm|cash withdrawal|withdrawal/i, 'Cash & ATM'],
  [/fee|interest charge|service charge|overdraft/i, 'Fees'],
  [/payroll|salary|direct dep|paycheck|wages/i, 'Paychecks'],
  [/interest paid|dividend/i, 'Interest'],
  [/contabo|digitalocean|hetzner|linode|aws|vultr|hosting|domain|namecheap|godaddy|openai|anthropic|claude|github|figma|adobe|notion|dropbox|icloud|google storage/i, 'Software & Subscriptions'],
];

function guessCategory(merchant, csvCategory, amount, categories, rules) {
  const byName = (n) => categories.find((c) => c.name.toLowerCase() === String(n).toLowerCase())?.id || '';
  const m = (merchant || '').toLowerCase();
  // 1. A rule learned from a previous import or manual edit wins.
  for (const r of rules || []) {
    if (r.match && m.includes(r.match.toLowerCase()) && categories.some((c) => c.id === r.categoryId))
      return r.categoryId;
  }
  // 2. A category column in the file, if it maps to a category we have.
  if (csvCategory) {
    const hit = byName(csvCategory);
    if (hit) return hit;
  }
  // 3. Keyword match on the merchant.
  for (const [re, name] of KEYWORD_RULES) {
    if (re.test(m)) {
      const hit = byName(name);
      if (hit && (amount < 0) === (categories.find((c) => c.id === hit)?.type !== 'income')) return hit;
      if (hit) return hit;
    }
  }
  // 4. Fall back to a sensible default for the direction of the money.
  return amount > 0 ? byName('Other Income') : byName('Miscellaneous');
}
