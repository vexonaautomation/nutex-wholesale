# Nutex Wholesale — Architecture & Business Logic

## A. Architecture overview

```
                 ┌─────────────────────────── Render (1 web service) ──────────────────────────┐
 Browser ──────► │ Express (server/)                                                             │
 (React SPA)     │  ├─ serves client/dist (SPA + per-page SEO meta)                               │
                 │  ├─ /api/*   public & admin REST API (validation, auth, rate limits)           │
                 │  ├─ /media/* public images streamed from Drive (allow-list, cached)            │
                 │  └─ services ─ priceCalculator · orderService · inventory · payments · audit   │
                 │        │                                                                       │
                 │        ▼  sheetsService (atomic batches, additive-only guard)                  │
                 └────────┼────────────────────────────────────┬──────────────────────────────────┘
                          ▼                                    ▼
              Google Sheets = DATABASE              Google Drive = FILES
              (products, orders, payments…)        (images, QR, payment proofs)

 GitHub = CODE  ──(auto-deploy)──►  Render = RUNS the app (stores nothing permanent)
```

- **Stateless app server.** Nothing permanent lives on Render's disk or in memory.
  Restarting/redeploying loses only caches.
- **Google Sheets is the source of truth.** Every write goes through
  `sheetsService.commit()`, which sends ONE atomic `spreadsheets.batchUpdate`
  (all operations succeed or none are applied) — e.g. order + items + stock
  reservation + customer + status history + audit entry together.
- **Rows are located by immutable ID** right before each write; only the changed
  cells are updated. Columns are mapped by header name.
- **Caching:** public catalog reads are cached for 60 s (configurable) and
  served from one `batchGet`. Checkout, order creation, edits, payment
  submission and inventory writes always re-read fresh data.
- **Concurrency:** inventory/order/payment writes run inside an in-process
  mutex (`withLock('commerce')`) on fresh data → no overselling, no duplicate
  order numbers. Run a single Render instance (see `render.yaml`).
- **Modular:** the API is fully separate from the React app (CORS-ready via
  `FRONTEND_URL`), so the frontend can later be hosted separately.

## B. Technology stack

| Layer | Choice |
|---|---|
| Frontend | React 19, React Router 7, Vite 8, plain CSS design system, lucide icons, self-hosted Inter + Playfair Display |
| Backend | Node.js ≥ 20 (22 on Render), Express 5, zod validation, helmet, express-rate-limit, multer (memory), compression |
| Database | Google Sheets API v4 (`@googleapis/sheets`) via service account |
| Files | Google Drive API v3 (`@googleapis/drive`) via service account (Shared drive) or OAuth refresh token (personal Gmail) |
| Auth | bcrypt (12 rounds) hashed passwords, JWT in httpOnly SameSite=Strict cookie, session versioning |
| Tests | `node:test` with an in-memory Sheets/Drive double that enforces the same guard |
| Hosting | GitHub → Render web service (`render.yaml`) |

## C. Project tree

