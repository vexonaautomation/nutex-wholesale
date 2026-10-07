# Schema migrations, backup & recovery

## Principle

**Application code is replaceable. Business data is not.**
A deployment may only *add* structure. It may never remove, clear, reorder,
re-ID or overwrite business data.

## What runs on every server start (production included)

`server/services/migrationService.js`:

1. Reads spreadsheet metadata.
2. **Creates only missing sheets** (with header row, frozen).
3. **Adds only missing columns**, appended after the last existing header.
4. **Adds only missing Settings keys** with their default value.
5. Runs registered migrations (`server/migrations/index.js`) whose version is not
   yet recorded in `Schema_Version`, then records them.

It never: deletes rows/sheets/columns, clears ranges, rewrites headers that
exist, regenerates IDs, overwrites values, or seeds demo data.

A sheet that has data but **no header row** is reported as an error and left
untouched (the app will not guess).

### Enforced in code, not just by convention
- `server/services/storage/sheetsGuard.js` rejects every Sheets batch request
  except `addSheet`, `updateCells`, `appendCells`, `appendDimension(COLUMNS)`.
  `deleteSheet`, `deleteDimension`, `deleteRange`, `values.clear` … cannot be sent.
- `sheetsService.commit()` has no delete capability; updates touch only the
  listed cells of the row whose immutable ID matches; the ID column can never be modified.
- The Drive layer can only create files/folders (no delete/trash/overwrite).
- `npm run check:data-safety` (also part of `npm test`) statically scans the
  server code for destructive calls and for demo seeding in startup files.
- Tests (`server/tests/dataSafety.test.js`, `orderFlow.test.js`) simulate
  redeploys on populated data and assert the spreadsheet is byte-for-byte unchanged.

## How to evolve the schema (developer guide)

1. Add the new column **at the end** of the sheet's `columns` array in
   `server/config/schema.js` (and to `types` if numeric/boolean).
2. Bump `SCHEMA_VERSION` (e.g. 1 → 2).
3. Add `{ version: 2, description: '…' }` to `server/migrations/index.js`.
   Optional `up()` may **fill blank values of the new column only** — never
   touch existing values.
4. Code that reads the new column must handle blank values for old rows.
5. `npm test`, deploy. On start the column is appended; existing rows untouched.

Never rename or remove a column in code. To retire a field, stop using it; the
column stays in the sheet with its historical data.

## Backups

| What | How | When |
|---|---|---|
| Google Sheet | Built-in **Version history** (File → Version history) | automatic |
| Google Sheet | **File → Make a copy** into a `BACKUPS` Drive folder, named with the date | weekly + before big changes |
| Google Sheet | **File → Download → Microsoft Excel (.xlsx)** to an offline disk | monthly |
| Per-sheet CSV | Admin → Settings → System & backup → download CSV per sheet (read-only, audited) | any time |
| Google Drive files | Drive keeps files until deleted; the app never deletes. Use **Google Takeout** or download the `NUTEX WHOLESALE` folder | monthly |
| Google Workspace | Optional: Workspace backup/retention (Vault) policies | — |

## Recovery (restore) procedure

Restores are **manual and deliberate**. The app never auto-restores or
overwrites production data.

1. Put the store in maintenance by informing staff (do not edit the sheet during restore).
2. **Never overwrite** the live sheet. Instead:
   - Restore from *Version history* → “Restore this version” creates a new
     version (the current one stays in history), **or**
   - Copy only the specific missing rows from a backup copy and **append**
     them to the live sheet, keeping their original IDs.
3. Do not create rows with duplicate IDs. If a row exists in both, keep the newer.
4. Inventory: after restoring Orders/Inventory rows, review *Admin → Inventory*
   (reserved quantities belong to unpaid orders).
5. Restart the Render service (optional) — migration only adds what is missing.
6. Verify in *Admin → Dashboard* and *Audit Log*.

## Schema versions
| Version | Change (additive) |
|---|---|
| 1 | Initial schema |
| 2 | Existing_Customers sheet, Orders.customer_type_snapshot, existing-customer settings |
| 3 | Existing_Customers.alternate_mobiles, Customers.alternate_mobile, Orders.alternate_mobile_snapshot |
| 4 | Product_Variants.variant_mrp (size-wise MRP), setting size_chart_file_id |
| 5 | Products.sell_mode + Products.units_per_box (box / loose pieces), settings pcs_for_existing_customers_only and auto_existing_after_first_order |
| 6 | Products.pcs_for_new_customers (loose pieces for new customers per article) |

## Bulk import

`server/services/catalogImportService.js` imports `catalog-import/catalog.json`
(Admin → Catalogue Import or `npm run import:catalog`). It only appends new
rows (matched by SKU / name / slug), fills blank category images and blank
logo / size-chart settings, and never updates or replaces existing products.
Any future importer must follow the same rule: **additive/upsert**, never
"replace all", so an accidental import can never delete existing products.
