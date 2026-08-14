# Finch — self-hosted personal finance dashboard

A private, installable finance dashboard for your own server. Track net worth,
accounts, transactions, budgets, cash flow, and savings goals. Install it on an
iPhone from Safari and use the same data from any PC browser.

Runs on plain Node.js with **zero npm dependencies** and stores everything in a
single JSON file on your VPS. Nothing is sent anywhere else.

## Features

- **Dashboard** — net worth trend, income/expense/savings-rate tiles, spending
  donut, budget snapshot, accounts, recent activity, goals
- **Accounts** — checking, savings, cash, investments, credit cards, loans,
  property, grouped into Cash / Credit Cards / Investments / Real Estate /
  Loans with per-account sparklines and an assets-vs-liabilities breakdown.
  Liabilities subtract from net worth automatically, and every balance edit is
  recorded so the net-worth chart grows over time.
- **Transactions** — add/edit/delete, search, filter by category and account,
  grouped by date with daily totals, CSV export
- **Reports** — three tabs:
  - *Cash Flow*: a **Sankey diagram** flowing income → categories, collapsing to
    group level on phones
  - *Spending*: donut by category or group, with a transaction list and summary
  - *Income*: donut by income source
- **Cash Flow** — six months of income vs expenses, plus net savings per month
- **Budget** — monthly limits per category, organised by category group
- **Recurring** — two tabs. *Subscriptions* is your own list (hosting, phone,
  rent, streaming) with monthly/yearly/weekly/quarterly billing normalised to a
  true monthly and yearly cost. *Detected* finds recurring merchants in your
  transactions automatically (any merchant seen in three or more months) and
  lets you promote one to a tracked subscription in a tap.
- **Goals** — savings goals with progress bars
- **Investments** — portfolio value over time and allocation across accounts
- **Advice** — insights generated from your own data: savings rate, over-budget
  categories, recurring-payment load, month-over-month spending swings
- **Left to pay** — what you still owe, by due date, with overdue and
  due-this-week totals. Marking a bill paid can record the payment as a
  transaction against an account in one step.
- **Wishlist** — things to buy later, grouped by category, with notes, links,
  optional prices and a bought/undo toggle
- **Settings** — currency (15 supported), custom categories and groups, password
  change, CSV import, JSON export, demo data, erase-all
- **PWA** — installable on iOS/Android/desktop, works offline for the shell,
  dark mode follows the system

Categories are organised into groups (Housing, Financial, Bills & Utilities,
Food & Dining, Transportation, Travel & Lifestyle, Shopping, Health & Wellness),
which is what the Sankey, the reports, and the budget page roll up to. You can
add your own categories and groups in Settings.

## Quick start (local)

```bash
node server.js
# open http://localhost:8484 and set a password
```

Environment variables: `PORT` (default `8484`), `HOST` (default `0.0.0.0`),
`DATA_DIR` (default `./data`).

The first page load asks you to create a password. Click **Load demo data** on
the empty dashboard to explore with sample data, then erase it in Settings.

## Importing data

### Bank statements (CSV)

**Transactions → Import CSV**, or **Settings → Import bank statement**. Export a
CSV from your bank and pick it — Finch works out the rest:

- **Column detection** for date, description, amount and category, including
  banks that use separate *Debit* / *Credit* columns instead of one signed
  amount, and files with no header row at all. Anything it guesses wrong you fix
  in the dropdowns, and the preview updates live.
- **Formats**: comma, semicolon, tab or pipe delimited; quoted fields with
  embedded commas; `1,234.56` and `1.234,56`; `(45.00)` and `-$45` negatives;
  ISO, `MM/DD/YYYY`, `DD.MM.YYYY` and `12 Jan 2025` dates. If day/month order is
  genuinely ambiguous, a checkbox settles it. Another toggle handles files that
  list spending as positive.
- **Merchant cleanup** strips the noise banks add — `POS PURCHASE WHOLE FOODS
  MKT 88213` becomes `Whole Foods Mkt`.
- **Categorisation** by keyword, by any category column in the file, and by what
  you picked for that merchant before.
- **Duplicate-safe**: a row matching an existing date, amount and merchant is
  skipped, so re-importing an overlapping statement adds only what is new.

### A spreadsheet you already keep

If you track money in Excel, `tools/import-xlsx.js` loads it directly — no
dependencies, no converting to CSV first:

```bash
node tools/import-xlsx.js ~/Personal_Charges.xlsx --dry-run   # preview
node tools/import-xlsx.js ~/Personal_Charges.xlsx             # import
```

It reads three sheets by name, case- and space-insensitively:

| Sheet | Columns | Becomes |
|---|---|---|
| `Recurring` | Service, Pay, *(Frequency)* | Subscriptions |
| `Left2Pay` | Name, Pay, Date | Left to pay |
| `Things to purchase` | Category, Item, Notes, Link | Wishlist |

