import { formatINR, pct } from '../../utils/format.js';

export function CartSummary({ quote, title = 'Order summary' }) {
  if (!quote) return null;
  const blended = quote.effective_discount_percent !== quote.discount_percent && quote.discount_amount > 0;
  return (
    <div>
      {title && <h3 className="card-title">{title}</h3>}
      <div className="summary-row"><span>Gross MRP total</span><strong>{formatINR(quote.gross_mrp_subtotal)}</strong></div>
      <div className="summary-row">
        <span>Discount{quote.current_slab ? ` (slab ${pct(quote.current_slab.discount_percent)})` : ''}</span>
        <strong>{pct(blended ? quote.effective_discount_percent : quote.discount_percent)}{blended ? ' avg' : ''}</strong>
      </div>
      <div className="summary-row"><span>Discount amount</span><strong style={{ color: 'var(--success-700)' }}>− {formatINR(quote.discount_amount)}</strong></div>
      <div className="summary-row"><span>Total quantity</span><strong>{quote.total_qty} {quote.total_pieces !== quote.total_qty ? `(${quote.total_pieces} pcs)` : 'pcs'}</strong></div>
      <div className="summary-row">
        <span>Minimum wholesale order</span>
        <strong>{quote.minimum_order_waived ? 'Not applicable (existing customer)' : formatINR(quote.minimum_order_value)}</strong>
      </div>
      {!quote.minimum_order_met && quote.total_qty > 0 && (
        <div className="summary-row"><span>Amount remaining to minimum</span><strong style={{ color: 'var(--warning-700)' }}>{formatINR(quote.amount_to_minimum)}</strong></div>
      )}
      <div className="summary-total"><span>Final wholesale total</span><strong>{formatINR(quote.final_payable)}</strong></div>
    </div>
  );
}
