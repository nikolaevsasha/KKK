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
- **Recurring** — detects subscriptions and fixed bills automatically (any
  merchant seen in three or more months), with estimated monthly and yearly cost
- **Goals** — savings goals with progress bars
- **Investments** — portfolio value over time and allocation across accounts
- **Advice** — insights generated from your own data: savings rate, over-budget
  categories, recurring-payment load, month-over-month spending swings
- **Settings** — currency (15 supported), custom categories and groups, password
  change, JSON export, demo data, erase-all
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
- Finch never connects to a bank. You enter data yourself, so no bank
  credentials exist to leak.

## Layout

```
server.js              Node HTTP server: static files + JSON API + auth
public/index.html      App shell
public/styles.css      Theme, layout, components, dark mode
public/app.js          Router, pages, modals, derived data
public/charts.js       Line/area, grouped bars, donut, sankey, sparkline
public/icons.js        Line icon set
public/sw.js           Service worker (offline shell)
public/manifest.webmanifest
tools/make-icons.js    Regenerates PNG icons from the SVG mark
deploy/                systemd unit, nginx config, Dockerfile, compose
```

The chart palette is colourblind-safe: it was validated for lightness band,
chroma, CVD separation, and contrast in both light and dark mode. Every chart
also ships a "View as table" fallback, so no value is conveyed by colour alone.
