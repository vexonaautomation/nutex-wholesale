import { BadgeCheck, CheckCircle2, Target } from 'lucide-react';
import { formatINR } from '../../utils/format.js';

// Minimum order is always measured on the FINAL payable value (after discount).
// Verified existing customers have their own minimum (usually none).
export function MinimumOrderProgress({ quote, compact = false }) {
  if (!quote) return null;
  if (quote.minimum_order_waived) {
    return (
      <div className="progress-card" style={{ borderColor: '#c4e7d3', background: '#f3fbf6' }}>
        <div className="progress-head" style={{ marginBottom: 0 }}>
          <strong className="row"><BadgeCheck size={16} color="var(--success-500)" /> Minimum order</strong>
          <span className="badge badge-success">Not applicable</span>
        </div>
        {!compact && <div className="progress-foot">Existing customer - order any quantity.</div>}
      </div>
    );
  }
  const min = Number(quote.minimum_order_value) || 0;
  const final = Number(quote.final_payable) || 0;
  const met = quote.minimum_order_met;
  const progress = min ? Math.min(100, (final / min) * 100) : 100;
  const existing = quote.customer_type === 'EXISTING';
  return (
    <div className="progress-card">
      <div className="progress-head">
        <strong className="row">
          {met ? <CheckCircle2 size={16} color="var(--success-500)" /> : <Target size={16} color="var(--brand-600)" />}
          {existing ? 'Your minimum order (existing customer)' : 'Minimum wholesale order'}
        </strong>
        <span className="num"><strong>{formatINR(final)}</strong> / {formatINR(min)}</span>
      </div>
      <div className={`progress ${met ? 'is-complete' : ''}`}><span style={{ width: `${progress}%` }} /></div>
      {!compact && (
        <div className="progress-foot">
          {met
            ? <span style={{ color: 'var(--success-700)', fontWeight: 600 }}>Minimum order reached - you can place your order.</span>
            : <>Still required: <strong>{formatINR(quote.amount_to_minimum)}</strong> (final payable value after discount)</>}
        </div>
      )}
    </div>
  );
}
