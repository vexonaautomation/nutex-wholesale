// Admin > Analytics (owner / admin only): sales by party, item, category,
// size, colour, team member and day for a date range. Amounts are what was
// billed: order totals (final payable) for parties / team / days, line totals
// for items / categories / sizes / colours. Pieces count boxes as their
// pieces; dozens = pieces / 12. Cancelled orders are left out (counted apart).
import { sheetsService } from './sheetsService.js';
import { adminNamesByMobile } from './authService.js';
import { ORDER_STATUS, ITEM_STATUS, CUSTOMER_TYPE } from '../config/constants.js';
import { pcsColumns } from '../utils/itemPcs.js';
import { istDate } from '../utils/dates.js';
import { normalizeMobile } from '../utils/orderToken.js';
import { round2 } from '../utils/money.js';
import { badRequest } from '../utils/errors.js';

const S = ORDER_STATUS;
const SCOPES = {
  // payment verified or confirmed by the team, up to handed over
  confirmed: [S.PAYMENT_VERIFIED, S.CONFIRMED, S.PROCESSING, S.PACKED, S.DISPATCHED, S.COMPLETED],
  handed_over: [S.COMPLETED],
  all: null, // every order that is not cancelled
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// "went to packing": the first of these in the order's history
const PACKING_STATUSES = [S.PROCESSING, S.PACKED, S.DISPATCHED, S.COMPLETED];

/**
 * Ordered vs supplied: the items when the order went to packing (the item
 * revision that was current then) against its items now. Every edit writes a
 * new revision of all items, so this also works for older orders.
 */
export function orderedVsSupplied(order, allItems, history) {
  const packedAt = history
    .filter((h) => h.order_id === order.order_id && PACKING_STATUSES.includes(h.to_status) && h.created_at)
    .map((h) => h.created_at)
    .sort()[0];
  if (!packedAt) return null;
  const mine = allItems.filter((i) => i.order_id === order.order_id);
  const revAt = Math.max(0, ...mine.filter((i) => i.created_at && i.created_at <= packedAt).map((i) => Number(i.revision) || 0));
  const ordered = revAt ? mine.filter((i) => (Number(i.revision) || 0) === revAt) : mine.filter((i) => i.status === ITEM_STATUS.ACTIVE);
  const supplied = mine.filter((i) => i.status === ITEM_STATUS.ACTIVE);
  return { packedAt, ordered, supplied };
}
const dzn = (pcs) => round2(pcs / 12);

function bucket(map, key, init) {
  if (!map.has(key)) map.set(key, { ...init(), _orders: new Set(), _parties: new Set() });
  return map.get(key);
}

/** Map -> sorted list (by amount), with orders / parties counts and dozens. */
function finish(map, extra = () => ({})) {
  return [...map.values()]
    .map(({ _orders, _parties, ...r }) => ({
      ...r,
      amount: round2(r.amount),
      dzn: dzn(r.pcs),
      orders: _orders.size,
      parties: _parties.size,
      avg_rate: r.pcs > 0 ? round2(r.amount / r.pcs) : null,
      ...extra(r),
    }))
    .sort((a, b) => b.amount - a.amount || b.pcs - a.pcs);
}

export async function salesAnalytics({ from, to, scope = 'confirmed' } = {}) {
  const today = istDate(new Date());
  const end = DAY.test(String(to || '')) ? to : today;
  const start = DAY.test(String(from || '')) ? from : `${end.slice(0, 8)}01`;
  if (start > end) throw badRequest('From date must be on or before the To date.');
  const statuses = Object.hasOwn(SCOPES, scope) ? SCOPES[scope] : SCOPES.confirmed;

  const [data, names] = await Promise.all([
    sheetsService.readMany(['Orders', 'Order_Items', 'Products', 'Order_Status_History'], { fresh: true }),
    adminNamesByMobile(),
  ]);
  const skus = new Map(data.Products.map((p) => [p.product_id, p.sku]));
  const itemsByOrder = new Map();
  for (const i of data.Order_Items) {
    if (i.status !== ITEM_STATUS.ACTIVE) continue;
    if (!itemsByOrder.has(i.order_id)) itemsByOrder.set(i.order_id, []);
    itemsByOrder.get(i.order_id).push(i);
  }

  const inRange = data.Orders.filter((o) => {
    const d = o.created_at ? istDate(new Date(o.created_at)) : '';
    return d >= start && d <= end;
  });
  const cancelled = inRange.filter((o) => o.order_status === S.CANCELLED);
  const orders = inRange.filter((o) => o.order_status !== S.CANCELLED && (!statuses || statuses.includes(o.order_status)));

  const parties = new Map();
  const items = new Map();
  const categories = new Map();
  const sizes = new Map();
  const colours = new Map();
  const team = new Map();
  const days = new Map();
  const kpi = {
    orders: orders.length, amount: 0, mrp: 0, discount: 0, packing_less: 0, pcs: 0, boxes: 0,
    new_orders: 0, existing_orders: 0, new_amount: 0, existing_amount: 0,
  };

  for (const o of orders) {
    const amount = Number(o.final_payable) || 0;
    const partyKey = normalizeMobile(o.mobile_snapshot) || String(o.business_name_snapshot || o.customer_name_snapshot).toLowerCase();
    const lines = itemsByOrder.get(o.order_id) || [];
    const pcs = lines.reduce((s, i) => s + pcsColumns(i).qty_pcs, 0);
    const boxes = lines.reduce((s, i) => s + (pcsColumns(i).boxes || 0), 0);
    const existing = o.customer_type_snapshot === CUSTOMER_TYPE.EXISTING;
    const day = istDate(new Date(o.created_at));

    kpi.amount += amount;
    kpi.mrp += Number(o.mrp_subtotal) || 0;
    kpi.discount += Number(o.discount_amount) || 0;
    kpi.packing_less += Number(o.packing_deduction) || 0;
    kpi.pcs += pcs;
    kpi.boxes += boxes;
    kpi[existing ? 'existing_orders' : 'new_orders'] += 1;
    kpi[existing ? 'existing_amount' : 'new_amount'] += amount;

    const p = bucket(parties, partyKey, () => ({
      party: o.business_name_snapshot || o.customer_name_snapshot, customer: o.customer_name_snapshot,
      city: o.city_snapshot, mobile: o.mobile_snapshot, type: existing ? 'Existing' : 'New', pcs: 0, boxes: 0, amount: 0, last_order: '',
    }));
    p._orders.add(o.order_id);
    p.pcs += pcs;
    p.boxes += boxes;
    p.amount += amount;
    if (o.created_at > p.last_order) p.last_order = o.created_at;
    if (existing) p.type = 'Existing';

    const by = o.placed_by_mobile ? names.get(normalizeMobile(o.placed_by_mobile)) || `Admin ${o.placed_by_mobile}` : 'Customer (website)';
    const t = bucket(team, by, () => ({ name: by, pcs: 0, boxes: 0, amount: 0 }));
    t._orders.add(o.order_id);
    t._parties.add(partyKey);
    t.pcs += pcs;
    t.boxes += boxes;
    t.amount += amount;

    const d = bucket(days, day, () => ({ date: day, pcs: 0, boxes: 0, amount: 0 }));
    d._orders.add(o.order_id);
    d.pcs += pcs;
    d.amount += amount;

    for (const i of lines) {
      const ip = pcsColumns(i);
      const line = Number(i.line_total) || 0;
      const add = (map, key, init) => {
        const r = bucket(map, key, init);
        r._orders.add(o.order_id);
        r._parties.add(partyKey);
        r.pcs += ip.qty_pcs;
        r.boxes += ip.boxes || 0;
        r.amount += line;
        return r;
      };
      const it = add(items, i.product_id, () => ({
        sku: skus.get(i.product_id) || String(i.sku_snapshot || '').split('-')[0], product: i.product_name_snapshot,
        category: i.category_snapshot, pcs: 0, boxes: 0, amount: 0, mrp_total: 0,
      }));
      it.mrp_total += Number(i.line_mrp_total) || 0;
      add(categories, i.category_snapshot || 'Other', () => ({ category: i.category_snapshot || 'Other', pcs: 0, boxes: 0, amount: 0 }));
      add(sizes, i.size_snapshot || 'Free / box', () => ({ size: i.size_snapshot || 'Free / box', pcs: 0, boxes: 0, amount: 0 }));
      add(colours, ip.item_colour || 'Other', () => ({ colour: ip.item_colour || 'Other', pcs: 0, boxes: 0, amount: 0 }));
    }
  }

  // ---------------------------------------------- ordered vs supplied
  const variantKey = (i) => i.variant_id || `${i.product_id}|${i.color_snapshot}|${i.size_snapshot}`;
  const label = (i) => {
    const ip = pcsColumns(i);
    return `${i.product_name_snapshot} ${ip.item_colour || ''} ${i.size_snapshot || ''}`.replace(/\s+/g, ' ').trim();
  };
  const fill = { packed_orders: 0, changed_orders: 0, ordered_pcs: 0, supplied_pcs: 0, short_pcs: 0, extra_pcs: 0, ordered_amount: 0, supplied_amount: 0, short_amount: 0 };
  const shortItems = new Map();
  const changed = [];
  for (const o of orders) {
    const ovs = orderedVsSupplied(o, data.Order_Items, data.Order_Status_History);
    if (!ovs) continue;
    fill.packed_orders += 1;
    const per = new Map();
    const side = (rows, which) => {
      for (const i of rows) {
        const k = variantKey(i);
        if (!per.has(k)) per.set(k, { item: i, ordered: 0, supplied: 0, ordered_amount: 0, supplied_amount: 0 });
        const r = per.get(k);
        r[which] += pcsColumns(i).qty_pcs;
        r[`${which}_amount`] += Number(i.line_total) || 0;
      }
    };
    side(ovs.ordered, 'ordered');
    side(ovs.supplied, 'supplied');
    const diffs = [];
    let oPcs = 0; let sPcs = 0; let oAmt = 0; let sAmt = 0;
    for (const [k, r] of per) {
      oPcs += r.ordered; sPcs += r.supplied; oAmt += r.ordered_amount; sAmt += r.supplied_amount;
      const short = Math.max(0, r.ordered - r.supplied);
      const extra = Math.max(0, r.supplied - r.ordered);
      const rate = r.ordered > 0 ? r.ordered_amount / r.ordered : (r.supplied > 0 ? r.supplied_amount / r.supplied : 0);
      fill.short_pcs += short;
      fill.extra_pcs += extra;
      fill.short_amount += short * rate;
      if (r.ordered !== r.supplied) diffs.push(`${label(r.item)}: ${r.ordered} → ${r.supplied}`);
      const s = bucket(shortItems, k, () => ({
        product: r.item.product_name_snapshot, sku: r.item.sku_snapshot, colour: pcsColumns(r.item).item_colour, size: r.item.size_snapshot,
        ordered_pcs: 0, supplied_pcs: 0, short_pcs: 0, extra_pcs: 0, short_amount: 0, pcs: 0, amount: 0,
      }));
      s.ordered_pcs += r.ordered;
      s.supplied_pcs += r.supplied;
      s.short_pcs += short;
      s.extra_pcs += extra;
      s.short_amount += short * rate;
      if (r.ordered !== r.supplied) s._orders.add(o.order_id);
    }
    fill.ordered_pcs += oPcs; fill.supplied_pcs += sPcs; fill.ordered_amount += oAmt; fill.supplied_amount += sAmt;
    if (diffs.length) {
      fill.changed_orders += 1;
      changed.push({
        bill: o.order_number,
        date: o.created_at,
        party: o.business_name_snapshot || o.customer_name_snapshot,
        status: o.order_status,
        ordered_pcs: oPcs,
        supplied_pcs: sPcs,
        diff_pcs: sPcs - oPcs,
        ordered_amount: round2(oAmt),
        supplied_amount: round2(sAmt),
        diff_amount: round2(sAmt - oAmt),
        changes: diffs.join('; '),
      });
    }
  }
  const shortage = [...shortItems.values()]
    .map(({ _orders, _parties, ...r }) => ({
      ...r,
      short_amount: round2(r.short_amount),
      fill_rate: r.ordered_pcs > 0 ? round2((Math.min(r.supplied_pcs, r.ordered_pcs) / r.ordered_pcs) * 100) : null,
      orders: _orders.size,
    }))
    .filter((r) => r.short_pcs || r.extra_pcs)
    .sort((a, b) => b.short_amount - a.short_amount || b.short_pcs - a.short_pcs);

  const amount = round2(kpi.amount);
  return {
    fulfilment: {
      ...fill,
      ordered_amount: round2(fill.ordered_amount),
      supplied_amount: round2(fill.supplied_amount),
      short_amount: round2(fill.short_amount),
      fill_rate: fill.ordered_pcs > 0 ? round2(((fill.ordered_pcs - fill.short_pcs) / fill.ordered_pcs) * 100) : null,
    },
    shortage,
    changed: changed.sort((a, b) => a.diff_amount - b.diff_amount),
    from: start,
    to: end,
    scope: Object.hasOwn(SCOPES, scope) ? scope : 'confirmed',
    kpi: {
      ...kpi,
      amount,
      mrp: round2(kpi.mrp),
      discount: round2(kpi.discount),
      packing_less: round2(kpi.packing_less),
      new_amount: round2(kpi.new_amount),
      existing_amount: round2(kpi.existing_amount),
      dzn: dzn(kpi.pcs),
      parties: parties.size,
      avg_order: kpi.orders ? round2(amount / kpi.orders) : 0,
      avg_rate: kpi.pcs ? round2(amount / kpi.pcs) : 0,
      cancelled_orders: cancelled.length,
      cancelled_amount: round2(cancelled.reduce((s, o) => s + (Number(o.final_payable) || 0), 0)),
    },
    parties: finish(parties).map(({ parties: _, ...r }) => ({ ...r, avg_order: r.orders ? round2(r.amount / r.orders) : 0 })),
    items: finish(items, (r) => ({ mrp_total: round2(r.mrp_total) })),
    categories: finish(categories),
    sizes: finish(sizes),
    colours: finish(colours),
    team: finish(team),
    days: finish(days).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}
