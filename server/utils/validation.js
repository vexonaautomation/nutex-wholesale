import { z } from 'zod';
import {
  INVENTORY_MODE, PRODUCT_DISCOUNT_MODE, RECORD_STATUS, IMAGE_TYPE, INVENTORY_STATUS, ORDER_STATUS,
} from '../config/constants.js';
import { normalizeMobile } from './orderToken.js';
import { SELL_MODES, deriveSellMode, primaryInventoryMode } from './sellMode.js';

// sell mode sent by older API clients, else derived: box if pieces-per-box
// (or box configs) are given, loose pieces if colours are given
const requestedSellMode = (p) => p.sell_mode || deriveSellMode({
  hasBox: p.boxes.length > 0 || p.units_per_box >= 1,
  hasPcs: p.color_ids.length > 0,
});
import { isValidDateString } from './dates.js';

const text = (max, min = 0) => z.string().trim().min(min).max(max);
const optText = (max) => z.string().trim().max(max).optional().default('');
const id = z.string().trim().min(1).max(64);
// '' / undefined / null -> null, otherwise validated as a number
const nullableNumber = (schema) => z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : v),
  z.union([z.null(), schema]),
);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PINCODE_RE = /^[1-9][0-9]{5}$/;
export const UTR_RE = /^[A-Za-z0-9]{6,30}$/;
export const HEX_RE = /^#([0-9A-Fa-f]{6})$/;

const mobile = z.string().trim().transform(normalizeMobile).refine((v) => /^[6-9]\d{9}$/.test(v), {
  message: 'Enter a valid 10-digit Indian mobile number',
});

const optionalEmail = z.string().trim().max(150).optional().default('')
  .refine((v) => !v || EMAIL_RE.test(v), { message: 'Enter a valid email address' });

const optionalGstin = z.string().trim().toUpperCase().max(15).optional().default('')
  .refine((v) => !v || GSTIN_RE.test(v), { message: 'Enter a valid 15-character GSTIN' });

export const idempotencyKey = z.string().trim().regex(/^[A-Za-z0-9_-]{8,100}$/, 'Invalid idempotency key');

export const customerSchema = z.object({
  customer_name: text(100, 2),
  business_name: text(150, 2),
  mobile,
  whatsapp: z.string().trim().optional().default(''),
  email: optionalEmail,
  billing_address: text(500, 5),
  shipping_address: z.string().trim().max(500).optional().default(''),
  same_as_billing: z.boolean().optional().default(false),
  city: text(80, 2),
  state: text(80, 2),
  pincode: z.string().trim().refine((v) => PINCODE_RE.test(v), { message: 'Enter a valid 6-digit pincode' }),
  gstin: optionalGstin,
  order_notes: optText(1000),
  alternate_mobile: z.string().trim().max(20).optional().default(''),
}).transform((c, ctx) => {
  const whatsapp = c.whatsapp ? normalizeMobile(c.whatsapp) : c.mobile;
  if (!/^[6-9]\d{9}$/.test(whatsapp)) {
    ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Enter a valid 10-digit WhatsApp number' });
  }
  const alternate = c.alternate_mobile ? normalizeMobile(c.alternate_mobile) : '';
  if (alternate && !/^[6-9]\d{9}$/.test(alternate)) {
    ctx.addIssue({ code: 'custom', path: ['alternate_mobile'], message: 'Enter a valid 10-digit alternate mobile number' });
  }
  if (alternate && alternate === c.mobile) {
    ctx.addIssue({ code: 'custom', path: ['alternate_mobile'], message: 'Alternate number must be different from the main mobile number' });
  }
  c.alternate_mobile = alternate;
  const shipping = c.same_as_billing || !c.shipping_address ? c.billing_address : c.shipping_address;
  if (shipping.length < 5) {
    ctx.addIssue({ code: 'custom', path: ['shipping_address'], message: 'Shipping address is required' });
  }
  return { ...c, whatsapp, shipping_address: shipping };
});

export const cartItemsSchema = z.array(z.object({
  variant_id: id,
  qty: z.coerce.number().int().min(1).max(100000),
})).min(1, 'Your cart is empty').max(300);

export const quoteSchema = z.object({
  items: z.array(z.object({ variant_id: id, qty: z.coerce.number().int().min(0).max(100000) })).max(300).default([]),
});

export const draftOrderSchema = z.object({
  customer: customerSchema,
  items: cartItemsSchema,
  idempotency_key: idempotencyKey,
  client_final_payable: z.number().nonnegative().nullable().optional(),
});

