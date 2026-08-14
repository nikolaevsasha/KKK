#!/usr/bin/env node
/*
 * Imports a personal-finance spreadsheet into Finch's database.
 * Zero dependencies: an .xlsx is a zip of XML, and Node can read both.
 *
 *   node tools/import-xlsx.js path/to/Personal_Charges.xlsx [--dry-run]
 *
 * Sheets are matched by name, case-insensitively:
 *   Recurring           Service | Pay [| Frequency]      -> subscriptions
 *   Left2Pay            Name    | Pay | Date             -> bills
 *   Things to purchase  Category | Item | Notes | Link   -> wishlist
 *
 * Rows whose first cell is a total ("Monthly:", "Total:") are ignored, as are
 * formula cells. Re-running is safe: an entry that already exists is skipped.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

/* ------------------------------- zip reader ------------------------------ */

// Minimal zip reader: walks the central directory and inflates each entry.
function readZip(buf) {
  const files = new Map();
  // End of central directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // Local header: recompute where the data actually starts.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    files.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ------------------------------ xlsx parsing ----------------------------- */

const decode = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

function sharedStrings(files) {
  const f = files.get('xl/sharedStrings.xml');
  if (!f) return [];
  const xml = f.toString('utf8');
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(''));
}

const colIndex = (ref) => {
  const letters = ref.match(/^[A-Z]+/i)?.[0] || 'A';
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// Excel serial date -> ISO. Day 1 is 1900-01-01, with the classic 1900 leap bug.
function serialToISO(n) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function readSheet(files, sheetPath, strings) {
  const xml = files.get(sheetPath).toString('utf8');
  // A cell can show friendly text ("On-Running Link") while the real URL lives
  // in the sheet's relationships; resolve those so links actually work.
  const relPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const relFile = files.get(relPath);
  const relTargets = new Map();
  if (relFile) {
    for (const m of relFile.toString('utf8').matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relTargets.set(m[1], decode(m[2]));
    }
  }
  const links = new Map();
  for (const m of xml.matchAll(/<hyperlink\b([^>]*)\/?>/g)) {
    const ref = m[1].match(/ref="([^"]+)"/)?.[1];
    const rid = m[1].match(/r:id="([^"]+)"/)?.[1];
    const disp = m[1].match(/(?:location|display)="([^"]+)"/)?.[1];
    if (!ref) continue;
    const url = (rid && relTargets.get(rid)) || (disp ? decode(disp) : '');
    if (url) links.set(ref.split(':')[0], url);
  }
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    // Self-closing cells (<c r="C5"/>) must be matched FIRST: otherwise the
    // open-tag branch swallows them and steals the next cell's <v>.
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1] !== undefined ? cm[1] : (cm[2] || '');
      const inner = cm[1] !== undefined ? '' : (cm[3] || '');
      const ref = attrs.match(/r="([A-Z]+\d+)"/i)?.[1] || 'A1';
      const type = attrs.match(/t="([^"]+)"/)?.[1] || 'n';
      const style = attrs.match(/s="(\d+)"/)?.[1];
      if (/<f[\s>]/.test(inner)) { cells[colIndex(ref)] = { formula: true, value: '' }; continue; }
      const vRaw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const isRaw = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join('');
      let value = '';
      if (type === 's' && vRaw !== undefined) value = strings[+vRaw] ?? '';
      else if (type === 'inlineStr') value = isRaw;
      else if (vRaw !== undefined) value = decode(vRaw);
      cells[colIndex(ref)] = { value, type, style, ref, numeric: type === 'n' && vRaw !== undefined };
    }
    rows.push(cells);
  }
  rows.links = links;
  return rows;
}

