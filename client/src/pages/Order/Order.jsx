import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CreditCard, Lock, Pencil, Truck } from 'lucide-react';
import { orderApi, getOrderToken } from '../../services/order.js';
import { useStore } from '../../context/StoreContext.jsx';
import { useCart } from '../../context/CartContext.jsx';
import { useSeo } from '../../hooks/index.js';
import { OrderItems, OrderTotals } from '../../components/OrderSummary/OrderSummary.jsx';
import { Alert, ErrorState, PageLoader, StatusBadge } from '../../components/common/ui.jsx';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { VerifyOrderAccess } from '../TrackOrder/VerifyOrderAccess.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';
import { paymentConfirmationMessage, waLink, waNumber } from '../../utils/whatsapp.js';
import { PAYMENT_STATUS } from '../../constants/index.js';

export function OrderTimeline({ timeline }) {
  return (
    <ol className="timeline">
      {timeline.map((t, i) => (
        <li key={`${t.status}-${t.at}-${i}`} className={t.status === 'CANCELLED' ? 'is-muted' : ''}>
          <div className="timeline-title">{t.label}</div>
          <div className="timeline-meta">{formatDateTime(t.at)}</div>
          {t.note && <div className="timeline-note">{t.note}</div>}
        </li>
      ))}
    </ol>
  );
}