export const updateOrderSchema = z.object({
  items: cartItemsSchema,
  client_final_payable: z.number().nonnegative().nullable().optional(),
});

export const recalculateSchema = z.object({
  items: z.array(z.object({ variant_id: id, qty: z.coerce.number().int().min(0).max(100000) })).max(300).optional(),
});

export const verifyStartSchema = z.object({ mobile });
export const verifyConfirmSchema = z.object({
  mobile,
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const existingCustomerSchema = z.object({
  mobile: z.string().trim().min(10).max(20),
  customer_name: optText(100),
  business_name: optText(150),
  city: optText(80),
  gstin: z.string().trim().toUpperCase().max(15).optional().default(''),
  minimum_order_value: nullableNumber(z.coerce.number().min(0).max(100000000)).optional().default(null),
  notes: optText(500),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  alternate_mobiles: z.union([z.string().max(300), z.array(z.string().max(20)).max(10)]).optional(),
});

export const existingCustomerBulkSchema = z.object({
  text: z.string().max(600000).optional().default(''),
  rows: z.array(existingCustomerSchema).max(3000).optional().default([]),
});

// orders saved on the customer's device: number + access token each
export const activeOrdersSchema = z.object({
  orders: z.array(z.object({ order_number: text(40, 5), token: text(600, 10) })).max(10),
});

export const trackOrderSchema = z.object({
  order_number: text(40, 5).transform((v) => v.toUpperCase()),
  mobile,
});

export const paymentSubmitSchema = z.object({
  amount: z.coerce.number().positive('Enter the amount paid').max(100000000),
  // optional: the screenshot is the required proof; a UTR, when given, must look valid
  utr: z.string().trim().optional().default('')
    .refine((v) => !v || UTR_RE.test(v), { message: 'Enter a valid UTR / Transaction ID (6-30 letters or digits), or leave it blank' }),
  customer_note: optText(500),
  idempotency_key: idempotencyKey,
});

// ------------------------------- ADMIN --------------------------------
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(150).refine((v) => EMAIL_RE.test(v), { message: 'Enter a valid email' }),
  password: z.string().min(1).max(200),
});

export const passwordRule = z.string().min(10, 'Password must be at least 10 characters').max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'Password must contain letters and numbers' });

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: passwordRule,
});

export const adminUserSchema = z.object({
  email: z.string().trim().toLowerCase().max(150).refine((v) => EMAIL_RE.test(v), { message: 'Enter a valid email' }),
  name: text(100, 2),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']).default('ADMIN'),
  password: passwordRule,
});

const statusEnum = z.enum([RECORD_STATUS.ACTIVE, RECORD_STATUS.INACTIVE, RECORD_STATUS.ARCHIVED]);

export const categorySchema = z.object({
  category_name: text(120, 2),
  parent_category: z.string().trim().toUpperCase().max(60).optional().default(''),
  slug: z.string().trim().max(80).optional().default(''),
  description: optText(2000),
  image_file_id: z.string().trim().max(120).optional().default(''),
  status: statusEnum.optional(),
  sort_order: z.coerce.number().int().min(0).max(1000000).optional(),
  seo_title: optText(120),
  seo_description: optText(300),
});

export const colorSchema = z.object({
  color_name: text(60, 1),
  color_code: z.string().trim().toUpperCase().max(20).optional().default(''),
  hex_code: z.string().trim().optional().default('')
    .refine((v) => !v || HEX_RE.test(v), { message: 'Hex code must look like #1A2B3C' }),
  swatch_image: z.string().trim().max(120).optional().default(''),
  status: statusEnum.optional(),
  sort_order: z.coerce.number().int().min(0).max(1000000).optional(),
});

export const sizeSchema = z.object({
  size_name: text(30, 1),
  status: statusEnum.optional(),
  sort_order: z.coerce.number().int().min(0).max(1000000).optional(),
});

export const statusChangeSchema = z.object({ status: statusEnum });
export const reorderSchema = z.object({ ids: z.array(id).min(1).max(2000) });

const boxSchema = z.object({
  box_id: z.string().trim().max(64).optional().default(''),
  sku: z.string().trim().max(64).optional().default(''),
  size_id: z.string().trim().max(64).optional().default(''),
  units_per_box: z.coerce.number().int().min(1).max(10000),
  box_mrp: nullableNumber(z.coerce.number().min(0).max(10000000)).optional().default(null),
  mixed_color_description: optText(300),
  status: z.enum([RECORD_STATUS.ACTIVE, RECORD_STATUS.INACTIVE]).optional().default(RECORD_STATUS.ACTIVE),
  key: z.string().trim().max(64).optional(), // client-side temporary key for new boxes
});

