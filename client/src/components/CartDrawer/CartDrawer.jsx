import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Trash2 } from 'lucide-react';
import { useCart } from '../../context/CartContext.jsx';
import { Drawer } from '../common/Modal.jsx';
import { EmptyState, Img, Spinner } from '../common/ui.jsx';
import { QuantitySelector } from '../QuantitySelector/QuantitySelector.jsx';
import { MinimumOrderProgress } from '../MinimumOrderProgress/MinimumOrderProgress.jsx';
import { DiscountProgress } from '../DiscountProgress/DiscountProgress.jsx';
import { formatINR } from '../../utils/format.js';
import { ExistingCustomerPrompt } from '../ExistingCustomerLogin/ExistingCustomerLogin.jsx';
import { useCustomer } from '../../context/CustomerContext.jsx';

export function CartDrawer() {
  const cart = useCart();
  const { isExisting } = useCustomer();
  const navigate = useNavigate();
  const { quote } = cart;
  const lines = quote?.lines || [];
  const go = (to) => {
    cart.closeDrawer();
    navigate(to);
  };
  return (
    <Drawer
      open={cart.drawerOpen}
      onClose={cart.closeDrawer}
      title={cart.editing ? `Editing ${cart.editing.order_number}` : `Your cart (${cart.count})`}
      footer={cart.items.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row-between">
            <span className="muted">Final wholesale total {cart.quoting && <Spinner small />}</span>
            <strong style={{ fontSize: 20 }} className="num">{formatINR(quote?.final_payable)}</strong>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn grow" onClick={() => go('/cart')}>View cart</button>
            {cart.editing ? (
              <button type="button" className="btn btn-primary grow" onClick={() => go('/cart')}>Review &amp; update</button>
            ) : (
              <button type="button" className="btn btn-primary grow" disabled={!quote?.can_checkout} onClick={() => go('/checkout')}>Checkout</button>
            )}
          </div>
        </div>
      )}
    >
      {!cart.items.length ? (
        <EmptyState icon={ShoppingBag} title="Your cart is empty" action={<button type="button" className="btn btn-primary" onClick={() => go('/shop')}>Browse products</button>}>
          Add colours, sizes or mix-colour boxes to start a wholesale order.
        </EmptyState>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {!isExisting && quote && !quote.minimum_order_met && <ExistingCustomerPrompt compact />}
          <MinimumOrderProgress quote={quote} />
          {quote?.discount_mode === 'SLAB' && <DiscountProgress quote={quote} />}
          <div>
            {lines.map((l) => (
              <div key={l.key} className={`cart-line ${l.issue ? 'has-issue' : ''}`}>
                <Link to={`/product/${l.product_slug}`} className="cart-thumb" onClick={cart.closeDrawer}><Img src={l.image} alt={l.product_name} label={l.product_name} /></Link>
                <div>
                  <div className="cart-line-top">
                    <span className="cart-line-name">{l.product_name}</span>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => cart.removeItem(l.variant_id)} aria-label={`Remove ${l.product_name}`}><Trash2 /></button>
                  </div>
                  <div className="cart-line-variant">
                    {l.color_name && <span className="badge badge-outline"><i className="swatch-dot swatch-dot-sm" style={{ background: l.hex_code }} />{l.color_name}</span>}
                    {l.size_name && <span className="badge badge-outline">Size {l.size_name}</span>}
                    {l.box_label && <span className="badge badge-gold">{l.box_label}</span>}
                  </div>
                  {l.issue && <div className="field-error mb-1">{l.issue.message}</div>}
                  <div className="cart-line-bottom">
                    <QuantitySelector size="sm" value={l.qty} min={1} max={Math.max(l.qty, l.available || 0)} onChange={(n) => cart.setQty(l.variant_id, n)} />
                    <div className="cart-line-price"><strong>{formatINR(l.line_total)}</strong>{l.unit_price !== null && `${formatINR(l.unit_price)} × ${l.qty}`}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Link to="/shop" className="link small" onClick={cart.closeDrawer}>Continue shopping</Link>
        </div>
      )}
    </Drawer>
  );
}
