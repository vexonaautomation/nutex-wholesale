import { sheetsService } from './sheetsService.js';
import { buildCatalog } from './catalogService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import {
  ORDER_STATUS, PAYMENT_STATUS, RECORD_STATUS, INVENTORY_STATUS,
} from '../config/constants.js';
import { availableOf, autoBoxInfo } from '../utils/stockValidator.js';
import { variantOffered, isBoxVariant } from '../utils/sellMode.js';
import { describeVariant } from './quoteService.js';
import { round2 } from '../utils/money.js';
import { istDate } from '../utils/dates.js';
import { normalizeMobile } from '../utils/orderToken.js';
import { isSubAdmin, can } from '../utils/permissions.js';

// orders still to be finished (payment, packing or dispatch pending)
const OPEN = new Set([
  ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.PAYMENT_SUBMITTED, ORDER_STATUS.PAYMENT_VERIFIED, ORDER_STATUS.PAYMENT_REJECTED,
  ORDER_STATUS.CONFIRMED, ORDER_STATUS.PROCESSING, ORDER_STATUS.PACKED,
]);
// a sale = payment verified (or further along)
const SOLD = new Set([
  ORDER_STATUS.PAYMENT_VERIFIED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PROCESSING,
  ORDER_STATUS.PACKED, ORDER_STATUS.DISPATCHED, ORDER_STATUS.COMPLETED,
]);
const value = (list) => Math.round(list.reduce((s, o) => s + (Number(o.final_payable) || 0), 0));

/** Pending orders + sale value (today / this month / total) for a set of orders. */
function salesCards(orders) {
  const today = istDate();
  const month = today.slice(0, 7);
  const sold = orders.filter((o) => SOLD.has(o.order_status));
  const dayOf = (o) => (o.verified_at || o.created_at ? istDate(new Date(o.verified_at || o.created_at)) : '');
  return {
    pending_orders: orders.filter((o) => OPEN.has(o.order_status)).length,
    payment_pending: orders.filter((o) => o.order_status === ORDER_STATUS.PAYMENT_PENDING || o.order_status === ORDER_STATUS.PAYMENT_REJECTED).length,
    payment_to_verify: orders.filter((o) => o.order_status === ORDER_STATUS.PAYMENT_SUBMITTED).length,
    to_dispatch: orders.filter((o) => [ORDER_STATUS.PAYMENT_VERIFIED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PROCESSING, ORDER_STATUS.PACKED].includes(o.order_status)).length,
    pending_value: value(orders.filter((o) => OPEN.has(o.order_status))),
    sale_value_today: value(sold.filter((o) => dayOf(o) === today)),
    sale_value_month: value(sold.filter((o) => dayOf(o).startsWith(month))),
    sale_value_total: value(sold),
    sale_orders: sold.length,
  };
}

/** Orders made with each admin / sub admin number (who made the bill). */
function byTeam(orders, admins) {
  const names = new Map(admins.filter((a) => a.mobile).map((a) => [normalizeMobile(a.mobile), a]));  // number -> admin user
  const rows = new Map();
  for (const o of orders) {
    const m = normalizeMobile(o.placed_by_mobile || '');
    if (!m || o.order_status === ORDER_STATUS.CANCELLED) continue;
    if (!rows.has(m)) rows.set(m, []);
    rows.get(m).push(o);
  }
  return [...rows.entries()].map(([mobile, list]) => {
    const c = salesCards(list);
    const who = names.get(mobile);
    return {
      mobile, name: who?.name || 'Admin number', sub_admin: who ? isSubAdmin(who) : false,
      orders: list.length, pending_orders: c.pending_orders, sale_value_total: c.sale_value_total, sale_value_month: c.sale_value_month,
    };
  }).sort((a, b) => b.orders - a.orders);
}

const namesOf = (admins) => new Map(admins.filter((a) => a.mobile).map((a) => [normalizeMobile(a.mobile), a.name]));
const recentOrder = (names) => (o) => ({
  order_id: o.order_id, order_number: o.order_number, created_at: o.created_at, customer_name: o.customer_name_snapshot,
  business_name: o.business_name_snapshot, final_payable: o.final_payable, order_status: o.order_status, payment_status: o.payment_status,
  placed_by_mobile: o.placed_by_mobile || '',
  placed_by_name: o.placed_by_mobile ? names.get(normalizeMobile(o.placed_by_mobile)) || '' : '',
});

/**
 * Dashboard. A sub admin without "Full dashboard" gets only the order
 * numbers: pending orders and sale value (all orders + the ones they made).
 */