const stockEntrySchema = z.object({
  color_id: z.string().trim().max(64).optional().default(''),
  size_id: z.string().trim().max(64).optional().default(''),
  box_key: z.string().trim().max(64).optional().default(''), // box_id or client key
  stock_qty: z.coerce.number().int().min(0).max(10000000),
  expected_stock_qty: nullableNumber(z.coerce.number().int().min(0)).optional().default(null),
  status: z.enum([INVENTORY_STATUS.ACTIVE, INVENTORY_STATUS.OUT_OF_STOCK]).optional(),
});

const imageSchema = z.object({
  image_id: z.string().trim().max(64).optional().default(''),
  drive_file_id: z.string().trim().min(1).max(120),
  file_url: z.string().trim().max(500).optional().default(''),
  image_type: z.enum(Object.values(IMAGE_TYPE)).default(IMAGE_TYPE.GALLERY),
  alt_text: optText(200),
  sort_order: z.coerce.number().int().min(0).max(100000).optional().default(0),
});

export const productSchema = z.object({
  sku: z.string().trim().toUpperCase().min(1).max(64).regex(/^[A-Z0-9][A-Z0-9_./-]*$/, 'SKU may contain letters, numbers, - _ . /'),
  product_name: text(200, 2),
  slug: z.string().trim().max(80).optional().default(''),
  category_id: id,
  subcategory: optText(100),
  description: optText(5000),
  mrp: z.coerce.number().positive('MRP must be greater than 0').max(10000000),
  discount_mode: z.enum([PRODUCT_DISCOUNT_MODE.GLOBAL, PRODUCT_DISCOUNT_MODE.CUSTOM]).default(PRODUCT_DISCOUNT_MODE.GLOBAL),
  fixed_discount_percent: nullableNumber(z.coerce.number().min(0).max(99.99)).optional().default(null),
  // optional: derived from units_per_box / colours when not sent
  sell_mode: z.enum(SELL_MODES).optional(),
  pcs_for_new_customers: z.boolean().optional().default(false),
  units_per_box: nullableNumber(z.coerce.number().int('Pieces per box must be a whole number').min(1, 'At least 1 piece per box').max(10000)).optional().default(null),
  inventory_mode: z.enum([INVENTORY_MODE.COLOR_WISE, INVENTORY_MODE.BOX_WISE]).optional(),
  size_ids: z.array(id).max(60).default([]),
  // optional size-wise MRP for colour-wise products (sizes not listed use mrp)
  size_mrps: z.preprocess((v) => (v && !Array.isArray(v) && typeof v === 'object' ? Object.entries(v).map(([size_id, mrp]) => ({ size_id, mrp })) : v), z.array(z.object({
    size_id: id,
    mrp: z.coerce.number().positive('Size MRP must be greater than 0').max(10000000),
  })).max(60)).optional().default([]),
  color_ids: z.array(id).max(100).default([]),
  boxes: z.array(boxSchema).max(100).default([]),
  stock: z.array(stockEntrySchema).max(6000).default([]),
  images: z.array(imageSchema).max(30).default([]),
  status: statusEnum.default(RECORD_STATUS.ACTIVE),
  out_of_stock: z.boolean().default(false),
  featured: z.boolean().default(false),
  sort_order: z.coerce.number().int().min(0).max(1000000).default(1000),
  seo_title: optText(120),
  seo_description: optText(300),
}).superRefine((p, ctx) => {
  if (p.discount_mode === PRODUCT_DISCOUNT_MODE.CUSTOM && (p.fixed_discount_percent === null || p.fixed_discount_percent === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['fixed_discount_percent'], message: 'Enter the product discount %' });
  }
  if (!p.sell_mode && !p.boxes.length && !(p.units_per_box >= 1) && !p.color_ids.length) {
    ctx.addIssue({ code: 'custom', path: ['units_per_box'], message: 'Enter pieces per box and/or select colours for loose pieces' });
    return;
  }
  const mode = requestedSellMode(p);
  if (mode !== 'BOX') {
    if (!p.color_ids.length) ctx.addIssue({ code: 'custom', path: ['color_ids'], message: 'Select at least one color' });
    if (!p.size_ids.length) ctx.addIssue({ code: 'custom', path: ['size_ids'], message: 'Select at least one size' });
  }
  if (mode !== 'PCS' && !p.boxes.length) {
    if (!(p.units_per_box >= 1)) ctx.addIssue({ code: 'custom', path: ['units_per_box'], message: 'Enter how many pieces are in one box' });
    if (!p.size_ids.length) ctx.addIssue({ code: 'custom', path: ['size_ids'], message: 'Select at least one size (one box per size)' });
  }
}).transform((p) => {
  const mode = requestedSellMode(p);
  return { ...p, sell_mode: mode, inventory_mode: primaryInventoryMode(mode) };
});

