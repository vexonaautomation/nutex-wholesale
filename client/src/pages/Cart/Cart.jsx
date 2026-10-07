import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ShoppingBag, Trash2, RefreshCw } from 'lucide-react';
import { useCart } from '../../context/CartContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useSeo } from '../../hooks/index.js';
import { orderApi } from '../../services/order.js';
import { QuantitySelector } from '../../components/QuantitySelector/QuantitySelector.jsx';
import { CartSummary } from '../../components/CartSummary/CartSummary.jsx';
import { DiscountProgress } from '../../components/DiscountProgress/DiscountProgress.jsx';
import { MinimumOrderProgress } from '../../components/MinimumOrderProgress/MinimumOrderProgress.jsx';
import { EmptyState, Img, Messages, PageLoader, Spinner, Alert } from '../../components/common/ui.jsx';
import { formatINR, pct } from '../../utils/format.js';
import { ExistingCustomerPrompt } from '../../components/ExistingCustomerLogin/ExistingCustomerLogin.jsx';
import { ActiveOrders } from '../../components/ActiveOrders/ActiveOrders.jsx';

function VariantPicker({ line, options: all, onChange }) {
  // a box line can switch to another box, a pieces line to another colour/size
  const options = (all || []).filter((o) => !o.inventory_mode || o.inventory_mode === line.inventory_mode);
  if (!options.length) return null;
  if (line.inventory_mode === 'BOX_WISE') {
    if (options.length < 2) return null;
    return (
      <div className="variant-select">
        <select className="select" value={line.variant_id} onChange={(e) => onChange(e.target.value)} aria-label="Change box">
          {options.map((o) => <option key={o.variant_id} value={o.variant_id} disabled={!o.purchasable}>{o.box_label}{o.purchasable ? '' : ' (out of stock)'}</option>)}
        </select>
      </div>
    );
  }
  const colors = [...new Map(options.map((o) => [o.color_id, o])).values()];
  const sizes = options.filter((o) => o.color_id === line.color_id);
  const pick = (colorId, sizeId) => {
    const exact = options.find((o) => o.color_id === colorId && o.size_id === sizeId && o.purchasable);
    const fallback = options.find((o) => o.color_id === colorId && o.purchasable);
    const target = exact || fallback;
    if (target) onChange(target.variant_id);
  };
  return (
    <div className="variant-select">
      <select className="select" value={line.color_id} onChange={(e) => pick(e.target.value, line.size_id)} aria-label="Change colour">
        {colors.map((c) => <option key={c.color_id} value={c.color_id}>{c.color_name}</option>)}
      </select>
      <select className="select" value={line.size_id} onChange={(e) => pick(line.color_id, e.target.value)} aria-label="Change size">
        {sizes.map((s) => <option key={s.variant_id} value={s.size_id} disabled={!s.purchasable}>Size {s.size_name}{s.purchasable ? '' : ' (out of stock)'}</option>)}
      </select>
    </div>
  );
}

