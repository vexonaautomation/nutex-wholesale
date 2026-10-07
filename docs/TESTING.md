# Y. Production testing checklist & Z. Redeployment / data-safety verification

## Automated tests (run before every deploy)

```bash
npm test
```

46 tests (`server/tests/`) run against an in-memory Sheets/Drive double that
enforces the same additive-only guard as production:

| File | Covers |
|---|---|
| `priceCalculator.test.js` | fixed 60 %, changed discount, min order below / exactly ₹10,000 / above, configurable minimum, slab reached but minimum not met (exact spec message), next slab & amount to next slab, whole-rupee slab boundaries, unlimited/custom slabs, inactive/deleted/dated slabs, all three slab bases incl. deterministic FINAL_PAYABLE, product override, paise rounding, box pieces, overlap validation |
| `dataSafety.test.js` | schema creation, **redeploy changes nothing**, additive column migration keeps data, header-less sheet untouched, admin-added columns preserved, single-cell updates, destructive requests blocked, atomic commit, immutable/duplicate IDs, formula injection |
| `orderFlow.test.js` | categories CRUD+audit, colour+size OOS isolation, client price manipulation ignored, minimum enforced on create, **full lifecycle** draft → edit → pay/lock → edit rejected → reject → re-submit → verify → fulfil → reopen → cancel with exact stock at every step, token/mobile access, duplicate checkout (sequential + concurrent), no overselling under concurrency, price-changed detection, **historical snapshot after price change / rename / deactivation / colour removal**, slab CRUD + overlap + min-order interplay, stale admin stock edits refused, unpaid-order expiry, **critical redeploy test** |
| `api.test.js` | real HTTP: admin 401/CSRF header/cookie flags, checkout, token required, multipart payment upload, API rejects edits of locked order, fake file types rejected, proofs not public |
| `catalogImport.test.js` | catalog.json valid (one product + image per catalogue page, unique SKUs, known colours), full import of 150 products/variants/images/category covers/logo/size chart, **re-run creates nothing and keeps admin edits and stock**, size-wise MRP priced per size, wizard size-wise MRP round-trip |
| `sellMode.test.js` | box per size with calculated price (size-wise MRP), new customers boxes only / existing customers box or pieces (quote + order API), loose pieces opened for new customers per article, no-box articles, PCS ↔ BOX ↔ BOTH switching keeps IDs and stock, pieces-per-box change keeps old boxes inactive, bulk selling options, first verified payment ⇒ existing customer (and setting off), older box products still work |
| `codeSafety.test.js` | static scan for destructive calls/startup seeding; production refuses memory backend & weak secrets |

Also: `npm run check:data-safety` and `NODE_ENV=production npm run validate:production` (read-only).

## Manual checklist (staging sheet first, then production smoke test)

| # | Scenario | How to verify |
|---|---|---|
| 1–2 | Add / edit category | Admin → Categories; appears on site menu within 60 s |
| 3–4 | Add / edit product | Wizard → Publish; only that product's rows change in the sheet |
| 5–6 | Deactivate / reactivate product | Product disappears/reappears on site; old orders still open |
| 7 | Color-wise product | Product page shows colours + size grid |
| 8 | Box-wise product | Shows “MIX COLOR BOX”, number-of-boxes stepper, no colour picker |
| 9–11 | Colour stock / size stock / colour+size OOS | Set one cell to 0 → only that size is disabled |
| 12 | Box OOS | Set boxes 0 → box row disabled |
| 13–14 | Fixed 60 % / change fixed % | Card prices + cart totals change |
| 15–18 | Slabs: enable, add, edit, deactivate | Discount slabs page + Test calculator + cart |
| 19 | Overlapping slab | Add 0–5000 and 4000–8000 → error message |
| 20–22 | Minimum below / exactly / above ₹10,000 | Cart: 48 × ₹500 @60 % (₹9,600) blocked; 50 × ₹500 (₹10,000) allowed |
| 23 | Edit before payment | Order page → Edit order → change → Update order |
| 24 | Edit after payment | Edit button gone; API `PUT /api/orders/:n` returns 409 ORDER_LOCKED |
| 25 | QR display | Payment page shows exactly the uploaded QR |
| 26–27 | Screenshot upload + UTR | Payment row in sheet; file in Drive/PAYMENT-PROOFS |
| 28 | WhatsApp confirmation | Button opens WhatsApp with order no, amount, UTR |
| 29–30 | Verify / reject payment | Admin → Payments; customer timeline updates |
| 31 | Reopen | Reason required; audit log row ORDER_REOPENED |
| 32–34 | Old order after price change / rename / deactivation | Open the old order → original price, name, size, colour |
| 35–38 | Redeploy | See Z below |
| 39 | Stock validation | Two browsers buy the last units → second gets “Stock has changed” |
| 40 | Duplicate checkout | Double-click “Place order” → one order only |

---

## Z. Critical redeployment / data-safety verification (non-negotiable)

Automated version: `CRITICAL REDEPLOY TEST` in `server/tests/orderFlow.test.js`
(creates bulk products/categories/colours/customers/orders/payments, redeploys,
asserts byte-identical sheets, edits one product and asserts only that row
changed, verifies old orders and locks, redeploys again).

Manual version on a **staging** deployment (own sheet + Drive folder):

1. **Create data**: categories, colours, ~100 products (use the wizard / duplicate), stock, ~50 orders through the website (use different mobile numbers), submit payments for most, verify some.
2. In Google Sheets: *File → Make a copy* → name `before-redeploy` (reference copy).
3. **Deploy a new code version**: push any commit to GitHub → Render auto-deploys (or *Manual Deploy → Clear build cache & deploy*).
4. Verify after deploy:
   - Row counts identical in every sheet (Products, Categories, Colors, Sizes, Inventory, Customers, Orders, Order_Items, Payments, Audit_Log, Settings).
   - Spot-check: open 5 products, 5 orders; images still load (Drive links unchanged).
   - Locked orders are still locked (try editing via the order page — not possible).
   - *Admin → Settings → System*: schema up to date, no migration errors.
5. **Change one product** (e.g. MRP) → in the sheet only that product's row (and its audit row) changed. Use *Version history* to compare.
6. **Open an old order** → original MRP / discount / unit price / name / size / colour.
7. **Redeploy again** and repeat step 4.

Pass criteria: no row lost, no value changed except the deliberate edit, all IDs identical, all Drive images still served.
