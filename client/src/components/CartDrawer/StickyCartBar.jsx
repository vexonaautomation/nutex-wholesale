import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useCart } from '../../context/CartContext.jsx';
import { formatINR } from '../../utils/format.js';

const HIDDEN_ON = [/^\/cart/, /^\/checkout/, /^\/order\//, /^\/admin/];

// Mobile sticky cart: total + minimum-order progress always in view.
export function StickyCartBar() {
  const cart = useCart();
  const { pathname } = useLocation();
  const visible = cart.items.length > 0 && !HIDDEN_ON.some((r) => r.test(pathname));
  useEffect(() => {
    document.body.classList.toggle('has-sticky-cart', visible);
    return () => document.body.classList.remove('has-sticky-cart');
  }, [visible]);
  if (!visible) return null;
  const q = cart.quote;
  const progress = q && q.minimum_order_value ? Math.min(100, (q.final_payable / q.minimum_order_value) * 100) : 0;
  return (
    <div className="sticky-cart">
      <div className="sticky-cart-inner">
        <div className="grow">
          <div className="row-between small">
            <span><strong>{cart.count}</strong> items · <strong className="num">{formatINR(q?.final_payable)}</strong></span>
            {q && (q.minimum_order_waived
              ? <span style={{ color: 'var(--success-700)', fontWeight: 600 }}>No minimum</span>
              : q.minimum_order_met
                ? <span style={{ color: 'var(--success-700)', fontWeight: 600 }}>Min. reached</span>
                : <span className="muted">{formatINR(q.amount_to_minimum)} to min.</span>)}
          </div>
          <div className={`progress ${q?.minimum_order_met ? 'is-complete' : ''}`}><span style={{ width: `${progress}%` }} /></div>
        </div>
        <button type="button" className="btn btn-primary" onClick={cart.openDrawer}>View cart</button>
      </div>
    </div>
  );
}
