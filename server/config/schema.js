// =====================================================================
// GOOGLE SHEETS SCHEMA - the single declaration of the business database.
//
// RULES (enforced by sheetsService + migrationService):
//  * Sheets/columns are only ever ADDED. Nothing here causes deletion.
//  * Column order in the live sheet does not matter - rows are mapped by
//    header name, so an admin may reorder or append their own columns.
//  * The first column of every sheet is its immutable stable ID.
//  * To evolve the schema: add the new column at the END of the list,
//    bump SCHEMA_VERSION and add an entry to server/migrations/index.js.
// =====================================================================

export const SCHEMA_VERSION = 9;

const n = 'number';
const b = 'boolean';

export const SCHEMA = {
  Settings: {
    idField: 'setting_key',
    columns: ['setting_key', 'setting_value', 'data_type', 'description', 'updated_at', 'updated_by'],
    types: {},
  },
  Categories: {
    idField: 'category_id',
    columns: [
      'category_id', 'category_name', 'parent_category', 'slug', 'description',
      'image_file_id', 'image_url', 'status', 'sort_order', 'seo_title', 'seo_description',
      'created_at', 'updated_at',
    ],
    types: { sort_order: n },
  },
  Colors: {
    idField: 'color_id',
    columns: ['color_id', 'color_name', 'color_code', 'hex_code', 'swatch_image', 'status', 'sort_order', 'created_at', 'updated_at'],
    types: { sort_order: n },
  },
  Sizes: {
    idField: 'size_id',
    columns: ['size_id', 'size_name', 'sort_order', 'status', 'created_at', 'updated_at'],
    types: { sort_order: n },
  },
  Products: {
    idField: 'product_id',
    columns: [
      'product_id', 'sku', 'product_name', 'slug', 'category_id', 'subcategory', 'description',
      'mrp', 'discount_mode', 'fixed_discount_percent', 'inventory_mode', 'size_ids', 'color_ids',
      'status', 'out_of_stock', 'featured', 'sort_order', 'seo_title', 'seo_description',
      'created_at', 'updated_at', 'created_by', 'updated_by',
      // v5: what exists - PCS / BOX / BOTH (set automatically) and pieces per box
      'sell_mode', 'units_per_box',
      // v6: TRUE = new customers may also buy loose pieces of this article
      'pcs_for_new_customers',
    ],
    types: {
      mrp: n, fixed_discount_percent: n, sort_order: n, out_of_stock: b, featured: b, units_per_box: n, pcs_for_new_customers: b,
    },
  },
  Product_Images: {
    idField: 'image_id',
    columns: [
      'image_id', 'product_id', 'drive_file_id', 'file_url', 'image_type', 'alt_text',
      'sort_order', 'status', 'created_at', 'updated_at',
    ],
    types: { sort_order: n },
  },
  Product_Variants: {
    idField: 'variant_id',
    columns: [
      'variant_id', 'product_id', 'sku', 'size_id', 'color_id', 'box_id', 'inventory_mode',
      'units_per_box', 'box_mrp', 'mixed_color_description', 'status', 'sort_order',
      'created_at', 'updated_at',
      // v4: size-wise MRP for colour-wise variants (blank = product MRP)
      'variant_mrp',
    ],
    types: { units_per_box: n, box_mrp: n, sort_order: n, variant_mrp: n },
  },
  Inventory: {
    idField: 'inventory_id',
    columns: [
      'inventory_id', 'variant_id', 'product_id', 'color_id', 'size_id', 'box_id',
      'stock_qty', 'reserved_qty', 'available_qty', 'status', 'updated_at', 'updated_by',
    ],
    types: { stock_qty: n, reserved_qty: n, available_qty: n },
  },
  Discount_Slabs: {
    idField: 'slab_id',
    columns: [
      'slab_id', 'label', 'min_amount', 'max_amount', 'discount_percent', 'priority', 'active',
      'start_date', 'end_date', 'deleted', 'created_at', 'updated_at',
    ],
    types: { min_amount: n, max_amount: n, discount_percent: n, priority: n, active: b, deleted: b },
  },
  // v2: list maintained by Nutex (admin panel or typed directly in the sheet).
  // Column A is the customer's mobile number - the natural key the team knows.
  // Customers in this list (status blank or ACTIVE) do not need to meet the
  // normal minimum order value.
  Existing_Customers: {
    idField: 'mobile',
    columns: [
      'mobile', 'customer_name', 'business_name', 'city', 'gstin', 'minimum_order_value',
      'status', 'notes', 'added_at', 'updated_at', 'added_by',
      // v3: other WhatsApp numbers of the same customer (comma separated)
      'alternate_mobiles',
    ],
    types: { minimum_order_value: n },
  },
  Customers: {
    idField: 'customer_id',
    columns: [
      'customer_id', 'customer_name', 'business_name', 'mobile', 'whatsapp', 'email',
      'billing_address', 'shipping_address', 'city', 'state', 'pincode', 'gstin',
      'created_at', 'updated_at',
      // v3
      'alternate_mobile',
    ],
    types: {},
  },
  Orders: {
    idField: 'order_id',
    columns: [
      'order_id', 'order_number', 'customer_id',
      'customer_name_snapshot', 'business_name_snapshot', 'mobile_snapshot', 'whatsapp_snapshot',
      'email_snapshot', 'billing_address_snapshot', 'shipping_address_snapshot', 'city_snapshot',
      'state_snapshot', 'pincode_snapshot', 'gstin_snapshot', 'order_notes',
      'mrp_subtotal', 'discount_mode_snapshot', 'discount_basis_snapshot', 'discount_basis_amount',
      'discount_percent', 'slab_id_snapshot', 'discount_amount', 'final_payable', 'total_qty',
      'minimum_order_value_snapshot', 'minimum_order_met',
      'order_status', 'payment_status', 'locked', 'stock_state', 'revision', 'idempotency_key',
      'courier_name', 'tracking_number', 'dispatch_note', 'cancel_reason',
      'created_at', 'updated_at', 'locked_at', 'payment_submitted_at', 'verified_at',
      'dispatched_at', 'completed_at', 'cancelled_at',
      // v2
      'customer_type_snapshot',
      // v3
      'alternate_mobile_snapshot',
      // v8: ONLINE (UPI QR step) or OFFLINE (online payment was switched off:
      // the team confirms the order). Blank = ONLINE (older orders).
      'payment_mode_snapshot',
      // v9: flat amount the admin takes off the order total ("Less: Packing
      // charges", e.g. the customer does not want boxes). Blank = 0.
      'packing_deduction',
    ],
    types: {
      mrp_subtotal: n, discount_basis_amount: n, discount_percent: n, discount_amount: n,
      final_payable: n, total_qty: n, minimum_order_value_snapshot: n, minimum_order_met: b,
      locked: b, revision: n, packing_deduction: n,
    },
  },
  Order_Items: {
    idField: 'order_item_id',
    columns: [
      'order_item_id', 'order_id', 'order_number', 'revision', 'product_id', 'variant_id',
      'sku_snapshot', 'product_name_snapshot', 'category_snapshot', 'inventory_mode_snapshot',
      'size_snapshot', 'color_snapshot', 'box_snapshot', 'units_per_box_snapshot', 'qty',
      'mrp_unit_snapshot', 'discount_percent_snapshot', 'wholesale_unit_snapshot',
      'line_mrp_total', 'line_total', 'status', 'created_at',
      // v7: pieces taken per inventory row for one unit (JSON) - set for
      // boxes packed from loose colour stock; blank = this variant's own row
      'stock_components',
    ],
    types: {
      revision: n, units_per_box_snapshot: n, qty: n, mrp_unit_snapshot: n,
      discount_percent_snapshot: n, wholesale_unit_snapshot: n, line_mrp_total: n, line_total: n,
    },
  },
  Payments: {
    idField: 'payment_id',
    columns: [
      'payment_id', 'order_id', 'order_number', 'amount', 'expected_amount', 'payment_method',
      'utr', 'proof_file_id', 'proof_url', 'status', 'idempotency_key', 'customer_note',
      'submitted_at', 'verified_at', 'verified_by', 'remarks',
    ],
    types: { amount: n, expected_amount: n },
  },
  Order_Status_History: {
    idField: 'history_id',
    columns: [
      'history_id', 'order_id', 'order_number', 'from_status', 'to_status', 'actor_type',
      'actor_id', 'note', 'created_at',
    ],
    types: {},
  },
  Admin_Users: {
    idField: 'admin_id',
    columns: [
      'admin_id', 'email', 'name', 'password_hash', 'role', 'status', 'session_version',
      'last_login_at', 'created_at', 'updated_at',
    ],
    types: { session_version: n },
  },
  Audit_Log: {
    idField: 'audit_id',
    columns: [
      'audit_id', 'timestamp', 'admin_id', 'actor_type', 'action', 'entity_type', 'entity_id',
      'old_value', 'new_value', 'reason', 'notes', 'ip',
    ],
    types: {},
  },
  Schema_Version: {
    idField: 'version',
    columns: ['version', 'applied_at', 'description', 'app_version'],
    types: { version: n },
  },
};

export const SHEET_NAMES = Object.keys(SCHEMA);

// Sheets served from the short-lived server cache for public catalog pages.
// Checkout, order creation, payment and inventory writes ALWAYS re-read fresh.
export const CATALOG_SHEETS = [
  'Settings', 'Categories', 'Colors', 'Sizes', 'Products', 'Product_Images',
  'Product_Variants', 'Inventory', 'Discount_Slabs', 'Existing_Customers',
];