export default function Cart() {
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const { quote } = cart;
  useSeo({ title: 'Your cart | Nutex Wholesale', noindex: true });

  const updateOrder = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const n = cart.editing.order_number;
      await orderApi.update(n, cart.items.map(({ variant_id, qty }) => ({ variant_id, qty })), quote?.final_payable);
      cart.stopEditing();
      toast.success(`Order ${n} updated.`);
      navigate(`/order/${n}`);
    } catch (err) {
      setSaveError(err);
      cart.refreshQuote();
    } finally {
      setSaving(false);
    }
  };

  if (!cart.items.length && !cart.editing) {
    return (
      <div className="container page">
        <ActiveOrders />
        <EmptyState icon={ShoppingBag} title="Your cart is empty" action={<Link to="/shop" className="btn btn-primary">Browse products</Link>}>
          Add products by colour and size, or choose mix-colour boxes.
        </EmptyState>
      </div>
    );
  }
  if (!quote && cart.quoting) return <PageLoader label="Calculating wholesale prices…" />;

  return (
    <div className="container page">
      {!cart.editing && <ActiveOrders />}
      <h1 className="page-title">{cart.editing ? `Edit order ${cart.editing.order_number}` : 'Your cart'}</h1>
      <p className="muted">Prices, discounts and stock are calculated live by our system.</p>
      {cart.quoteError && <Alert type="error" className="mb-2">{cart.quoteError.message}</Alert>}
      <div className="two-col mt-2">
        <div className="card card-pad">
          {!cart.items.length && cart.editing && <Alert type="warning">Your edited order has no items. Add products or cancel editing.</Alert>}
          {(quote?.lines || []).map((l) => (
            <div key={l.key} className={`cart-line ${l.issue ? 'has-issue' : ''}`}>
              <Link to={`/product/${l.product_slug}`} className="cart-thumb"><Img src={l.image} alt={l.product_name} label={l.product_name} /></Link>
              <div>
                <div className="cart-line-top">
                  <div>
                    <Link to={`/product/${l.product_slug}`} className="cart-line-name">{l.product_name}</Link>
                    <div className="tiny soft">SKU {l.sku}</div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => cart.removeItem(l.variant_id)} aria-label={`Remove ${l.product_name}`}><Trash2 /></button>
                </div>
                <div className="cart-line-variant">
                  {l.color_name && <span className="badge badge-outline"><i className="swatch-dot swatch-dot-sm" style={{ background: l.hex_code }} />{l.color_name}</span>}
                  {l.size_name && <span className="badge badge-outline">Size {l.size_name}</span>}
                  {l.box_label && <span className="badge badge-gold">{l.box_label}</span>}
                </div>
                <VariantPicker line={l} options={quote.variant_options?.[l.product_id]} onChange={(to) => cart.changeVariant(l.variant_id, to)} />
                {l.issue && <div className="field-error mt-1">{l.issue.message}</div>}
                <div className="cart-line-bottom mt-1">
                  <QuantitySelector size="sm" value={l.qty} min={1} max={Math.max(l.qty, l.available || 0)} onChange={(n) => cart.setQty(l.variant_id, n)} label={`Quantity of ${l.product_name}`} />
                  <div className="cart-line-price">
                    {l.unit_price !== null ? (
                      <>
                        <strong>{formatINR(l.line_total)}</strong>
                        {formatINR(l.unit_price)} × {l.qty} · MRP {formatINR(l.unit_mrp)} · {pct(l.discount_percent)} off
                      </>
                    ) : <span>MRP {formatINR(l.unit_mrp)}</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div className="row-between mt-2 wrap">
            <Link to="/shop" className="btn btn-sm">Continue shopping</Link>
            <button type="button" className="btn btn-sm btn-ghost" onClick={cart.refreshQuote}>{cart.quoting ? <Spinner small /> : <RefreshCw />} Refresh prices</button>
          </div>
        </div>

        <aside className="sticky-col stack">
          {!cart.editing && <ExistingCustomerPrompt />}
          <div className="card card-pad">
            <CartSummary quote={quote} />
          </div>
          <DiscountProgress quote={quote} />
          <MinimumOrderProgress quote={quote} />
          <Messages messages={quote?.messages} />
          {saveError && <Alert type="error">{saveError.message}</Alert>}
          {cart.editing ? (
            <>
              <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!quote?.can_checkout || saving || cart.quoting} onClick={updateOrder}>
                {saving ? <Spinner small /> : null} Update order {cart.editing.order_number}
              </button>
              <button type="button" className="btn btn-block" onClick={() => { const n = cart.editing.order_number; cart.stopEditing(); navigate(`/order/${n}`); }}>Cancel editing</button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!quote?.can_checkout || cart.quoting} onClick={() => navigate('/checkout')}>
              Proceed to checkout <ArrowRight />
            </button>
          )}
          {!quote?.can_checkout && quote && !quote.minimum_order_met && (
            <p className="small muted center" style={{ textAlign: 'center' }}>
              Checkout unlocks when your final payable total reaches {formatINR(quote.minimum_order_value)}
              {quote.customer_type !== 'EXISTING' ? ' - or verify as an existing customer above.' : '.'}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
