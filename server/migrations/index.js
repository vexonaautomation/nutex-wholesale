// Schema migration registry.
//
// The declarative schema (config/schema.js) is reconciled additively on
// every start. Entries here record schema versions and may run extra
// ADDITIVE steps. A migration's `up()` must NEVER delete rows, clear sheets,
// replace data, regenerate IDs or overwrite business values.
//
// Example for a future v2 (after adding a column at the END of a sheet's
// column list in config/schema.js and setting SCHEMA_VERSION = 2):
//
//   {
//     version: 2,
//     description: 'Add hsn_code column to Products',
//     // optional: fill a NEW column for rows where it is still blank
//     async up({ sheets }) {
//       const rows = await sheets.read('Products', { fresh: true });
//       const ops = rows.filter((r) => !r.hsn_code)
//         .map((r) => ({ op: 'update', sheet: 'Products', id: r.product_id, patch: { hsn_code: '6212' } }));
//       if (ops.length) await sheets.commit(ops);
//     },
//   },

export const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial Nutex wholesale schema (16 sheets + Order_Status_History)',
  },
  {
    // Additive only: new Existing_Customers sheet, Orders.customer_type_snapshot
    // column and the existing_customer_minimum_order_value setting are created
    // by the declarative schema/settings reconciliation. Old orders keep a
    // blank customer_type_snapshot (treated as NEW).
    version: 2,
    description: 'Existing customers list (minimum order exemption)',
  },
  {
    // Additive only: Existing_Customers.alternate_mobiles, Customers.alternate_mobile,
    // Orders.alternate_mobile_snapshot. Old rows keep these blank.
    version: 3,
    description: 'Alternate mobile numbers for customers',
  },
  {
    // Additive only: Product_Variants.variant_mrp (size-wise MRP) and the
    // size_chart_file_id setting. Old variants keep variant_mrp blank, which
    // means "use the product MRP" - prices of existing products do not change.
    version: 4,
    description: 'Size-wise MRP and size chart',
  },
  {
    // Additive only: Products.sell_mode + Products.units_per_box and the
    // pcs_for_existing_customers_only / auto_existing_after_first_order
    // settings. Old products keep sell_mode blank = derived from their
    // inventory_mode (COLOR_WISE -> PCS, BOX_WISE -> BOX), so nothing changes
    // for them until an admin edits the product.
    version: 5,
    description: 'Box / pieces selling per product',
  },
  {
    // Additive only: Products.pcs_for_new_customers. Blank = FALSE: new
    // customers buy full boxes; existing customers always choose box or pieces.
    version: 6,
    description: 'Loose pieces for new customers per product',
  },
  {
    // Additive only: Order_Items.stock_components. Old order lines keep it
    // blank = they used their own variant's stock, exactly as before.
    version: 7,
    description: 'Boxes packed from loose colour stock',
  },
  {
    // Additive only: Orders.payment_mode_snapshot + online_payment_enabled
    // setting (default ON). Older orders keep it blank = ONLINE, unchanged.
    version: 8,
    description: 'Online payment on/off (thank-you page, team confirms orders)',
  },
  {
    // Additive only: Orders.packing_deduction. Older orders keep it blank = 0.
    version: 9,
    description: 'Less: packing charges (admin deduction per order)',
  },
  {
    // Additive only: Products.box_extra_color. Blank = the extra pieces of a
    // mix box are Black when the product has Black, else the most stock.
    version: 10,
    description: 'Mix box extra colour per product (default Black)',
  },
  {
    // Additive only: Orders.placed_by_mobile + admin_order_mobiles setting
    // (blank = no admin numbers). Older orders keep it blank.
    version: 11,
    description: 'Admin numbers order for customers (bill shows the customer number)',
  },
  {
    // Additive only: Categories.packing_charge, Orders.less_packing and the
    // packing_choice_enabled + gst_percent settings. Older rows stay blank
    // (= automatic rate / customer did not choose).
    version: 12,
    description: 'Customer can choose to less packing charges; prices include GST',
  },
  {
    // Additive only: Existing_Customers.address / state / pincode (blank for
    // older rows) - bulk upload with address, admin-number checkout fills them.
    version: 13,
    description: 'Existing customers: address, state, pincode',
  },
  {
    // Additive only: Products.collections (blank for every existing article).
    version: 14,
    description: 'Product collections (Online Collection page)',
  },
  {
    // Additive only: fills the blank Products.collections cell of every
    // article printed in the ONLINE COLLECTION catalogue (catalog-import/
    // catalog.json, matched by SKU) so the /online page is ready right after
    // the deploy. Runs once and never overwrites a filled cell - an admin can
    // still take an article off the Online page later.
    version: 15,
    description: 'Online Collection: show the catalogue articles',
    async up({ sheets, logger }) {
      const { loadCatalogFile } = await import('../services/catalogImportService.js');
      let catalog;
      try {
        ({ catalog } = await loadCatalogFile());
      } catch (err) {
        logger.warn(`Migration v15: catalogue not readable, no article tagged (${err.message})`);
        return;
      }
      const online = new Set(catalog.products.filter((p) => p.collections.includes('online')).map((p) => p.sku));
      const rows = await sheets.read('Products', { fresh: true });
      const ops = rows
        .filter((r) => !String(r.collections || '').trim() && online.has(String(r.sku || '').trim().toUpperCase()))
        .map((r) => ({ op: 'update', sheet: 'Products', id: r.product_id, patch: { collections: 'online' } }));
      if (ops.length) await sheets.commit(ops);
      logger.info(`Migration v15: ${ops.length} articles added to the Online Collection`);
    },
  },
  {
    // "Sell in" Box / Pcs per article (Products.sell_mode BOX = box only is
    // now offered in the admin). The owner asked for Sanjana Set (1007) and
    // the Sanjana bra (1005) to be sold in loose pieces only: done once here,
    // with the same safe bulk action the admin uses (box variants are set
    // inactive, never deleted; pieces stock untouched). Only while they are
    // still "Box + Pcs"; the admin can tick Box again any time.
    version: 16,
    description: 'Sell in Box / Pcs per article; Sanjana Set + Sanjana bra pcs only',
    async up({ sheets, logger }) {
      const { bulkSetSelling } = await import('../services/productService.js');
      const rows = await sheets.read('Products', { fresh: true });
      const ids = rows
        .filter((r) => ['1007', '1005'].includes(String(r.sku || '').trim()) && /sanjana/i.test(String(r.product_name || ''))
          && String(r.sell_mode || '').toUpperCase() === 'BOTH')
        .map((r) => r.product_id);
      if (!ids.length) return;
      const res = await bulkSetSelling({ product_ids: ids, sell_mode: 'PCS', units_per_box: null, via: 'owner request: pcs only' }, { admin: { admin_id: 'SYSTEM' }, ip: '' });
      logger.info(`Migration v16: pcs only for ${res.updated.join(', ') || 'none'}${res.skipped.length ? ` (skipped: ${res.skipped.map((s) => s.reason).join('; ')})` : ''}`);
    },
  },
  {
    // Additive only: Admin_Users.mobile + Admin_Users.permissions (blank for
    // existing admins = unchanged, full access). New role SUB_ADMIN.
    version: 17,
    description: 'Sub admins: mobile number + permissions',
  },
  {
    // Additive only: Orders.aadhaar_last4 (blank for older orders). The bill
    // shows business + customer name, full address, GSTIN or Aadhaar, Made by.
    version: 18,
    description: 'Bill: party details, Aadhaar (last 4 digits) when no GST, made by',
  },
  {
    // The owner's size-wise MRP rule, applied once to every article (bras
    // 42-44 +6 - not sets; panties 40 +12, 42-44 +24, 46 +36; vests XL-XXL +16;
    // underwear XL-2XL +20, 3XL-4XL +40). Only Product_Variants.variant_mrp of
    // those sizes is written; articles that already have their own size-wise
    // MRP are left as they are. Box prices follow automatically.
    version: 19,
    description: 'Size-wise MRP rule for bras, panties, vests and underwear (not sets)',
    async up({ logger }) {
      const { applySizeMrpRules } = await import('../services/sizeMrpRuleService.js');
      const res = await applySizeMrpRules({}, { admin: { admin_id: 'SYSTEM' }, ip: '' });
      logger.info(`Migration v19: size-wise MRP set for ${res.updated.length} article(s); skipped ${res.skipped.length} (${res.skipped.map((s) => s.sku).join(', ')})`);
    },
  },
  {
    // Additive only: new Packers sheet; Orders.packer_id / packer_name /
    // packing_assigned_at / packing_slip_sent_at (blank for older orders).
    version: 20,
    description: 'Packing team: packer per order + packing slip (no amounts) on WhatsApp',
  },
  {
    // The owner's decision: verified existing customers have a minimum order
    // of Rs 1,000 (was 0 = no minimum). Set once on deploy; the owner changes
    // it any time in Settings or on the Existing Customers page. A customer's
    // own minimum in the Existing_Customers sheet still wins.
    version: 21,
    description: 'Minimum order for existing customers: Rs 1,000',
    async up({ logger }) {
      const { updateSettings } = await import('../services/settingsService.js');
      await updateSettings({ existing_customer_minimum_order_value: 1000 }, { admin: { admin_id: 'SYSTEM' }, ip: '' });
      logger.info('Migration v21: minimum order for existing customers set to 1000');
    },
  },
  {
    // Dates in the sheet become real date-times (21/10/2026 15:45:08) instead
    // of ISO text, and order numbers become digits only (202610150001 instead
    // of NX-20261015-0001). Only those cells are rewritten - same value, new
    // form. Old order numbers keep working when a customer types them.
    version: 22,
    description: 'Real date-time cells in the sheet; order numbers digits only',
    async up({ sheets, logger }) {
      const changed = await sheets.upgradeLegacyCells();
      logger.info('Migration v22: dates / order numbers converted', changed);
    },
  },
  {
    // New Orders columns BD..BG for the team. Filled for every order already
    // in the sheet (only blank cells): doer (Ramesh existing / Mayank
    // inbound), bill link, packing person (= packer chosen before), customer type.
    version: 23,
    description: 'Orders: doer, bill link, packing person, customer type',
    // baseUrl: the site address for the links (default FRONTEND_URL / Render's own URL)
    async up({ sheets, logger, baseUrl }) {
      const { orderSheetColumns } = await import('../services/orderSheetColumns.js');
      const { getSettings } = await import('../services/settingsService.js');
      const settings = await getSettings({ fresh: true });
      const data = await sheets.readMany(['Orders', 'Existing_Customers'], { fresh: true });
      const ops = [];
      for (const o of data.Orders) {
        const cols = orderSheetColumns(o, { existingRows: data.Existing_Customers, settings, baseUrl });
        const patch = {};
        for (const [k, v] of Object.entries(cols)) if (!o[k] && v) patch[k] = v;
        if (!o.packing_person && o.packer_name) patch.packing_person = o.packer_name;
        if (Object.keys(patch).length) ops.push({ op: 'update', sheet: 'Orders', id: o.order_id, patch });
      }
      for (let i = 0; i < ops.length; i += 200) await sheets.commit(ops.slice(i, i + 200));
      logger.info(`Migration v23: ${ops.length} order(s) filled (doer, bill link, packing person, customer type)`);
    },
  },
  {
    // The new Cancelled_Orders sheet is created by the schema. Orders already
    // cancelled move there now (the whole row, in one atomic step each batch);
    // from now on every order that gets cancelled moves there by itself.
    version: 24,
    description: 'Cancelled orders move to the Cancelled_Orders sheet',
    async up({ sheets, logger }) {
      const orders = await sheets.read('Orders', { fresh: true });
      const ids = orders.filter((o) => o._sheet === 'Orders' && o.order_status === 'CANCELLED').map((o) => o.order_id);
      for (let i = 0; i < ids.length; i += 25) {
        await sheets.commit(ids.slice(i, i + 25).map((id) => ({ op: 'update', sheet: 'Orders', id, patch: { order_status: 'CANCELLED' } })));
      }
      logger.info(`Migration v24: ${ids.length} cancelled order(s) moved to Cancelled_Orders`);
    },
  },
  {
    // New sheet Order_Items_Summary (created by the schema): the active items
    // of live orders in pieces like the IMS, with bill number and party.
    // Filled now for every order already in the sheets (rows not there yet only).
    version: 25,
    description: 'Order_Items_Summary: items in pieces with bill number and party',
    async up({ sheets, logger }) {
      const { summaryRow, SUMMARY_SHEET } = await import('../services/itemSummaryService.js');
      const data = await sheets.readMany(['Orders', 'Order_Items', SUMMARY_SHEET], { fresh: true });
      const orders = new Map(data.Orders.map((o) => [o.order_id, o]));
      const have = new Set(data[SUMMARY_SHEET].map((r) => r.order_item_id));
      const rows = [];
      for (const item of data.Order_Items) {
        const order = orders.get(item.order_id);
        if (!order || have.has(item.order_item_id)) continue;
        if ((item.status || 'ACTIVE') !== 'ACTIVE' || order.order_status === 'CANCELLED') continue;
        rows.push(summaryRow(order, item));
      }
      for (let i = 0; i < rows.length; i += 500) await sheets.commit([{ op: 'append', sheet: SUMMARY_SHEET, rows: rows.slice(i, i + 500) }]);
      logger.info(`Migration v25: ${rows.length} order item(s) written to ${SUMMARY_SHEET}`);
    },
  },
  {
    // Order_Items_Summary only for HANDED OVER orders, with the new
    // handover_date column: rows of orders not handed over yet are taken out
    // (they come back when the order is handed over); handed-over orders get
    // their rows and handover date. Order_Items is not touched.
    version: 26,
    description: 'Order_Items_Summary: only handed-over orders, with handover date',
    async up({ sheets, logger }) {
      const { summaryRow, SUMMARY_SHEET } = await import('../services/itemSummaryService.js');
      const data = await sheets.readMany(['Orders', 'Order_Items', SUMMARY_SHEET], { fresh: true });
      const orders = new Map(data.Orders.map((o) => [o.order_id, o]));
      const handedOver = (o) => o && o.order_status === 'COMPLETED';
      const ops = [];
      const have = new Set();
      for (const r of data[SUMMARY_SHEET]) {
        const o = orders.get(r.order_id);
        if (!handedOver(o)) ops.push({ op: 'remove', sheet: SUMMARY_SHEET, id: r.order_item_id, optional: true });
        else {
          have.add(r.order_item_id);
          if (!r.handover_date && o.completed_at) ops.push({ op: 'update', sheet: SUMMARY_SHEET, id: r.order_item_id, patch: { handover_date: o.completed_at } });
        }
      }
      const rows = data.Order_Items
        .filter((i) => (i.status || 'ACTIVE') === 'ACTIVE' && handedOver(orders.get(i.order_id)) && !have.has(i.order_item_id))
        .map((i) => summaryRow(orders.get(i.order_id), i));
      for (let i = 0; i < ops.length; i += 200) await sheets.commit(ops.slice(i, i + 200));
      for (let i = 0; i < rows.length; i += 500) await sheets.commit([{ op: 'append', sheet: SUMMARY_SHEET, rows: rows.slice(i, i + 500) }]);
      logger.info(`Migration v26: ${ops.length} summary change(s), ${rows.length} row(s) added for handed-over orders`);
    },
  },
  {
    // New sheet GBNutex (sales register) and Products.cost_price, both made by
    // the schema. Orders handed over before v27 are written now (once).
    version: 27,
    description: 'GBNutex sales register for handed-over orders; Products.cost_price',
    async up({ sheets, logger }) {
      const { gbNutexRows, GB_SHEET } = await import('../services/gbNutexService.js');
      const data = await sheets.readMany(['Orders', 'Order_Items', 'Products', 'Categories', GB_SHEET], { fresh: true });
      const done = new Set(data[GB_SHEET].map((r) => String(r.BILL)));
      const ctx = {
        products: new Map(data.Products.map((p) => [p.product_id, p])),
        categories: new Map(data.Categories.map((x) => [x.category_id, x])),
      };
      const rows = data.Orders
        .filter((o) => o.order_status === 'COMPLETED' && !done.has(String(o.order_number)))
        .sort((a, b) => (a.completed_at > b.completed_at ? 1 : -1))
        .flatMap((o) => gbNutexRows(o, data.Order_Items.filter((i) => i.order_id === o.order_id && (i.status || 'ACTIVE') === 'ACTIVE'), ctx));
      for (let i = 0; i < rows.length; i += 500) await sheets.commit([{ op: 'append', sheet: GB_SHEET, rows: rows.slice(i, i + 500) }]);
      logger.info(`Migration v27: ${rows.length} GBNutex row(s) for handed-over orders`);
    },
  },
  {
    // GBNutex MODE from the order: packing charges taken off = Online, sent
    // with the boxes = Offline. Only blank MODE cells are filled.
    version: 28,
    description: 'GBNutex: MODE Online (less packing) / Offline (with boxes)',
    async up({ sheets, logger }) {
      const { gbMode, GB_SHEET } = await import('../services/gbNutexService.js');
      const orders = await sheets.read('Orders', { fresh: true });
      const byBill = new Map(orders.map((o) => [String(o.order_number), o]));
      const filled = await sheets.fillBlanks(GB_SHEET, 'MODE', (r) => {
        const o = byBill.get(String(r.BILL));
        return o ? gbMode(o) : '';
      });
      logger.info(`Migration v28: MODE filled on ${filled} GBNutex row(s)`);
    },
  },
];
