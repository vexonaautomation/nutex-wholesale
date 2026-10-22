// Order_Items_Summary: every order item on one row, the way the IMS counts
// stock - in pieces - with the bill number and party:
//  - sold in pieces: the colour and the number of pieces
//  - sold in boxes:  "Mix Color", pieces = boxes x pieces per box (+ boxes,
//                    pieces per box)
// MRP and rate are per piece. item_status: ACTIVE / REPLACED (order edited)
// / CANCELLED. Written in the same batch as the order's own sheets.
import { pcsColumns } from '../utils/itemPcs.js';
import { round2 } from '../utils/money.js';

export const SUMMARY_SHEET = 'Order_Items_Summary';
export const SUMMARY_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', REPLACED: 'REPLACED', CANCELLED: 'CANCELLED' });

const perPc = (total, pcs) => (pcs > 0 ? round2((Number(total) || 0) / pcs) : null);

export function summaryRow(order, item, status = item.status || SUMMARY_STATUS.ACTIVE) {
  const pcs = pcsColumns(item);
  return {
    order_item_id: item.order_item_id,
    order_id: order.order_id,
    bill_no: order.order_number,
    order_date: order.created_at,
    party_name: order.business_name_snapshot || order.customer_name_snapshot,
    customer_name: order.customer_name_snapshot,
    mobile: order.mobile_snapshot,
    city: order.city_snapshot,
    sku: item.sku_snapshot,
    product_name: item.product_name_snapshot,
    category: item.category_snapshot,
    size: item.size_snapshot,
    item_colour: pcs.item_colour,
    qty_pcs: pcs.qty_pcs,
    sold_in: pcs.sold_in,
    boxes: pcs.boxes,
    pcs_per_box: pcs.pcs_per_box,
    mrp_per_pc: perPc(item.line_mrp_total, pcs.qty_pcs),
    discount_percent: item.discount_percent_snapshot,
    rate_per_pc: perPc(item.line_total, pcs.qty_pcs),
    mrp_total: item.line_mrp_total,
    amount: item.line_total,
    item_status: status,
    revision: item.revision,
    created_at: item.created_at,
  };
}

export const summaryAppendOp = (order, items) => (items.length
  ? { op: 'append', sheet: SUMMARY_SHEET, rows: items.map((i) => summaryRow(order, i)) }
  : null);

// optional: an item written before the summary existed is simply skipped
export const summaryStatusOps = (items, status) => items.map((i) => ({
  op: 'update', sheet: SUMMARY_SHEET, id: i.order_item_id, patch: { item_status: status }, optional: true,
}));
