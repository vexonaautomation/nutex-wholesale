# W. Admin user guide

Sign in at **`https://<your-site>/admin`**.

## First-time setup (in this order)
1. **Dashboard → Load initial master data** – adds the 10 Nutex categories, sizes 28–56 + Free Size and 8 basic colours (only into empty sheets).
2. **Settings → Company** – company name, logo, phone, email, address, GSTIN, **WhatsApp number** (with country code, e.g. `919876543210`).
3. **Settings → Payment** – upload the **company payment QR** (uploaded exactly as-is), UPI ID, payee name, instructions.
4. **Settings → Pricing & orders** – minimum order (default ₹10,000 final payable), discount mode (default fixed 60 %), price display mode, order prefix (`NX`), low-stock threshold, auto-cancel hours for unpaid orders.
5. **Settings → Legal pages** – review every policy (default templates are marked *review required*).
6. **Settings → Admin users** – add staff; then **My account** → change your password. Remove `ADMIN_BOOTSTRAP_PASSWORD` from Render.
7. **Catalogue Import** (left menu) – imports the Nutex PDF catalogue: 150 products, each with its own catalogue image, colours, sizes and MRP (see below). Enter per category **how many pieces are in one box** (and tick *Allow* where new customers may also buy loose pieces). Then add any further products with the wizard.

## Box / loose pieces
**The rule**

| Customer | Can buy |
|---|---|
| **Existing customer** | On every article: a **full box** *or* **loose pieces** (colour + size) — their choice |
| **New customer** | **Full boxes only** — except articles where you allow loose pieces |

- **Box** = one box per size with *N pieces* in **assorted colours** (no colour choice). You set N per article (*Pieces in one box*, e.g. 6). Box price is **calculated**: N × piece MRP of that size (size-wise MRP included), then the normal discount. Prices on the website are per piece.
- **Loose pieces for new customers** — per article: *Not allowed* (normal) or *Allowed for this article*, e.g. when the stock left cannot make a full box. Wizard step 5, or several products at once via *Products → tick → Box / pieces*.
- An article with **no box** (pieces per box blank) can be bought by new customers only if you allow loose pieces for it; existing customers can still buy pieces.
- Global switch: *Settings → Pricing & orders → Loose pieces for new customers* → “Allowed on every article” opens pieces for everybody.
- **First purchase ⇒ existing customer:** when you verify the first payment of a new customer, their mobile is added to *Existing Customers* automatically (note “Added automatically after first paid order …”). After WhatsApp verification they can then choose box or pieces everywhere, and the minimum order does not apply. Turn off in *Settings → After the first paid order* if you prefer to add existing customers yourself.
- The server enforces all of this — a new customer cannot order pieces even by editing the cart.
- **Stock is entered in pieces only** (per colour + size), never in boxes: wizard step 7, *Inventory*, or *Bulk update (Excel)*.
- **Boxes are always packed from the loose stock.** Each box takes the same number of pieces of every active colour of that size (pieces per box ÷ number of colours), and the box count follows the colour with the least stock. Example: box of 3, colours Orange 5 / Pink 8 / Green 15 → 1 of each per box → **5 boxes**. Ordering a box reserves (and on payment deducts) those pieces from each colour, and boxes + loose pieces in one cart are checked together, so nothing is oversold. The admin screens show "Auto: N boxes from loose stock".
  - Pieces per box must divide equally by the colours (6 with 3 colours = 2 each; 4 with 3 colours does not work). If not, the admin screens show a warning and that box cannot be sold until pieces per box is changed.
  - A product with a box needs colours (the box is packed from them).
  - To stop selling one box size, set that box to *Out of stock* on the Inventory page; loose pieces keep selling.
- Changing pieces per box (e.g. 6 → 12) creates new boxes with fresh stock; old boxes are kept inactive for order history.

