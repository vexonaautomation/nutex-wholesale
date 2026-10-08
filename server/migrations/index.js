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
];
