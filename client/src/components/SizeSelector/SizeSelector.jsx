import { QuantitySelector } from '../QuantitySelector/QuantitySelector.jsx';
import { formatINR } from '../../utils/format.js';
import { wholesaleOf } from '../../utils/pricing.js';

function SizePrice({ mrp, percent, mode }) {
  if (mode === 'SHOW_MRP') return <span className="size-price">MRP {formatINR(mrp)}</span>;
  const now = formatINR(wholesaleOf(mrp, percent));
  if (mode === 'SHOW_WHOLESALE') return <span className="size-price">{now}</span>;
  return <span className="size-price">{now}<s>{formatINR(mrp)}</s></span>;
}

/**
 * Wholesale size grid: one row per size with its own quantity, so buyers can
 * order several sizes of the selected colour in one go. Unavailable
 * colour+size combinations are disabled (never addable).
 * When sizes have different MRPs (size-wise MRP), each row shows its price.
 */
export function SizeSelector({ variants, quantities, onChange, inCart = {}, showPrice = false, percent = 0, mode = 'SHOW_BOTH' }) {
  return (
    <div className="size-grid">
      {variants.map((v) => {
        const qty = quantities[v.variant_id] || 0;
        const already = inCart[v.variant_id] || 0;
        const max = Math.max(0, v.available_qty - already);
        const oos = !v.purchasable;
        const low = !oos && v.available_qty <= 10;
        return (
          <div key={v.variant_id} className={`size-row ${qty ? 'has-qty' : ''} ${oos ? 'is-oos' : ''}`}>
            <span className="size-name">{v.size_name}{showPrice && <SizePrice mrp={v.unit_mrp} percent={percent} mode={mode} />}</span>
            <span className={`size-stock ${low ? 'low' : ''}`}>
              {oos ? 'Out of stock' : `${v.available_qty} available${already ? ` · ${already} in cart` : ''}`}
            </span>
            <QuantitySelector
              size="sm"
              value={qty}
              max={max}
              disabled={oos || max === 0}
              onChange={(n) => onChange(v.variant_id, n)}
              label={`Quantity for size ${v.size_name}`}
            />
          </div>
        );
      })}
    </div>
  );
}
