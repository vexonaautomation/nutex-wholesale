import { sheetsService } from './sheetsService.js';
import { buildCatalog } from './catalogService.js';
import { CATALOG_SHEETS } from '../config/schema.js';
import {
  ORDER_STATUS, PAYMENT_STATUS, RECORD_STATUS, INVENTORY_STATUS,
} from '../config/constants.js';
import { availableOf } from '../utils/stockValidator.js';
import { variantOffered } from '../utils/sellMode.js';
import { describeVariant } from './quoteService.js';
import { round2 } from '../utils/money.js';

export async function getDashboard() {
  const data = await sheetsService.readMany([...CATALOG_SHEETS, 'Orders', 'Payments', 'Customers'], { fresh: true });
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
      const avail = availableOf(inv);
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

  return {
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
    recent_orders: [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8).map((o) => ({
      order_id: o.order_id, order_number: o.order_number, created_at: o.created_at, customer_name: o.customer_name_snapshot,
      business_name: o.business_name_snapshot, final_payable: o.final_payable, order_status: o.order_status, payment_status: o.payment_status,
    })),
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
