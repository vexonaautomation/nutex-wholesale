# Google Sheets Database Schema (schema v1)

The spreadsheet is the **primary, permanent business database**. The single
source of the schema in code is [`server/config/schema.js`](../server/config/schema.js).

Rules that make the data redeploy-safe:

- **Row 1 = header row.** The app maps every row **by header name**, never by
  column position or row number. You may reorder columns or add your own extra
  columns (e.g. `my_notes`) — the app preserves them.
- **Column A = immutable stable ID** (`PRD-…`, `ORD-…`). Never edit, reuse or
  duplicate an ID. If two rows share an ID the app refuses to write to them.
- **Never delete rows.** Records are deactivated / archived / cancelled instead.
- Values are written as literal values (`stringValue` / `numberValue`), so text
  like `=SUM(...)` typed by a customer is stored as text, never as a formula.
- Booleans are `TRUE`/`FALSE`; dates are ISO-8601 (`2026-10-03T07:30:00.000Z`);
  slab dates are `YYYY-MM-DD` (India time).
- Lists (product `size_ids`, `color_ids`) are comma-separated IDs.

Order of sheets does not matter. Missing sheets/columns are created by the
additive migration on every server start.

---

## 1. Settings
Key/value configuration. One row per key. Missing keys are added with defaults; existing values are never overwritten.

| Column | Description |
|---|---|
| setting_key | Unique key (ID) |
| setting_value | Value (text/number) |
| data_type | string, text, number, enum, phone |
| description | What the setting does |
| updated_at / updated_by | Last change (admin ID or `SYSTEM_DEFAULT`) |

v4 key: `size_chart_file_id` (bra size chart image on product pages).

v5 keys: `pcs_for_existing_customers_only` (TRUE = new customers buy boxes; loose pieces only on articles with pcs_for_new_customers. FALSE = loose pieces for everyone), `auto_existing_after_first_order` (TRUE = first verified payment adds the customer to Existing_Customers).

v2 keys: `existing_customer_minimum_order_value` (0 = no minimum), `existing_customer_otp_enabled` (TRUE), `otp_message_template`.

Keys: `company_name, company_tagline, company_logo_file_id, company_phone, company_email, company_address, company_gstin, whatsapp_number, business_hours, jurisdiction_city, support_message, announcement_text, hero_title, hero_subtitle, minimum_order_value (10000), discount_mode (FIXED|SLAB), default_discount_percent (60), discount_slab_basis (MRP_SUBTOTAL|PRE_DISCOUNT_WHOLESALE_SUBTOTAL|FINAL_PAYABLE), price_display_mode (SHOW_MRP|SHOW_WHOLESALE|SHOW_BOTH), currency, order_prefix (NX), low_stock_threshold, reservation_expiry_hours (72), payment_qr_file_id, upi_id, payment_name, payment_instructions, payment_whatsapp_number, legal_privacy_policy, legal_terms, legal_wholesale_terms, legal_shipping_policy, legal_cancellation_policy, legal_refund_policy`.

## 2. Categories
| Column | Description |
|---|---|
| category_id | `CAT-…` |
| category_name | Display name (unique) |
| parent_category | Menu group, e.g. `WOMEN`, `PANTIES`, `MEN` |
| slug | URL `/category/<slug>` (unique) |
| description | Shown on category page |
| image_file_id / image_url | Google Drive file ID / view link |
| status | `ACTIVE` · `INACTIVE` · `ARCHIVED` |
| sort_order | Lower first |
| seo_title / seo_description | Optional SEO overrides |
| created_at / updated_at | Timestamps |

## 3. Colors
`color_id, color_name, color_code (used in variant SKUs), hex_code, swatch_image (Drive file ID), status, sort_order, created_at, updated_at`

## 4. Sizes
`size_id, size_name, sort_order, status, created_at, updated_at`