function loadWorkbook(file) {
  const files = readZip(fs.readFileSync(file));
  const strings = sharedStrings(files);
  const wbXml = files.get('xl/workbook.xml').toString('utf8');
  const relsXml = files.get('xl/_rels/workbook.xml.rels').toString('utf8');
  const rels = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
    .map((m) => [m[1], m[2].replace(/^\/?xl\//, '')]));
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const target = rels.get(m[2]);
    if (!target) continue;
    sheets.push({ name: decode(m[1]), rows: readSheet(files, 'xl/' + target, strings) });
  }
  return sheets;
}

/* -------------------------------- mapping -------------------------------- */

const cell = (row, i) => (row && row[i] ? String(row[i].value ?? '').trim() : '');
const num = (row, i) => {
  const v = cell(row, i).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};
const isTotalRow = (row) => /^(monthly|total|sum|итого)\b/i.test(cell(row, 0));
const uid = () => crypto.randomBytes(8).toString('hex');

function findSheet(sheets, ...names) {
  return sheets.find((s) => names.some((n) =>
    s.name.toLowerCase().replace(/\s+/g, '') === n.toLowerCase().replace(/\s+/g, '')));
}

function importRecurring(sheet, db, catByName) {
  if (!sheet) return 0;
  let added = 0;
  for (const row of sheet.rows.slice(1)) {
    const name = cell(row, 0);
    const amount = num(row, 1);
    if (!name || amount === null || isTotalRow(row)) continue;
    if (db.subscriptions.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    const freqRaw = cell(row, 2).toLowerCase();
    const frequency = /year|annual/.test(freqRaw) ? 'yearly'
      : /week/.test(freqRaw) ? 'weekly' : /quarter/.test(freqRaw) ? 'quarterly' : 'monthly';
    db.subscriptions.push({
      id: uid(), name, amount, frequency,
      category: guessCategoryId(name, catByName, db), accountId: '', dayOfMonth: null, notes: '',
    });
    added++;
  }
  return added;
}

function importBills(sheet, db, catByName) {
  if (!sheet) return 0;
  let added = 0;
  for (const row of sheet.rows.slice(1)) {
    const name = cell(row, 0);
    const amount = num(row, 1);
    if (!name || amount === null || isTotalRow(row)) continue;
    let due = '';
    const dueCell = row[2];
    if (dueCell) {
      const raw = String(dueCell.value ?? '').trim();
      if (/^\d+(\.\d+)?$/.test(raw)) due = serialToISO(parseFloat(raw));
      else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) due = raw.slice(0, 10);
      else if (raw && !isNaN(new Date(raw))) due = new Date(raw).toISOString().slice(0, 10);
    }
    if (db.bills.some((b) => b.name.toLowerCase() === name.toLowerCase() &&
      Number(b.amount) === amount && b.due === due)) continue;
    db.bills.push({
      id: uid(), name, amount, due,
      category: guessCategoryId(name, catByName, db), notes: '',
    });
    added++;
  }
  return added;
}

function importWishlist(sheet, db) {
  if (!sheet) return 0;
  const links = sheet.rows.links || new Map();
  let added = 0;
  for (const row of sheet.rows.slice(1)) {
    const category = cell(row, 0);
    const name = cell(row, 1);
    if (!name || isTotalRow(row)) continue;
    const notes = cell(row, 2);
    // Column D may hold a URL, or link text whose target is a hyperlink rel.
    const linkText = cell(row, 3);
    const link = /^https?:\/\//i.test(linkText)
      ? linkText
      : (row[3] && links.get(row[3].ref)) || (linkText && links.get(row[1]?.ref)) || linkText;
    const key = (v) => String(v || '').toLowerCase().trim();
    if (db.wishlist.some((w) => key(w.name) === key(name) &&
      key(w.notes) === key(notes) && key(w.link) === key(link))) continue;
    db.wishlist.push({
      id: uid(), name, category, notes,
      link, price: 0, priority: 'normal', bought: false,
    });
    added++;
  }
  return added;
}

// Light keyword mapping so imported rows land in a sensible category.
const NAME_RULES = [
  [/rent|apartment|landlord/i, 'Rent'],
  [/mortgage/i, 'Mortgage'],
  [/coned|con edison|electric|power|energy/i, 'Gas & Electric'],
  [/water/i, 'Water'],
  [/t\s*-?\s*mobile|at\s*&\s*t|verizon|phone|wireless/i, 'Phone'],
  [/comcast|xfinity|spectrum|internet|cable|fios/i, 'Internet & Cable'],
  [/contabo|vps|hosting|aws|digitalocean|hetzner|domain|claude|openai|anthropic|apple|amazon|google|icloud|dropbox|github|adobe|notion|figma/i, 'Software & Subscriptions'],
  [/netflix|spotify|hulu|disney|hbo|youtube/i, 'Entertainment & Recreation'],
  [/chase|capital one|cashapp|amex|american express|discover|credit|card|loan/i, 'Loan Repayment'],
  [/insurance|geico|state farm|allstate/i, 'Insurance'],
  [/gym|fitness|equinox|planet/i, 'Fitness'],
];

// Groups for categories the rules may need to create on an older database.
const RULE_GROUPS = {
  'Software & Subscriptions': ['Bills & Utilities', '💻'],
  'Gas & Electric': ['Bills & Utilities', '💡'],
  'Internet & Cable': ['Bills & Utilities', '📶'],
  Phone: ['Bills & Utilities', '📱'],
  Water: ['Bills & Utilities', '🚰'],
  Rent: ['Housing', '🏠'],
  Mortgage: ['Housing', '🏡'],
  'Loan Repayment': ['Financial', '💸'],
  Insurance: ['Financial', '☂️'],
  Fitness: ['Health & Wellness', '🏋️'],
  'Entertainment & Recreation': ['Travel & Lifestyle', '🎬'],
};

function guessCategoryId(name, catByName, db) {
  for (const [re, cat] of NAME_RULES) {
    if (!re.test(name)) continue;
    const key = cat.toLowerCase();
    if (catByName.has(key)) return catByName.get(key);
    // The category is missing on this database (older install) — create it.
    const [group, icon] = RULE_GROUPS[cat] || ['Other', '🏷️'];
    const created = { id: uid(), name: cat, icon, type: 'expense', group };
    db.categories.push(created);
    catByName.set(key, created.id);
    return created.id;
  }
  return '';
}

/* ---------------------------------- main --------------------------------- */

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node tools/import-xlsx.js <spreadsheet.xlsx> [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }

  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const dbFile = path.join(dataDir, 'db.json');
  if (!fs.existsSync(dbFile)) {
    console.error(`No database at ${dbFile}. Start Finch and set your password first.`);
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  for (const k of ['subscriptions', 'bills', 'wishlist', 'categories']) if (!db[k]) db[k] = [];
  const catByName = new Map(db.categories.map((c) => [c.name.toLowerCase(), c.id]));

  const sheets = loadWorkbook(file);
  console.log(`Sheets found: ${sheets.map((s) => s.name).join(', ')}`);

  const subs = importRecurring(findSheet(sheets, 'Recurring', 'Subscriptions'), db, catByName);
  const bills = importBills(findSheet(sheets, 'Left2Pay', 'Left to pay', 'Bills'), db, catByName);
  const wish = importWishlist(findSheet(sheets, 'Things to purchase', 'Wishlist', 'To buy'), db);

  console.log(`  subscriptions: +${subs} (total ${db.subscriptions.length})`);
  console.log(`  bills:         +${bills} (total ${db.bills.length})`);
  console.log(`  wishlist:      +${wish} (total ${db.wishlist.length})`);

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    return;
  }
  fs.writeFileSync(dbFile + '.tmp', JSON.stringify(db));
  fs.renameSync(dbFile + '.tmp', dbFile);
  console.log(`\nWritten to ${dbFile}. Restart Finch (or just reload the page) to see it.`);
}

main();