export const bulkSellingSchema = z.object({
  product_ids: z.array(id).min(1, 'Select at least one product').max(500),
  // null = no box for these products (loose pieces only)
  units_per_box: nullableNumber(z.coerce.number().int('Pieces per box must be a whole number').min(1).max(10000)).optional().default(null),
  // undefined = keep each product's current choice
  pcs_for_new_customers: z.boolean().optional(),
  box_stock: z.coerce.number().int().min(0).max(100000).optional().default(0),
  sell_mode: z.enum(SELL_MODES).optional(), // older clients
}).superRefine((p, ctx) => {
  if (p.sell_mode && p.sell_mode !== 'PCS' && !(p.units_per_box >= 1)) ctx.addIssue({ code: 'custom', path: ['units_per_box'], message: 'Enter how many pieces are in one box' });
});

export const outOfStockSchema = z.object({ out_of_stock: z.boolean() });

export const catalogImportSchema = z.object({
  stock_per_variant: z.coerce.number().int('Use a whole number').min(0).max(100000).optional().default(0),
  box_stock: z.coerce.number().int('Use a whole number').min(0).max(100000).optional().default(0),
  // per category slug: how the imported products are sold
  selling: z.record(z.string().regex(/^[a-z0-9-]+$/), z.object({
    units_per_box: nullableNumber(z.coerce.number().int().min(1).max(10000)).optional().default(null),
    pcs_for_new_customers: z.boolean().optional().default(false),
    sell_mode: z.enum(SELL_MODES).optional(),
  })).optional().default({}),
  activate: z.boolean().optional().default(true),
});

export const inventoryUpdateSchema = z.object({
  updates: z.array(z.object({
    inventory_id: id,
    stock_qty: z.coerce.number().int().min(0).max(10000000).optional(),
    expected_stock_qty: nullableNumber(z.coerce.number().int().min(0)).optional().default(null),
    status: z.enum([INVENTORY_STATUS.ACTIVE, INVENTORY_STATUS.OUT_OF_STOCK]).optional(),
  })).min(1).max(3000),
});

const dateField = z.string().trim().optional().default('')
  .refine((v) => !v || isValidDateString(v), { message: 'Use the format YYYY-MM-DD' });

export const slabSchema = z.object({
  label: optText(80),
  min_amount: z.coerce.number().int('Use whole rupees').min(0).max(1000000000),
  max_amount: nullableNumber(z.coerce.number().int('Use whole rupees').min(0).max(1000000000)).optional().default(null),
  discount_percent: z.coerce.number().gt(0, 'Discount must be greater than 0').lt(100, 'Discount must be below 100'),
  priority: z.coerce.number().int().min(1).max(1000).optional().default(1),
  active: z.boolean().optional().default(true),
  start_date: dateField,
  end_date: dateField,
}).superRefine((s, ctx) => {
  if (s.max_amount !== null && s.max_amount < s.min_amount) {
    ctx.addIssue({ code: 'custom', path: ['max_amount'], message: 'Maximum must be greater than or equal to minimum' });
  }
  if (s.start_date && s.end_date && s.end_date < s.start_date) {
    ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'End date must be on or after the start date' });
  }
});

export const slabPreviewSchema = z.object({ mrp_amount: z.coerce.number().min(0).max(1000000000) });

export const orderStatusSchema = z.object({
  status: z.enum(Object.values(ORDER_STATUS)),
  note: optText(500),
  courier_name: optText(100),
  tracking_number: optText(100),
  dispatch_note: optText(500),
});

export const reopenSchema = z.object({
  reason: text(500, 5),
  confirm: z.literal(true, { message: 'Confirmation is required' }),
});

export const cancelSchema = z.object({ reason: text(500, 5) });
export const verifyPaymentSchema = z.object({ remarks: optText(500) });
export const rejectPaymentSchema = z.object({ remarks: text(500, 3) });

export function formatZodError(error) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