See [README](../README.md#project-tree).

## D/E. Database & storage

- Sheets schema: [google-sheets/schema.md](../google-sheets/schema.md)
- Drive layout & setup: [google-sheets/setup.md](../google-sheets/setup.md)

## F. Fixed discount logic

`discount_mode = FIXED` (default) → every line: `unit = round(MRP × (100 − default_discount_percent) / 100)`
(default 60 % → MRP 500 → 200). Admins change the % in *Discount slabs* or *Settings*.
A product with `discount_mode = CUSTOM` always uses its own `fixed_discount_percent`.

## G. Discount slab logic

`discount_mode = SLAB` → the cart falls into one **active** slab (active, not
deleted, inside its optional date window). Unlimited slabs, managed in
*Admin → Discount slabs*, stored in `Discount_Slabs`.

- Ranges are whole rupees and **inclusive**: `0–4999` ≡ `0 ≤ x < 5000`; blank max = “and above”.
- Overlapping active slabs (amount AND date window) are rejected by the API.
- Gaps/descending discounts are shown as warnings to the admin.
- If no slab matches, the discount is 0 % (the admin is warned).
- **Basis** (setting `discount_slab_basis`, default `MRP_SUBTOTAL`):
  - `MRP_SUBTOTAL` — Σ MRP × qty.
  - `PRE_DISCOUNT_WHOLESALE_SUBTOTAL` — Σ MRP × qty × (1 − base%), base% = product override or `default_discount_percent` (cart value at standard wholesale price before slabs).
  - `FINAL_PAYABLE` — deterministic **fixed-point rule** (no circularity): a slab
    qualifies if the final payable computed **with that slab's own %** is ≥ its
    minimum; the qualifying slab with the highest % wins (tie → lower priority
    number). `max_amount` is not used for qualification in this basis.
- The quote returns `current_slab`, `next_slab`, `amount_to_next_slab` (in basis
  units) and `mrp_to_next_slab` (MRP worth of products to add).

All of this lives in the pure function `server/services/priceCalculator.js`
(integer paise arithmetic, unit-tested).

## H. Minimum order calculation

Independent from slabs. Always: `minimum_order_met = final_payable ≥ minimum_order_value`
(setting, default ₹10,000). Exactly equal is allowed. `amount_to_minimum = max(0, min − final)`.
The server generates the messages, e.g.:
> You have reached the 55% discount slab, but your final payable wholesale value is below the minimum order requirement of ₹10,000.
> Add ₹3,250 more to continue.

Checkout and order edits are refused by the API (`422 MIN_ORDER_NOT_MET`) below the minimum;
the frontend button is disabled as a convenience only.

## I. Product / variant / inventory logic

- `Products` (one row) → `Product_Variants` (sellable units) → `Inventory` (one row per variant).
- **COLOR_WISE:** one variant per assigned colour × size. Stock per colour+size.
- **BOX_WISE:** one variant per box configuration (units per box, optional size,
  box MRP, mixed-colour description). Stock counted in boxes. Customers never pick colours.
- Out-of-stock levels: whole product (`Products.out_of_stock` or inactive/category inactive),
  colour (colour master inactive), colour+size or box (`Inventory` 0 or `OUT_OF_STOCK`).
- `available = stock − reserved`. Stock never negative; admins cannot set stock below reserved.
- Removing a colour/size/box from a product sets its variants **INACTIVE** (never deleted).
- Admin stock edits carry the value seen on screen (`expected_stock_qty`); if an
  order changed it meanwhile, the save is rejected with a conflict instead of overwriting.

Stock movements:

| Event | Stock | Reserved | `stock_state` |
|---|---|---|---|
| Order created (PAYMENT_PENDING) | – | + qty | RESERVED |
| Customer edits unpaid order | – | ± delta | RESERVED |
| Payment submitted (lock) | − qty | − qty | DEDUCTED |
| Admin reopens locked order | + qty | + qty | RESERVED |
| Cancel (reserved / deducted) | – / + qty | − qty / – | RELEASED |
| Unpaid order auto-expires (`reservation_expiry_hours`, default 72; never if any payment exists) | – | − qty | RELEASED |

## J. Order state machine

```
DRAFT ─┐
       └─► PAYMENT_PENDING ──(payment submitted → LOCK)──► PAYMENT_SUBMITTED ──verify──► PAYMENT_VERIFIED
                ▲                                              │  │                          │
                └──────────── admin REOPEN (reason) ───────────┘  └─reject─► PAYMENT_REJECTED │ (re-submit → PAYMENT_SUBMITTED)
                                                                                              ▼
                                  CONFIRMED ─► PROCESSING ─► PACKED ─► DISPATCHED ─► COMPLETED
   any state before DISPATCHED ──(admin cancel, reason)──► CANCELLED
```
Editable only in `DRAFT`/`PAYMENT_PENDING` **and** `locked = false`. Fulfilment
moves forward only and requires a verified payment (`server/utils/orderStateMachine.js`).

## K. Payment & QR flow

1. Admin uploads the company QR (stored unmodified in Drive `PAYMENT/`), UPI ID, payee name, instructions, WhatsApp.
2. Customer places the order → payment page shows order number, **amount due**, the **exact admin QR image**, UPI ID with copy button and instructions. No QR is generated by the site.
3. Customer pays in any UPI app, then submits amount + UTR + screenshot.
4. Server verifies the screenshot by magic bytes (JPG/PNG/WEBP/PDF ≤ 8 MB), stores it in Drive `PAYMENT-PROOFS/`, then atomically: appends a `Payments` row (SUBMITTED), locks the order, deducts stock, writes history + audit.
   Duplicate submissions are blocked (idempotency key, “already submitted” check, UTR reuse check).
5. “Confirm Payment on WhatsApp” opens WhatsApp with a pre-filled message. It does **not** verify anything.
6. Admin views the proof, checks the bank/UPI statement and **verifies** (order → PAYMENT_VERIFIED) or **rejects** with a reason (order → PAYMENT_REJECTED, still locked; customer may re-submit).

## L. Order locking logic

- Lock happens automatically on payment submission (`locked = TRUE`, `locked_at`).
- Every customer modification endpoint calls `assertOrderEditable()` on fresh data
  → `409 ORDER_LOCKED` *“Your order has been locked because payment confirmation has been submitted.”*
  Hidden buttons are only a UX layer.
- Only an authenticated admin can **reopen** (`POST /api/admin/orders/:id/reopen`
  with `confirm: true` and a reason ≥ 5 chars). The previous and new state,
  reason, admin and time are written to `Audit_Log` in the same atomic batch.
- Nothing ever reopens automatically.

## M. Admin panel architecture

Lazy-loaded React bundle under `/admin/*`: Dashboard, Products (list + 10-step
wizard), Categories, Colors, Sizes, Inventory (colour×size matrix, box table),
Discount Slabs (+ live calculator), Orders (filters, status counts) & Order
detail (verify/reject, status flow, dispatch details, reopen, cancel, revisions,
audit trail), Payments, Customers, Settings (company, pricing, payment, homepage,
legal, admin users, password, system/backup/exports), Audit Log.

## N. API architecture

Public (`/api`): `GET /health`, `GET /store`, `GET /settings/public`, `GET /categories`,
`GET /colors`, `GET /sizes`, `GET /products`, `GET /products/:id`,
`GET /products/:id/variants`, `POST /cart/quote`, `POST /orders/draft`,
`POST /orders/track`, `GET /orders/:orderNumber`, `PUT /orders/:orderNumber`,
`POST /orders/:orderNumber/recalculate`, `POST /orders/:orderNumber/payment`
(multipart), `POST /orders/:orderNumber/lock`. Customer order endpoints require
the `X-Order-Token` header (HMAC of the order ID, issued at checkout or after
order-number + mobile verification).

Admin (`/api/admin`, cookie session): `POST /login`, `POST /logout`, `GET /me`,
`POST /change-password`, users, `GET /dashboard`, products (list/create/update/
deactivate/reactivate/archive/duplicate/out-of-stock), categories/colors/sizes
(+ status, reorder), `GET|PUT /inventory`, discount-slabs (+ deactivate,
reactivate, delete-if-safe, preview), orders (list/detail/status/reopen/cancel),
payments (list/verify/reject/proof), customers, `GET|PUT /settings`,
`GET /audit-log`, `POST /uploads`, `GET /media/:fileId`, `GET /export/:sheet`,
`POST /setup/initial-master-data`, `GET /system`.

Errors: `{ error: { code, message, details? } }` with customer-friendly messages; stack traces are logged server-side only.

## O. Security architecture

- Secrets only in environment variables; `.env`, keys and service-account JSON are git-ignored.
- Admin passwords: bcrypt (12). JWT (HS256) in **httpOnly, Secure, SameSite=Strict** cookie; every request re-checks the admin is ACTIVE and the session version matches (password change / deactivation logs out everywhere). Mutations also require `X-Requested-With: NutexAdmin` (CSRF defence in depth). Roles: OWNER, ADMIN, STAFF.
- Rate limits: API 300/min/IP, login 10/15 min, order creation 30/h, lookups 40/15 min, payments 15/15 min.
- helmet: CSP (self only), HSTS, frameguard (`frame-ancestors 'none'`), nosniff, referrer policy.
- CORS: same-origin; only `FRONTEND_URL` allowed cross-origin.
- All input validated with zod; unknown fields stripped (client-sent prices are ignored).
- Prices, discounts, stock and totals always recalculated server-side; optional `client_final_payable` only detects “prices changed”.
- Uploads: memory only, 8 MB, magic-byte type check; proofs never public (admin route), public media restricted to catalogue/branding file IDs.
- Sheets writes use literal values → no formula injection; CSV exports neutralise `= + - @` prefixes.
- Customer order access requires an HMAC token (order numbers are guessable).
- The browser never talks to Google directly.
