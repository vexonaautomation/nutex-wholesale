import { BadgePercent } from 'lucide-react';
import { formatINR, pct } from '../../utils/format.js';
import { SLAB_BASIS_LABELS } from '../../constants/index.js';

/**
 * Slab progress - shown separately from the minimum-order progress because
 * the two rules are independent (a cart can reach a slab yet still be below
 * the minimum order value).
 */
export function DiscountProgress({ quote }) {
  if (!quote) return null;
  if (quote.discount_mode !== 'SLAB') {
    return (
      <div className="progress-card">
        <div className="progress-head">
          <strong className="row"><BadgePercent size={16} color="var(--brand-600)" /> Wholesale discount</strong>
          <span className="badge badge-success">{pct(quote.discount_percent)} OFF MRP</span>
        </div>
      </div>
    );
  }
  const slabs = quote.slabs || [];
  const basis = quote.discount_basis_amount || 0;
  const next = quote.next_slab;
  const target = next ? next.min_amount : (quote.current_slab?.min_amount || 1);
  const progress = next ? Math.min(100, (basis / Math.max(1, target)) * 100) : 100;
  return (
    <div className="progress-card">
      <div className="progress-head">
        <strong className="row"><BadgePercent size={16} color="var(--brand-600)" /> Discount slab</strong>
        {quote.current_slab
          ? <span className="badge badge-success">{pct(quote.current_slab.discount_percent)} OFF</span>
          : <span className="badge badge-outline">No slab yet</span>}
      </div>
      <div className="small muted">
        Cart basis ({SLAB_BASIS_LABELS[quote.discount_basis] || 'MRP subtotal'}): <strong className="num">{formatINR(basis)}</strong>
      </div>
      <div className="slab-track">
        <div className={`progress ${next ? '' : 'is-complete'}`}><span style={{ width: `${progress}%` }} /></div>
        {slabs.length > 1 && (
          <div className="slab-steps">
            {slabs.map((s) => (
              <div key={s.slab_id} className={`slab-step ${quote.current_slab?.slab_id === s.slab_id ? 'on' : ''}`}>
                <b>{pct(s.discount_percent)}</b>
                {formatINR(s.min_amount)}+
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="progress-foot">
        {next
          ? <>Next slab: <strong>{pct(next.discount_percent)}</strong> from {formatINR(next.min_amount)} · add products worth <strong>{formatINR(quote.mrp_to_next_slab)}</strong> (MRP) more</>
          : quote.current_slab ? 'You are in the highest discount slab.' : 'Add products to reach the first discount slab.'}
      </div>
    </div>
  );
}
