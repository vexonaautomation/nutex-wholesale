import { formatINR, pct } from '../../utils/format.js';

/** Snapshot view of a placed order (values come from the order, never recalculated). */
export function OrderItems({ items }) {
  return (
    <div className="item-list">
      {items.map((i) => (
        <div className="item-row" key={i.order_item_id || i.key}>
          <div>
            <div style={{ fontWeight: 600 }}>{i.product_name}</div>
            <div className="meta">
              SKU {i.sku}
              {i.color ? ` · ${i.color}` : ''}
              {i.size ? ` · Size ${i.size}` : ''}
              {i.box ? ` · ${i.box}` : ''}
            </div>
            <div className="meta">
              {i.qty} × {formatINR(i.unit_price)} <span className="soft">(MRP {formatINR(i.mrp_unit)}, {pct(i.discount_percent)} off)</span>
            </div>
          </div>
          <strong className="num">{formatINR(i.line_total)}</strong>
        </div>
      ))}
    </div>
  );
}

export function OrderTotals({ totals }) {
  return (
    <div>
      <div className="summary-row"><span>MRP subtotal</span><strong>{formatINR(totals.mrp_subtotal)}</strong></div>
      <div className="summary-row"><span>Discount</span><strong>{pct(totals.effective_discount_percent || totals.discount_percent)}</strong></div>
      <div className="summary-row"><span>Discount amount</span><strong style={{ color: 'var(--success-700)' }}>− {formatINR(totals.discount_amount)}</strong></div>
      <div className="summary-row"><span>Total quantity</span><strong>{totals.total_qty}</strong></div>
      <div className="summary-row">
        <span>Minimum order (at time of order)</span>
        <strong>{totals.customer_type === 'EXISTING' && !Number(totals.minimum_order_value) ? 'Not applicable (existing customer)' : formatINR(totals.minimum_order_value)}</strong>
      </div>
      {Number(totals.packing_deduction) > 0 && (
        <div className="summary-row"><span>Less: Packing charges</span><strong style={{ color: 'var(--success-700)' }}>− {formatINR(totals.packing_deduction)}</strong></div>
      )}
      <div className="summary-total"><span>Final payable</span><strong>{formatINR(totals.final_payable)}</strong></div>
    </div>
  );
}
