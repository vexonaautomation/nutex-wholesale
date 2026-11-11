import { useCart } from '../../context/CartContext.jsx';

/**
 * Owner / main admin ordering for a customer: the discount is optional.
 * Unticked = every item at MRP. Shown only when the server says this number may choose.
 */
export function DiscountChoice({ quote }) {
  const cart = useCart();
  if (!quote?.discount_choice || cart.editing) return null;
  return (
    <label className={`packing-choice${cart.applyDiscount ? ' is-on' : ''}`}>
      <input type="checkbox" checked={cart.applyDiscount} onChange={(e) => cart.setApplyDiscount(e.target.checked)} disabled={cart.quoting} />
      <span>
        <strong>Give discount on this order</strong>
        <span className="small">{cart.applyDiscount ? 'The wholesale discount is applied.' : 'Not ticked: every item at MRP, no discount.'}</span>
        <span className="tiny soft">Owner order: no minimum order value applies.</span>
      </span>
    </label>
  );
}