## Catalogue import (Nutex PDF catalogue)
*Admin → Catalogue Import* shows every catalogue product (one per catalogue page) with its image, SKU, MRP, colours and sizes, and what the import will create.
- **Pcs per box** per category (blank = no box) and **Pcs for new customers** (*Allow* = new customers may also buy loose pieces). Existing customers always get box or pieces. Change later with *Products → Box / pieces*.
- **Starting stock** – pieces per colour + size (boxes are packed from them): 0 (enter real stock later in *Inventory*) or e.g. 50 to test ordering. Applies to NEW variants only.
- **Publish immediately** – untick to import as Inactive and publish category by category later.
- Click **Import** and keep the page open to watch progress (~2–4 minutes on Google Sheets; images go to Drive/PRODUCTS).
- **Additive and repeatable**: products whose SKU already exists are skipped and never changed (your prices, stock and status are kept). If the import is interrupted, just run it again – it continues with the missing products.
- Also created when missing: the T-Shirt Bra category, panty/men sizes (45-55 … 95-100, S–XXL), the catalogue colours, category cover images, the Nutex logo and the bra size chart (only if those settings are empty).
- Catalogue style numbers used by two different products got the product name appended to stay unique, e.g. `1010-AAKRITI-SET`, `1010-YASHIKA-SET`, `1010-CLARA-PANTY`.
- **Please check after import**: sizes are not printed in the catalogue for most styles, so defaults were used (bras 30–40, C-cup 34–42, panties 80-90 / 95-100, camisoles & shapewear S–XXL); Rambo vests have two prices (₹130 | ₹146 etc.) – the lower one was used for S–L and the higher for XL–XXL. Correct anything in the product wizard.
- Command-line alternative: `npm run import:catalog -- --dry-run`, then e.g. `npm run import:catalog -- --box-all=6 --box=everyday-panty:12 --pcs-new=camisole-collection --stock=0 --box-stock=0`.

## Categories / Colors / Sizes
Add, edit, reorder (arrows), deactivate/reactivate (categories can also be archived). Nothing is deleted; old orders keep their own snapshot. A new active category appears on the website immediately (within ~60 s cache).

## Adding a product (10-step wizard)
1. Basic information (name, SKU, slug, description, featured, sort order, SEO)
2. Category (+ optional subcategory text)
3. Pricing – MRP per piece; discount = *follow global* or *product-specific %*. Preview shows the wholesale price.
4. Sizes – plus optional **size-wise MRP** (e.g. 80-90 ₹62, 95-100 ₹70); blank = product MRP. The shop then shows “From ₹…” and the price next to each size.
5. Box / pieces – **pieces in one box** (blank = no box; live price example) and **loose pieces for NEW customers**: not allowed / allowed for this article
6. Colours for loose pieces (from the colour master) and a preview of the boxes per size with calculated box MRP / wholesale price
7. Inventory – loose pieces: colour × size matrix (0 = only that combination is out of stock). Boxes are shown, not entered: how many can be packed from these pieces now.
8. Images – upload (stored in Drive/PRODUCTS), reorder, set main, alt text
9. Status – Active / Inactive / Archived; “entire product out of stock”
10. Preview & **Publish** – only this product's rows are written.

Product list actions: edit, duplicate (copy saved inactive, zero stock), mark out of stock / restore, deactivate / reactivate, archive; tick several products → **Box / pieces** (pieces per box, loose pieces for new customers). The *Selling* column shows e.g. “Box of 6 pcs · Pcs: existing only”.

## Inventory
**Many items at once:** *Bulk update (Excel)* → download the stock sheet → fill `new_stock` (counted stock) or `add_stock` (received) → upload the CSV → check the preview → Apply. Step-by-step: `docs/STOCK_BULK_UPDATE.md`.

Pick a product: loose pieces show the colour × size matrix (with *reserved* and *available*) and boxes show how many can be packed from those pieces (read-only, with an In stock / Out of stock switch per box size). Edit and **Save changes** – only edited rows are written. If an order changed stock while you were editing you'll be asked to reload (nothing is overwritten). You cannot set stock below units reserved by unpaid orders.

## Discount slabs
- Switch **Fixed ↔ Slab**, change the fixed %, choose the slab basis.
- Add/edit slabs (min, max blank = “and above”, %, priority, optional dates). Overlaps are rejected; gaps are warned.
- Deactivate/reactivate; delete only if never used by an order.
- **Test calculator**: enter a cart MRP value to see the exact discount, final payable and minimum-order result.

## Orders
- Status tabs with counts, search by order number / mobile / name / business, date and payment filters, CSV export.
- Order detail: items **snapshot** (original price/name/size/colour even if the product changed later), totals, customer, payments (view proof, verify, reject), timeline, audit trail, earlier revisions.
- Status flow: after payment verification → Confirmed → Processing → Packed → **Dispatched** (courier + tracking shown to the customer) → Completed. Forward only.
- **Reopen order** (locked orders, before dispatch): requires a reason; unlocks the order so the customer can edit; logged in the audit log.
- **Cancel order** (before dispatch): requires a reason; releases stock. Refunds are handled outside the website.