## 5. Products
| Column | Description |
|---|---|
| product_id | `PRD-…` |
| sku | Unique product SKU |
| product_name, slug, category_id, subcategory, description | Catalogue data |
| mrp | MRP per piece |
| discount_mode | `GLOBAL` (fixed/slab from settings) or `CUSTOM` (product-specific) |
| fixed_discount_percent | Used only when `discount_mode = CUSTOM` |
| inventory_mode | `COLOR_WISE` or `BOX_WISE` (kept for older rows; see sell_mode) |
| size_ids / color_ids | Assigned sizes / colours (comma-separated IDs) |
| status | `ACTIVE` · `INACTIVE` · `ARCHIVED` |
| out_of_stock | `TRUE` = whole product out of stock |
| featured, sort_order, seo_title, seo_description | Merchandising |
| created_at, updated_at, created_by, updated_by | Audit columns |
| sell_mode *(v5)* | What exists: `PCS` (loose pieces), `BOX` (boxes) or `BOTH` — set automatically. Blank = from inventory_mode |
| units_per_box *(v5)* | Pieces in one box (one box per size, assorted colours); blank = no box |
| pcs_for_new_customers *(v6)* | `TRUE` = new customers may also buy loose pieces of this article. Existing customers always can |

Box price is **calculated**: units_per_box × piece MRP of that size (Product_Variants.variant_mrp or mrp). A box variant is a Product_Variants row with inventory_mode `BOX_WISE`, the size, units_per_box and blank colour.

The current wholesale price is **not stored** — it is derived from MRP + discount settings.

## 6. Product_Images
`image_id, product_id, drive_file_id, file_url, image_type (MAIN|GALLERY|THUMBNAIL), alt_text, sort_order, status (ACTIVE|INACTIVE), created_at, updated_at`

## 7. Product_Variants
One row per sellable variant.

| Column | COLOR_WISE | BOX_WISE |
|---|---|---|
| variant_id | `VAR-…` | `VAR-…` |
| product_id | ✓ | ✓ |
| sku | `<SKU>-<COLORCODE>-<SIZE>` | box SKU |
| size_id | ✓ | optional |
| color_id | ✓ | blank |
| box_id | blank | `BOX-…` |
| inventory_mode | COLOR_WISE | BOX_WISE |
| units_per_box | – | pieces per box |
| box_mrp | – | MRP per box (blank = units × MRP) |
| mixed_color_description | – | e.g. "Assorted colours" |
| status | `ACTIVE` / `INACTIVE` (removed variants become INACTIVE, never deleted) | |
| variant_mrp *(v4)* | size-wise MRP for this size (blank = product MRP) | – |

## 8. Inventory
One row per variant.

| Column | Description |
|---|---|
| inventory_id, variant_id, product_id, color_id, size_id, box_id | Keys |
| stock_qty | Physical units (pieces, or boxes for box-wise) |
| reserved_qty | Held by unpaid (PAYMENT_PENDING) orders |
| available_qty | `stock_qty − reserved_qty` (kept in sync by the app) |
| status | `ACTIVE` or `OUT_OF_STOCK` (manual flag for this variant) |
| updated_at, updated_by | Last change |

Stock can never go negative and cannot be set below `reserved_qty`.

## 9. Discount_Slabs
`slab_id, label, min_amount, max_amount (blank = and above), discount_percent, priority (1 = highest), active, start_date, end_date, deleted, created_at, updated_at`

Ranges are whole rupees and inclusive: `0–4999` means `0 ≤ x < 5000`. Active slabs may not overlap in amount while their date windows overlap.

## 9b. Existing_Customers (schema v2)
List maintained by Nutex — through *Admin → Existing Customers* or typed straight into this sheet.
Numbers in this list (status blank or `ACTIVE`) can verify with a WhatsApp OTP and then order **without the standard minimum**.

| Column | Description |
|---|---|
| mobile | **Column A.** Customer's WhatsApp mobile. Any format works: `9876543210`, `+91 98765 43210`, `098765…` |
| customer_name, business_name, city, gstin | Optional, for your reference (never shown to the public) |
| minimum_order_value | Optional per-customer minimum. Blank = setting `existing_customer_minimum_order_value` (default 0 = no minimum) |
| status | blank / `ACTIVE` = allowed · `INACTIVE` = standard minimum applies again |
| notes, added_at, updated_at, added_by | Housekeeping |

| alternate_mobiles *(v3)* | Other WhatsApp numbers of the same customer, comma separated (max 5). Any of them can log in |

Keep one row per customer, and each number in only one row. Sheet edits are picked up by the website within ~1 minute.