export default function Order() {
  const { orderNumber } = useParams();
  const { settings } = useStore();
  const cart = useCart();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, order: null, error: null });
  useSeo({ title: `Order ${orderNumber} | Nutex Wholesale`, noindex: true });

  const load = async () => {
    if (!getOrderToken(orderNumber)) {
      setState({ loading: false, order: null, error: { code: 'ORDER_ACCESS_REQUIRED' } });
      return;
    }
    try {
      const { order } = await orderApi.get(orderNumber);
      setState({ loading: false, order, error: null });
    } catch (error) {
      setState({ loading: false, order: null, error });
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  if (state.loading) return <PageLoader />;
  if (state.error?.code === 'ORDER_ACCESS_REQUIRED') {
    return <div className="container page"><VerifyOrderAccess initialOrderNumber={orderNumber} onVerified={() => { setState({ loading: true }); load(); }} /></div>;
  }
  if (state.error) return <div className="container page"><ErrorState error={state.error} onRetry={load} /></div>;

  const { order } = state;
  const wa = waNumber(settings, 'payment');
  const lastPayment = order.payments.slice(-1)[0];

  const startEdit = () => {
    cart.startEditOrder(order);
    navigate('/cart');
  };

  return (
    <div className="container page">
      <div className="order-head">
        <div>
          <span className="eyebrow">Order placed {formatDateTime(order.created_at)}</span>
          <h1 className="order-no">{order.order_number}</h1>
          <div className="row wrap mt-1">
            <StatusBadge status={order.order_status} />
            <span className="small muted">Payment:</span> <StatusBadge kind="payment" status={order.payment_status} />
            {order.locked && <span className="badge badge-dark"><Lock /> Locked</span>}
          </div>
        </div>
        <div className="row wrap">
          {order.permissions.can_submit_payment && (
            <Link to={`/order/${order.order_number}/payment`} className="btn btn-primary"><CreditCard /> Pay {formatINR(order.amount_to_pay)}</Link>
          )}
          {order.permissions.can_edit && <button type="button" className="btn" onClick={startEdit}><Pencil /> Edit order</button>}
        </div>
      </div>

      {order.locked && order.order_status !== 'CANCELLED' && (
        <div className="lock-banner"><Lock /><span>Your order has been locked because payment confirmation has been submitted. To request changes, contact us on WhatsApp.</span></div>
      )}
      {order.notices.filter((n) => n.code !== 'ORDER_LOCKED').map((n) => <Alert key={n.code} type={n.type} className="mb-2">{n.text}</Alert>)}
      {order.permissions.can_edit && (
        <Alert type="brand" className="mb-2">You can still add or remove products, change sizes/colours or quantities until you submit payment confirmation.</Alert>
      )}

      <div className="two-col">
        <div className="stack" style={{ gap: 18 }}>
          <section className="card card-pad">
            <h2 className="card-title">Items</h2>
            <OrderItems items={order.items} />
          </section>
          {order.dispatch?.courier_name || order.dispatch?.tracking_number ? (
            <section className="card card-pad">
              <h2 className="card-title"><Truck /> Dispatch details</h2>
              <dl className="kv">
                {order.dispatch.courier_name && <><dt>Courier</dt><dd>{order.dispatch.courier_name}</dd></>}
                {order.dispatch.tracking_number && <><dt>Tracking number</dt><dd>{order.dispatch.tracking_number}</dd></>}
                {order.dispatch.dispatched_at && <><dt>Dispatched</dt><dd>{formatDateTime(order.dispatch.dispatched_at)}</dd></>}
                {order.dispatch.dispatch_note && <><dt>Note</dt><dd>{order.dispatch.dispatch_note}</dd></>}
              </dl>
            </section>
          ) : null}
          <section className="card card-pad">
            <h2 className="card-title">Delivery &amp; business details</h2>
            <dl className="kv">
              <dt>Name</dt><dd>{order.customer.customer_name}</dd>
              <dt>Business</dt><dd>{order.customer.business_name}</dd>
              <dt>Mobile</dt><dd>{order.customer.mobile}</dd>
              <dt>WhatsApp</dt><dd>{order.customer.whatsapp}</dd>
              {order.customer.alternate_mobile && <><dt>Alternate mobile</dt><dd>{order.customer.alternate_mobile}</dd></>}
              {order.customer.email && <><dt>Email</dt><dd>{order.customer.email}</dd></>}
              {order.customer.gstin && <><dt>GSTIN</dt><dd>{order.customer.gstin}</dd></>}
              <dt>Billing address</dt><dd style={{ whiteSpace: 'pre-line' }}>{order.customer.billing_address}</dd>
              <dt>Shipping address</dt><dd style={{ whiteSpace: 'pre-line' }}>{order.customer.shipping_address}<br />{order.customer.city}, {order.customer.state} - {order.customer.pincode}</dd>
              {order.order_notes && <><dt>Order notes</dt><dd>{order.order_notes}</dd></>}
            </dl>
          </section>
        </div>
        <aside className="sticky-col stack">
          <div className="card card-pad"><h3 className="card-title">Totals</h3><OrderTotals totals={order.totals} /></div>
          {order.payments.length > 0 && (
            <div className="card card-pad">
              <h3 className="card-title">Payments</h3>
              {order.payments.map((p) => (
                <div key={p.payment_id} className="summary-row" style={{ alignItems: 'center' }}>
                  <span>{formatINR(p.amount)}{p.utr ? ` · UTR ${p.utr}` : ''}<br /><span className="tiny soft">{formatDateTime(p.submitted_at)}{p.remarks ? ` · ${p.remarks}` : ''}</span></span>
                  <span className={`badge badge-${PAYMENT_STATUS[p.status]?.tone || 'outline'}`}>{PAYMENT_STATUS[p.status]?.label || p.status}</span>
                </div>
              ))}
            </div>
          )}
          <div className="card card-pad">
            <h3 className="card-title">Order timeline</h3>
            <OrderTimeline timeline={order.timeline} />
          </div>
          {wa && (
            <a
              className="btn btn-whatsapp btn-block"
              href={waLink(wa, lastPayment && order.payment_status === 'SUBMITTED'
                ? paymentConfirmationMessage({ orderNumber: order.order_number, amount: lastPayment.amount, utr: lastPayment.utr, businessName: order.customer.business_name })
                : `Hello Nutex Team, I have a question about order ${order.order_number}.`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <WhatsAppIcon /> {order.payment_status === 'SUBMITTED' ? 'Confirm Payment on WhatsApp' : 'WhatsApp support'}
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