export async function getDashboard({ admin = null } = {}) {
  if (isSubAdmin(admin) && !can(admin, 'reports')) {
    const [all, admins] = await Promise.all([sheetsService.read('Orders', { fresh: true }), sheetsService.read('Admin_Users')]);
    const orders = all.filter((o) => o.order_status !== ORDER_STATUS.DRAFT);
    const mine = admin.mobile ? orders.filter((o) => normalizeMobile(o.placed_by_mobile || '') === normalizeMobile(admin.mobile)) : [];
    const newest = (list) => [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8).map(recentOrder(namesOf(admins)));
    return {
      limited: true,
      sales: salesCards(orders),
      mine: { orders: mine.filter((o) => o.order_status !== ORDER_STATUS.CANCELLED).length, ...salesCards(mine) },
      recent_orders: newest(orders),
      my_recent_orders: newest(mine),
    };
  }
  const data = await sheetsService.readMany([...CATALOG_SHEETS, 'Orders', 'Payments', 'Customers', 'Admin_Users'], { fresh: true });
  const catalog = buildCatalog(data);
  const { settings } = catalog;
  const threshold = Number(settings.low_stock_threshold) || 0;

  const lowStock = [];
  const outOfStock = [];
  const productsWithStock = new Set();
  for (const p of catalog.products.filter((x) => x.status === RECORD_STATUS.ACTIVE)) {
    const variants = (catalog.variantsByProduct.get(p.product_id) || []).filter((v) => variantOffered(p, v));
    for (const v of variants) {
      const inv = catalog.inventoryByVariant.get(v.variant_id);
      const auto = isBoxVariant(v) ? autoBoxInfo(catalog, p, v) : null;
      if (auto?.ok) {
        // box packed from loose colours: their rows already show the stock
        if (auto.boxes > 0) productsWithStock.add(p.product_id);
        continue;
      }
      // a box that cannot be packed (e.g. pieces per box not divisible by the colours) is out of stock
      const avail = auto ? 0 : availableOf(inv);
      const d = describeVariant(catalog, p, v);
      const row = {
        product_id: p.product_id, product_name: p.product_name, sku: v.sku, color: d.color_name, size: d.size_name,
        box: d.box_label, available: avail, inventory_id: inv?.inventory_id,
      };
      if (avail <= 0 || inv?.status === INVENTORY_STATUS.OUT_OF_STOCK) outOfStock.push(row);
      else {
        productsWithStock.add(p.product_id);
        if (avail <= threshold) lowStock.push(row);
      }
    }
  }

  const orders = data.Orders;
  const byStatus = (s) => orders.filter((o) => o.order_status === s).length;
  const byPayment = (s) => orders.filter((o) => o.payment_status === s).length;
  const valueStatuses = new Set([
    ORDER_STATUS.PAYMENT_VERIFIED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PROCESSING,
    ORDER_STATUS.PACKED, ORDER_STATUS.DISPATCHED, ORDER_STATUS.COMPLETED,
  ]);
  const confirmedValue = orders.filter((o) => valueStatuses.has(o.order_status)).reduce((s, o) => s + (Number(o.final_payable) || 0), 0);
  const pipelineValue = orders.filter((o) => o.order_status !== ORDER_STATUS.CANCELLED).reduce((s, o) => s + (Number(o.final_payable) || 0), 0);
  const activeProducts = catalog.products.filter((p) => p.status === RECORD_STATUS.ACTIVE);

  const liveOrders = orders.filter((o) => o.order_status !== ORDER_STATUS.DRAFT);
  return {
    sales: salesCards(liveOrders),
    team: byTeam(liveOrders, data.Admin_Users || []),
    cards: {
      total_products: catalog.products.length,
      active_products: activeProducts.length,
      out_of_stock_products: activeProducts.filter((p) => p.out_of_stock || !productsWithStock.has(p.product_id)).length,
      categories: catalog.categories.filter((c) => c.status === RECORD_STATUS.ACTIVE).length,
      customers: data.Customers.length,
      total_orders: orders.length,
      payment_pending: byStatus(ORDER_STATUS.PAYMENT_PENDING),
      payment_submitted: byPayment(PAYMENT_STATUS.SUBMITTED),
      payment_verified: byPayment(PAYMENT_STATUS.VERIFIED),
      payment_rejected: byPayment(PAYMENT_STATUS.REJECTED),
      confirmed: byStatus(ORDER_STATUS.CONFIRMED),
      processing: byStatus(ORDER_STATUS.PROCESSING),
      packed: byStatus(ORDER_STATUS.PACKED),
      dispatched: byStatus(ORDER_STATUS.DISPATCHED),
      completed: byStatus(ORDER_STATUS.COMPLETED),
      cancelled: byStatus(ORDER_STATUS.CANCELLED),
      verified_order_value: round2(confirmedValue),
      wholesale_order_value: round2(pipelineValue),
      low_stock_variants: lowStock.length,
      out_of_stock_variants: outOfStock.length,
    },
    pricing: {
      discount_mode: settings.discount_mode,
      default_discount_percent: settings.default_discount_percent,
      discount_slab_basis: settings.discount_slab_basis,
      minimum_order_value: settings.minimum_order_value,
      price_display_mode: settings.price_display_mode,
      active_slabs: data.Discount_Slabs.filter((s) => s.active && !s.deleted).length,
      existing_customer_minimum_order_value: settings.existing_customer_minimum_order_value,
      existing_customer_otp_enabled: settings.existing_customer_otp_enabled,
      existing_customers: (data.Existing_Customers || []).filter((r) => String(r.status || 'ACTIVE').toUpperCase() !== 'INACTIVE').length,
    },
    recent_orders: [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8).map(recentOrder(namesOf(data.Admin_Users || []))),
    recent_payments: [...data.Payments].sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1)).slice(0, 8).map((p) => ({
      payment_id: p.payment_id, order_id: p.order_id, order_number: p.order_number, amount: p.amount, utr: p.utr, status: p.status, submitted_at: p.submitted_at,
    })),
    low_stock: lowStock.slice(0, 25),
    out_of_stock: outOfStock.slice(0, 25),
    setup: {
      categories_empty: data.Categories.length === 0,
      sizes_empty: data.Sizes.length === 0,
      colors_empty: data.Colors.length === 0,
      payment_qr_missing: !settings.payment_qr_file_id,
      whatsapp_missing: !settings.whatsapp_number && !settings.payment_whatsapp_number,
    },
  };
}