## Payments
Default view shows *Submitted* payments. For each: open the proof, match the **UTR and amount** with your bank/UPI statement, then **Verify** or **Reject** (reason is shown to the customer, who can re-submit). A WhatsApp message from the customer is **not** a verification.

## Existing customers (no minimum order, loose pieces)
- **Excel template:** *Existing Customers → Bulk add → Download the template* — fill it, then copy-paste the table (with header) or upload the CSV. Step-by-step: [EXISTING_CUSTOMERS_IMPORT.md](EXISTING_CUSTOMERS_IMPORT.md).
- *Admin → Existing Customers* → **Add customer** or **Bulk add** (paste one per line: `mobile, name, business, city` — straight from Excel). Or type rows directly in the `Existing_Customers` Google Sheet (column A = mobile).
- From *Customers*, open a customer → **Mark as existing customer**.
- **Automatic:** a new customer becomes an existing customer when you verify their first payment (setting *After the first paid order*).
- The customer clicks **“Existing customer?”** (header / top bar / homepage / product page / cart), enters their mobile and the **WhatsApp OTP**. Their phone is remembered for 90 days.
- Numbers not in the list never receive an OTP (no cost) — they are shown a “ask Nutex to add my number” WhatsApp button.
- The exemption only applies when the order is placed with the **same verified mobile number**; the server re-checks the list for every order.
- Settings → Pricing & orders: minimum for existing customers (default ₹0), OTP on/off, OTP message text. A per-customer minimum can be set on each row.
- **Deactivate** a number to make the standard minimum apply again. Orders show an “Existing” badge and can be filtered by customer type.
- **Alternate numbers:** each existing customer can have up to 5 extra WhatsApp numbers (column `alternate_mobiles`, comma separated, or the “Alternate numbers” field). Any of them can be used to log in and to place the order.
  - At checkout every customer can give an **Alternate mobile** — it is saved on the customer and copied when you “Mark as existing customer”.
  - A verified customer can add another number themselves: *Existing customer → Add another WhatsApp number* → OTP goes to the new number → linked.
  - A number can belong to only one customer; clashes are refused.

## Payment QR
- *Payments → Update payment QR*, *Dashboard*, or *Settings → Payment*: **Upload payment QR** → check the preview (scan it with your own UPI app) → **Make this QR live**. It is live immediately — no separate Save.
- The file is stored exactly as uploaded (no compression) in Drive/PAYMENT. Old QR files stay in Drive; each change is in the audit log.
- Until a real QR is uploaded, customers see a **DEMO QR** with a red “DEMO QR — do not pay” label. It is a real QR image but contains only text, so no UPI app can pay with it. **Remove QR (show demo)** switches back to the demo.

## Customers
Created automatically at checkout (matched by mobile). Click a customer to see their orders. Updating a customer never changes past orders.

## Audit log
Every product, price, discount, slab, inventory, setting, payment and order action with old/new values, admin, IP and reason. Exportable as CSV.

## Backups
Settings → System & backup → download CSV of any sheet. Also use Google Sheets *Version history* and *File → Make a copy* weekly (see `google-sheets/migration.md`).

---

# X. Customer user flow

1. **Home** → browse categories, featured products, see minimum order and discount information.
2. **Category / Shop** → filter by size, colour, stock; sort.
3. **Product** → pick a colour, enter quantity for each size (or number of mix-colour boxes) → *Add to cart*. Unavailable combinations are disabled.
4. **Cart** (drawer + page, sticky bar on mobile) → change qty/size/colour/box, see MRP total, discount %, discount amount, final wholesale total, slab progress, minimum-order progress and exactly how much more is needed. Checkout is disabled until the minimum is met.
5. **Checkout** → business, contact, address, GSTIN (optional), notes; review lines → *Place order*. The server re-checks prices and stock (“Stock has changed. Please review your cart.” if needed) and creates order **NX-YYYYMMDD-NNNN**.
6. **Payment page** → scan the company QR, pay the shown amount, submit UTR + screenshot. The order is now **locked**.
7. **Confirm on WhatsApp** (pre-filled message) – optional; the Nutex team still verifies.
8. **Order page / Track order** (order number + mobile) → status timeline: Payment submitted → verified → confirmed → processing → packed → dispatched (courier & tracking) → completed.
9. Before paying, the customer can **Edit order** (add/remove products, change sizes/colours/quantities); every change is re-priced and re-validated by the server.
