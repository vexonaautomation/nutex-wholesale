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
];
