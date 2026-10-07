import { Minus, Plus } from 'lucide-react';

export function QuantitySelector({ value, onChange, min = 0, max = Infinity, step = 1, size = '', disabled = false, label = 'Quantity' }) {
  const set = (v) => {
    const n = Math.floor(Number(v));
    if (Number.isNaN(n)) return onChange(min);
    return onChange(Math.min(max, Math.max(min, n)));
  };
  return (
    <div className={`qty ${size ? `qty-${size}` : ''}`}>
      <button type="button" onClick={() => set(value - step)} disabled={disabled || value <= min} aria-label={`Decrease ${label}`}><Minus /></button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => set(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" onClick={() => set(value + step)} disabled={disabled || value >= max} aria-label={`Increase ${label}`}><Plus /></button>
    </div>
  );
}
