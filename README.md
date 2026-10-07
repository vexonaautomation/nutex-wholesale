# Nutex Apparel Limited — B2B Wholesale Ordering Platform

Production-ready wholesale e-commerce for **Nutex Apparel Limited**: bras, panties,
lingerie sets, camisoles and men's innerwear at wholesale prices.

> **CODE CAN CHANGE. BUSINESS DATA MUST SURVIVE.**
> GitHub = code · Render = runs the app · **Google Sheets = database** · **Google Drive = files**.
> A redeploy never resets, clears, reseeds or overwrites business data.

---

## Contents
1. [Features](#features)
2. [Architecture](#architecture)
3. [Project tree](#project-tree)
4. [Quick start (local demo, no Google account)](#quick-start-local-demo)
5. [Google Cloud / Sheets / Drive setup](#google-cloud--sheets--drive-setup)
6. [Environment variables](#environment-variables)
7. [Local development with Google](#t-local-development-setup)
8. [Admin setup](#admin-setup)
9. [GitHub setup](#u-github-setup)
10. [Render deployment](#v-render-deployment)
11. [Production checklist](#production-checklist)
12. [Backup & migration strategy](#backup--migration-strategy)
13. [Troubleshooting](#troubleshooting)
14. Further docs: [Architecture & business logic](docs/ARCHITECTURE.md) · [Sheets schema](google-sheets/schema.md) · [Google setup](google-sheets/setup.md) · [Migrations & backups](google-sheets/migration.md) · [Admin & customer guide](docs/ADMIN_GUIDE.md) · [Testing & redeploy verification](docs/TESTING.md)

---

## Features

**Existing customers** — numbers listed in the `Existing_Customers` sheet verify with a **WhatsApp OTP** (from the header, before shopping) and can order any quantity — the minimum order does not apply to them, and they may buy loose pieces. A new customer becomes existing automatically when their first payment is verified.

**Box / loose pieces** — Nutex sets N pieces per box per article (one box per size, assorted colours, price = N × piece MRP). Existing customers choose box or loose pieces on every article; new customers buy boxes only, except articles where Nutex opens loose pieces (e.g. when stock cannot make a full box).

**Customer website** — dynamic categories & products from Google Sheets · colour + size-grid ordering · mix-colour box ordering · live server-calculated cart (MRP total, discount %, discount amount, final total) · separate **discount-slab progress** and **minimum-order progress** with exact remaining amounts · checkout disabled below the minimum · idempotent checkout · order number `NX-YYYYMMDD-NNNN` · edit order until payment · payment page with the **exact admin QR**, UPI copy · UTR + screenshot submission (stored in Drive) · automatic **order lock** · WhatsApp confirmation · order tracking (order number + mobile) · policies · SEO (per-page meta/OpenGraph, sitemap, robots) · mobile-first with sticky cart.

**Admin (ERP-style)** — dashboard KPIs & alerts · 10-step product wizard · colour × size inventory matrix · box inventory · categories / colours / sizes (add, edit, reorder, deactivate, archive) · fixed discount or **unlimited slabs** with configurable basis, date windows, overlap validation and test calculator · orders with filters, status flow, dispatch details, **reopen with reason**, cancel · payment verification/rejection with proof viewer · customers · settings (company, pricing, payment QR, legal pages, admin users) · audit log · CSV exports.

**Data safety** — additive-only migrations on every start · atomic multi-sheet writes · rows found by immutable IDs, only changed cells written · code-level block of destructive Sheets requests · historical order snapshots · no demo seeding in production · 79 automated tests including a redeploy simulation.

## Architecture

```
Browser (React SPA) ──► Express on Render ──► Google Sheets (database)
                         │                └──► Google Drive (images, QR, payment proofs)
                         └─ serves client/dist + /api + /media
```
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (pricing engine, slab bases, minimum order, inventory states, order state machine, locking, API, security).

## Project tree

```
nutex-wholesale/
├── client/                         React + Vite storefront & admin
│   ├── index.html                  SEO markers filled by the server per page
│   ├── public/favicon.svg
│   └── src/
│       ├── App.jsx · main.jsx
│       ├── components/             Header, Footer, ProductCard, ProductGallery, ColorSelector,
│       │                           SizeSelector, QuantitySelector, CartDrawer (+StickyCartBar),
│       │                           CartSummary, OrderSummary, PaymentQR, DiscountProgress,
│       │                           MinimumOrderProgress, common/ (ui, Modal, Markdown, PriceTag, Icons)
│       ├── pages/                  Home, Shop, Category, Product, Cart, Checkout, Payment,
│       │                           Order, TrackOrder, Contact, Legal, NotFound
│       ├── admin/                  AdminApp (lazy), AdminLayout, Login, Dashboard, Products
│       │                           (list + wizard), Categories, Colors, Sizes, Inventory,
│       │                           DiscountSlabs, Orders (list + detail), Payments, Customers,
│       │                           Settings, AuditLog
│       ├── services/               api.js, auth.js (admin API), cart.js, order.js
│       ├── context/ hooks/ utils/ constants/ styles/
├── server/
│   ├── server.js · app.js          startup contract (migrate, never seed) + Express app
│   ├── config/                     env.js, google.js, schema.js, constants.js, defaults.js
│   ├── services/                   sheetsService, driveService, priceCalculator, quoteService,
│   │                               catalogService, productService, categoryService, colorService,
│   │                               sizeService, inventoryService, discountService, orderService,
│   │                               paymentService, customerService, settingsService, auditService,
│   │                               authService, migrationService, mediaService, dashboardService,
│   │                               seoService, exportService, setupService, bootstrap,
│   │                               storage/ (Google + in-memory transports, sheetsGuard)
│   ├── controllers/ routes/ middleware/
│   ├── utils/                      idGenerator, orderNumber, stockValidator, validation (zod),
│   │                               lockManager, idempotency, orderStateMachine, orderToken, …
│   ├── migrations/index.js         schema version registry
│   ├── dev/demoData.js             DEV ONLY demo catalogue (refused in production)
│   └── tests/                      node:test suites
├── catalog-import/                 catalog.json + images/ (Nutex PDF catalogue, one image per product)
├── google-sheets/                  schema.md, setup.md, migration.md, setup.gs (Apps Script)
├── docs/                           ARCHITECTURE.md, ADMIN_GUIDE.md, TESTING.md
├── scripts/                        setupSheets, validateProduction, createAdmin,
│                                   getDriveRefreshToken, dataSafetyCheck, seedDemo, dev, devMemory,
│                                   importCatalog, generateAppsScript
├── .env.example · .gitignore · .node-version · render.yaml · package.json (npm workspaces)
```

## Quick start (local demo)

Requires Node.js 20+.

```bash
npm install
```
```bash
npm run build
```
```bash
npm run demo
```
Open <http://localhost:4000> — store with the full Nutex catalogue (150 products, test stock); admin at <http://localhost:4000/admin>
(`admin@nutex.local` / `DemoAdmin12345`). The demo uses **in-memory storage**
(data resets on restart). It is refused when `NODE_ENV=production`.

Run the tests:
```bash
npm test
```

## Google Cloud / Sheets / Drive setup

Step-by-step (sections **Q, R, S**): **[google-sheets/setup.md](google-sheets/setup.md)**. Summary:

1. Create a Google Cloud project; enable **Google Sheets API** and **Google Drive API**.
2. Create a **service account** and a JSON key (keep it secret).
3. Create an empty Google Sheet; **share it as Editor** with the service-account email.
4. Create a Drive folder `NUTEX WHOLESALE`. Either put it in a **Workspace Shared drive** shared with the service account (`GOOGLE_DRIVE_AUTH=service_account`), or for a **personal Gmail** use OAuth: `npm run drive:token` (`GOOGLE_DRIVE_AUTH=oauth`) — service accounts cannot own files in a personal My Drive.
5. Put the IDs/keys into `.env` (local) and Render environment variables.
6. `npm run setup:sheets -- --with-master-data` then `npm run validate:production`.
7. Import the Nutex catalogue: *Admin → Catalogue Import* (or `npm run import:catalog -- --dry-run` / `npm run import:catalog`). See [catalog-import/README.md](catalog-import/README.md).

## Environment variables

**All Render variables in one file:** fill `deploy/render.env` (git-ignored copy of [deploy/render.env.example](deploy/render.env.example)), run `npm run env:check`, then Render → *Environment* → **Add from .env** → paste. Step-by-step (Hindi/English): [docs/RENDER_ENV.md](docs/RENDER_ENV.md).

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | ✓ | `production` on Render |
| `PORT` | – | Set by Render; 4000 locally |
| `FRONTEND_URL` | recommended | Public site URL (CORS, sitemap, OpenGraph) |
| `DATA_BACKEND` | – | `google` (default). `memory` = local demo/tests only, refused in production |
| `GOOGLE_SHEET_ID` | ✓ | Spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✓ | Service account email |
| `GOOGLE_PRIVATE_KEY` | ✓ | Service account private key (`\n` escapes allowed) |
| `GOOGLE_DRIVE_FOLDER_ID` | ✓ for uploads | Root Drive folder |
| `GOOGLE_DRIVE_AUTH` | – | `service_account` (Shared drive) or `oauth` (personal Gmail) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` | oauth only | From `npm run drive:token` |
| `JWT_SECRET` | ✓ | ≥ 32 random chars (admin sessions) |
| `SESSION_SECRET` | ✓ | ≥ 32 random chars (customer order-access tokens) |
| `ADMIN_SESSION_TIMEOUT` | – | `8h` default (`30m`, `1d`, or minutes) |
| `ADMIN_BOOTSTRAP_EMAIL` / `_PASSWORD` / `_NAME` | first run | Creates the first admin only if `Admin_Users` is empty |
| `WHATSAPP_PROVIDER` | for OTP | `cloudwhatsapp` (POST apikey/mobile/msg) · `console` = dev only |
| `WHATSAPP_API_URL` | for OTP | e.g. `https://web.cloudwhatsapp.com/wapp/api/send` |
| `WHATSAPP_API_KEY` | for OTP | WhatsApp API key — secret |
| `WHATSAPP_MOBILE_PREFIX` | – | Country code added before the 10-digit number (default `91`) |
| `CATALOG_CACHE_TTL_SECONDS` | – | Catalog cache (default 60). Checkout always reads fresh |
| `TRUST_PROXY` | – | `1` on Render |
| `LOG_LEVEL` | – | `info` |

Generate a secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Never commit `.env`, keys or the service-account JSON (all are in `.gitignore`).

## T. Local development setup

```bash
cp .env.example .env
```
Fill in a **development** spreadsheet + Drive folder (never the production sheet), then:
```bash
npm install
```
```bash
npm run setup:sheets -- --with-master-data
```
```bash
npm run admin:create -- --email you@example.com --name "Your Name" --role OWNER
```
```bash
npm run dev
```
Storefront with hot reload: <http://localhost:5173> (Vite proxies `/api` and `/media` to the API on :4000).
Optional demo products in the **development** sheet: `npm run seed:demo -- --dev-sheet`.

## Admin setup

1. First admin: `npm run admin:create`, **or** set `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` on Render (used only while `Admin_Users` is empty) and remove the password after the first login.
2. Sign in at `/admin` → follow the **Setup checklist** on the dashboard (master data, payment QR, WhatsApp).
3. Full guide: [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).

## U. GitHub setup

```bash
git init
```
```bash
git add .
```
```bash
git commit -m "Nutex wholesale platform"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/<your-account>/nutex-wholesale.git
```
```bash
git push -u origin main
```
Before the first push, confirm no secrets are staged (`git status` must not list `.env` or any `.json` key file). Keep the repository **private**.

## V. Render deployment

**Blueprint (recommended):** Render Dashboard → *New → Blueprint* → select the repo → Render reads `render.yaml`
(1 web service, `JWT_SECRET`/`SESSION_SECRET` auto-generated) → fill the `sync: false` variables → *Apply*.

> **Always on — no sleep mode.** Keep the service on the **Starter plan or higher** (set in `render.yaml`). Never choose *Free*: it sleeps after ~15 minutes without visitors (the next customer waits 30–60 s) and pauses the background job that auto-cancels unpaid orders. If Render shows a plan choice, pick **Starter**. Check later in Render → service → *Settings → Instance Type*.
>
> **Keep-alive (built in):** in production the server also pings its own address (`/api/ping`) every 10 minutes, so even an idle period never puts it to sleep. `/api/ping` only answers `{"ok":true}` — it never reads or writes Google Sheets/Drive, so **no data is affected** and no Google quota is used. It uses `RENDER_EXTERNAL_URL` (set by Render automatically); on another host set `KEEP_ALIVE_URL`. Turn off with `KEEP_ALIVE=off`. The log shows *Keep-alive: pinging …* at start-up and a warning if a ping fails.

**Manual web service:**

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instance type | **Starter or higher — never Free** (Free sleeps when idle) |
| Instances | **1** (inventory/order writes are serialised in-process) |
| Auto-deploy | On (every push to `main` deploys) |
| Disk | **None** — no data is stored on Render |

- **Port:** the server listens on `process.env.PORT` (Render sets it).
- **SPA routing:** Express serves `client/dist` and returns `index.html` (with page-specific meta) for every non-API route, so `/product/...`, `/admin/...` deep links work.
- `--include=dev` is required because Render sets `NODE_ENV=production`, which would otherwise skip Vite.
- On each start the server checks the Google Sheet schema (additive only), then serves traffic. `/api/health` returns `ready: true` once done.
- Custom domain: Render → Settings → Custom domains; then update `FRONTEND_URL`.

## Production checklist

- [ ] Render instance type **Starter or higher** (always on, never sleeps)
- [ ] Production Google Sheet owned by the business account, shared (Editor) with the service account only
- [ ] Drive folder configured (Shared drive or OAuth with consent screen **In production**)
- [ ] All env vars set on Render; secrets ≥ 32 chars; `NODE_ENV=production`
- [ ] `npm test` passes; `npm run check:data-safety` passes
- [ ] `NODE_ENV=production npm run validate:production` → “Ready for production”
- [ ] First admin created; bootstrap password removed; staff accounts added with strong passwords
- [ ] Company details, logo, WhatsApp, **payment QR**, UPI ID, payment instructions set
- [ ] Minimum order, discount mode/%, slabs, price display mode reviewed
- [ ] Legal pages reviewed by Nutex (defaults are templates)
- [ ] Demo data **never** loaded into the production sheet
- [ ] Test order placed, paid, verified, dispatched, then cancelled/cleaned via admin (status only)
- [ ] Redeploy verification done (see [docs/TESTING.md](docs/TESTING.md#z-critical-redeployment--data-safety-verification-non-negotiable))
- [ ] Weekly sheet backup routine agreed

## Backup & migration strategy

- **Migrations** are additive only: missing sheets/columns/settings are added; nothing is deleted or overwritten. How to add a column safely: [google-sheets/migration.md](google-sheets/migration.md).
- **Backups:** Google Sheets version history (automatic), weekly *File → Make a copy*, monthly `.xlsx` download, per-sheet CSV export in *Admin → Settings → System & backup*, Drive folder download / Google Takeout.
- **Restore** is manual and never overwrites the live sheet (restore a version or append missing rows with original IDs).

## Troubleshooting

| Problem | Solution |
|---|---|
| Site shows “The store is starting up” | Google not reachable or credentials wrong — check Render logs; `/api/health` shows `ready:false` and the server retries every 30 s |
| `Configuration error: …` on start | A required env var is missing (see table above) |
| `The caller does not have permission` | Share the Sheet with the service-account email as Editor |
| Image upload: `storage quota` | Personal Gmail: use `GOOGLE_DRIVE_AUTH=oauth` (`npm run drive:token`) or a Workspace Shared drive |
| Drive `invalid_grant` | OAuth refresh token expired/revoked — set consent screen to *In production* and regenerate |
| “Stock has changed. Please review your cart.” | Stock was taken by another order; the cart refreshes automatically |
| “Prices have changed” at checkout | Admin changed pricing while the customer was checking out; cart re-quotes |
| Admin edits rejected with “Stock changed since you loaded” | An order changed stock; reload the page and re-enter |
| 429 / “receiving many requests” | Google Sheets quota (60 req/min per service account); wait a minute. Catalog pages are cached |
| A sheet shows “has data but no header row” | Someone deleted row 1 — restore the header row from `google-sheets/schema.md` or version history |
| Duplicate ID error | A row was copy-pasted in the sheet — remove the duplicate row manually (keep the original) |
| Customer cannot open their order on a new phone | Use *Track order* with order number + mobile |