Total rows (`Monthly:`, `Total:`) and formula cells are ignored, Excel serial
dates are converted, hyperlinks are resolved to their real URLs, and categories
are matched by name. Re-running skips anything already imported, so you can
re-import after editing the sheet.

## Quick entry on iPhone

Once Finch is on your home screen, there are three fast paths:

1. **Long-press the app icon** for *Add expense*, *Add income*, *Left to pay*
   and *Wishlist*. The first two jump straight to the entry sheet with the
   amount field focused and the number pad already up. Requires iOS 16.4+.
2. **The + button** in the bottom-right of any screen. The sheet is one big
   amount field, then merchant — and it remembers: type a merchant you have used
   before and it fills in the category you gave it last time, with recent
   merchants autocompleting.
3. **Siri Shortcuts and automations**, by opening a URL with values filled in:

   ```
   https://YOUR-DOMAIN/#/add?type=expense&amount=12.50&merchant=Coffee&category=Coffee%20Shops
   ```

   Every parameter is optional: `type` (`expense` or `income`), `amount`,
   `merchant`, `category` (matched by name) and `date` (`YYYY-MM-DD`). Wrap that
   in a Shortcut and you can log a coffee by saying "Hey Siri, coffee", or put a
   one-tap button on your Home Screen or Lock Screen.

## Deploy on a VPS

Requires Node.js 18+ and a domain pointed at the server. **HTTPS is required** —
iOS will not install a PWA to the home screen over plain HTTP.

### 1. Copy the app and install the service

```bash
sudo mkdir -p /opt/finch
sudo rsync -a ./ /opt/finch/          # or: git clone into /opt/finch
sudo useradd -r -s /usr/sbin/nologin finch || true
sudo chown -R finch:finch /opt/finch

sudo cp /opt/finch/deploy/finch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now finch
sudo systemctl status finch
```

### 2. Put Nginx and HTTPS in front

```bash
sudo cp /opt/finch/deploy/nginx.conf /etc/nginx/sites-available/finch
sudo sed -i 's/finch.example.com/YOUR-DOMAIN/' /etc/nginx/sites-available/finch
sudo ln -sf /etc/nginx/sites-available/finch /etc/nginx/sites-enabled/finch
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d YOUR-DOMAIN     # free TLS certificate
```

Certbot rewrites the config to serve HTTPS and redirect HTTP. Keep port 8484
closed in your firewall — only 80/443 need to be open:

```bash
sudo ufw allow 'Nginx Full' && sudo ufw enable
```

### Docker alternative

```bash
docker compose -f deploy/docker-compose.yml up -d
```

Data persists in the `finch-data` volume. Still put a TLS reverse proxy in front.

## Install on iPhone

1. Open `https://YOUR-DOMAIN` in **Safari** (not Chrome — only Safari can add to
   the home screen on iOS).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the icon. It opens full-screen with no browser chrome, and
   stays logged in for 90 days.

On Android/Chrome and desktop Chrome/Edge, use the install icon in the address
bar. On a PC you can also just use it as a normal website.

## Backups

Everything lives in one file: `/opt/finch/data/db.json`.

```bash
# nightly backup at 03:00
sudo crontab -e
0 3 * * * cp /opt/finch/data/db.json /var/backups/finch-$(date +\%F).json
```

Settings → **Export** downloads the same data as JSON from any device.

## Security notes

- One password protects the whole app; it is stored as an scrypt hash with a
  random salt, never in plain text.
- Sessions are HttpOnly, SameSite=Lax cookies, marked Secure behind an HTTPS
  proxy, valid 90 days. Changing the password signs out all other devices.
- Login attempts are rate-limited (5 failures → 60-second lockout).
- There is no signup and no multi-user support by design — this is your server.
- Finch never connects to a bank. You type entries yourself or import a CSV you
  downloaded, so no bank credentials exist to leak. CSV parsing happens in your
  browser; only the resulting transactions are sent to your own server.

## Layout

```
server.js              Node HTTP server: static files + JSON API + auth
public/index.html      App shell
public/styles.css      Theme, layout, components, dark mode
public/app.js          Router, pages, modals, derived data
public/charts.js       Line/area, grouped bars, donut, sankey, sparkline
public/icons.js        Line icon set
public/import.js       CSV parsing, column detection, categorisation
public/sw.js           Service worker (offline shell)
public/manifest.webmanifest
tools/make-icons.js    Regenerates PNG icons from the SVG mark
tools/import-xlsx.js   Imports an .xlsx of subscriptions/bills/wishlist
deploy/                systemd unit, nginx config, Dockerfile, compose
```

The chart palette is colourblind-safe: it was validated for lightness band,
chroma, CVD separation, and contrast in both light and dark mode. Every chart
also ships a "View as table" fallback, so no value is conveyed by colour alone.