v3 also adds `Customers.alternate_mobile` and `Orders.alternate_mobile_snapshot` (optional second number given at checkout).

## 10. Customers
`customer_id, customer_name, business_name, mobile (10 digits, unique key), whatsapp, email, billing_address, shipping_address, city, state, pincode, gstin, created_at, updated_at`

## 11. Orders
| Group | Columns |
|---|---|
| IDs | `order_id` (internal, `ORD-…`), `order_number` (customer-facing `NX-YYYYMMDD-NNNN`), `customer_id` |
| Customer snapshot | `customer_name_snapshot, business_name_snapshot, mobile_snapshot, whatsapp_snapshot, email_snapshot, billing_address_snapshot, shipping_address_snapshot, city_snapshot, state_snapshot, pincode_snapshot, gstin_snapshot, order_notes` |
| Pricing snapshot | `mrp_subtotal, discount_mode_snapshot, discount_basis_snapshot, discount_basis_amount, discount_percent, slab_id_snapshot, discount_amount, final_payable, total_qty, minimum_order_value_snapshot, minimum_order_met` |
| State | `order_status, payment_status, locked, stock_state (RESERVED/DEDUCTED/RELEASED), revision, idempotency_key` |
| Fulfilment | `courier_name, tracking_number, dispatch_note, cancel_reason` |
| Timestamps | `created_at, updated_at, locked_at, payment_submitted_at, verified_at, dispatched_at, completed_at, cancelled_at` |
| v2 | `customer_type_snapshot` — `EXISTING` (verified existing customer) or `NEW`; blank on older orders = NEW |

## 12. Order_Items
Frozen snapshot of every line — **never recalculated from current product data**.

`order_item_id, order_id, order_number, revision, product_id, variant_id, sku_snapshot, product_name_snapshot, category_snapshot, inventory_mode_snapshot, size_snapshot, color_snapshot, box_snapshot, units_per_box_snapshot, qty, mrp_unit_snapshot, discount_percent_snapshot, wholesale_unit_snapshot, line_mrp_total, line_total, status (ACTIVE|REPLACED), created_at`

When a customer edits an unpaid order, previous lines are marked `REPLACED` and new lines are appended with `revision + 1` (full history kept).

## 13. Payments
`payment_id, order_id, order_number, amount, expected_amount, payment_method (UPI_QR), utr, proof_file_id, proof_url, status (SUBMITTED|VERIFIED|REJECTED), idempotency_key, customer_note, submitted_at, verified_at, verified_by, remarks`

## 14. Order_Status_History (supporting sheet)
`history_id, order_id, order_number, from_status, to_status, actor_type (CUSTOMER|ADMIN|SYSTEM), actor_id, note, created_at` — powers the customer timeline.

## 15. Admin_Users
`admin_id, email, name, password_hash (bcrypt), role (OWNER|ADMIN|STAFF), status, session_version, last_login_at, created_at, updated_at`

Bumping `session_version` signs that admin out everywhere.

## 16. Audit_Log
`audit_id, timestamp, admin_id, actor_type, action, entity_type, entity_id, old_value (JSON), new_value (JSON), reason, notes, ip` — append-only.

Actions include: PRODUCT_CREATED/UPDATED/DUPLICATED/DEACTIVATED/ARCHIVED/REACTIVATED, PRODUCT_OUT_OF_STOCK, PRODUCT_STOCK_RESTORED, CATEGORY_*, COLOR_*, SIZE_*, INVENTORY_UPDATED, PRICE_UPDATED, DISCOUNT_UPDATED, SLAB_CREATED/UPDATED/DEACTIVATED/REACTIVATED/DELETED, ORDER_CREATED, ORDER_UPDATED_BY_CUSTOMER, ORDER_STATUS_UPDATED, ORDER_REOPENED, ORDER_CANCELLED, ORDER_AUTO_CANCELLED, PAYMENT_SUBMITTED/VERIFIED/REJECTED, SETTINGS_UPDATED, MASTER_DATA_INITIALIZED, ADMIN_LOGIN, ADMIN_CREATED, ADMIN_UPDATED, ADMIN_PASSWORD_CHANGED, DATA_EXPORTED.

## 17. Schema_Version
`version, applied_at, description, app_version` — one row per applied schema migration.
