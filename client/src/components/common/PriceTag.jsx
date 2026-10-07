import { formatINR, pct } from '../../utils/format.js';
import { wholesaleOf } from '../../utils/pricing.js';

/**
 * Renders prices according to Admin > Settings > Price display mode.
 * Display only: the server recalculates every price at checkout.
 */
export function PriceTag({ mrp, percent, mode = 'SHOW_BOTH', size = '', unit = '', from = false }) {
  const wholesale = wholesaleOf(mrp, percent);
  const suffix = unit ? <span className="price-mrp"> / {unit}</span> : null;
  // size-wise MRP: show the lowest price as "From"
  const prefix = from ? <span className="price-from">From</span> : null;
  if (mode === 'SHOW_MRP') {
    return (
      <div className={`price ${size ? `price-${size}` : ''}`}>
        {prefix}<span className="price-now">MRP {formatINR(mrp)}</span>{suffix}
      </div>
    );
  }
  if (mode === 'SHOW_WHOLESALE') {
    return (
      <div className={`price ${size ? `price-${size}` : ''}`}>
        <span className="price-label">Wholesale</span>
        {prefix}<span className="price-now">{formatINR(wholesale)}</span>{suffix}
      </div>
    );
  }
  return (
    <div className={`price ${size ? `price-${size}` : ''}`}>
      {prefix}
      <span className="price-now">{formatINR(wholesale)}</span>
      <span className="price-mrp strike">MRP {formatINR(mrp)}</span>
      {percent > 0 && <span className="price-off">{pct(percent)} OFF</span>}
      {suffix}
    </div>
  );
}
