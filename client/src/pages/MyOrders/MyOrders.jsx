import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, History, Package, PackageSearch, RefreshCw, ShoppingBag } from 'lucide-react';
import { useSeo } from '../../hooks/index.js';
import { useCustomer } from '../../context/CustomerContext.jsx';
import { useCart } from '../../context/CartContext.jsx';
import { useStore } from '../../context/StoreContext.jsx';
import { OrderCard, useMyOrders } from '../../components/MyOrders/OrderCard.jsx';
import { Alert, EmptyState, PageLoader } from '../../components/common/ui.jsx';

const TABS = [
  { key: 'PENDING', label: 'Pending', icon: Clock, hint: 'Waiting for your payment or for our team to confirm.', empty: 'No pending orders.' },
  { key: 'CONFIRMED', label: 'Confirmed', icon: CheckCircle2, hint: 'Confirmed - being packed or on the way.', empty: 'No confirmed orders in progress.' },
  { key: 'HISTORY', label: 'History', icon: History, hint: 'Handed over and cancelled orders.', empty: 'No past orders yet.' },
];

/** "My orders": pending, confirmed and past orders of the customer. */
export default function MyOrders() {
  useSeo({ title: 'My orders | Nutex Wholesale', noindex: true });
  const customer = useCustomer();
  const cart = useCart();
  const { settings } = useStore();
  const { loading, orders, account, error, reload } = useMyOrders();
  const [tab, setTab] = useState(null);

  if (loading) return <PageLoader label="Loading your orders…" />;
  const groups = Object.fromEntries(TABS.map((t) => [t.key, orders.filter((o) => (o.group || 'PENDING') === t.key)]));
  const active = tab || TABS.find((t) => groups[t.key].length)?.key || 'PENDING';
  const current = TABS.find((t) => t.key === active);

  return (
    <div className="container page">
      <div className="cart-tabs" role="tablist" aria-label="Cart and orders">
        <Link to="/cart" className="cart-tab" role="tab" aria-selected="false"><ShoppingBag /> Cart{cart.count > 0 ? ` (${cart.items.length})` : ''}</Link>
        <span className="cart-tab is-on" role="tab" aria-selected="true"><Package /> Pending orders</span>
      </div>
      <div className="row-between wrap">
        <h1 className="page-title mb-0">My orders</h1>
        <button type="button" className="btn btn-sm btn-ghost" onClick={reload}><RefreshCw /> Refresh</button>
      </div>
      {error && <Alert type="error" className="mt-2">{error.message}</Alert>}

      {!orders.length ? (
        <EmptyState icon={Package} title="No orders yet" action={<Link to="/shop" className="btn btn-primary">Browse products</Link>}>
          Orders you place on this phone show here - pending, confirmed and your order history.
        </EmptyState>
      ) : (
        <>
          <div className="order-tabs mt-2" role="tablist" aria-label="Order status">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={active === t.key} className={`order-tab${active === t.key ? ' is-on' : ''}`} onClick={() => setTab(t.key)}>
                <t.icon /> {t.label} <span className="order-tab-count">{groups[t.key].length}</span>
              </button>
            ))}
          </div>
          <p className="small muted">{current.hint}</p>
          {groups[active].length
            ? <div className="order-grid">{groups[active].map((o) => <OrderCard key={o.order_number} order={o} />)}</div>
            : <p className="muted">{current.empty}</p>}
        </>
      )}

      <div className="info-tile mt-3">
        <PackageSearch />
        <span>
          {account
            ? 'Showing all orders on your registered numbers.'
            : customer.isExisting && settings?.existing_customer_otp_enabled !== false
              ? 'Showing the orders placed on this phone. Log in again with the WhatsApp OTP to see your orders from every phone.'
              : 'Showing the orders placed on this phone.'}
          {' '}Placed an order on another phone? <Link to="/track-order" className="link">Track it with the order number</Link>.
        </span>
      </div>
    </div>
  );
}
