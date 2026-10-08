import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Pencil } from 'lucide-react';
import { orderApi, getOrderToken } from '../../services/order.js';
import { useStore } from '../../context/StoreContext.jsx';
import { useSeo } from '../../hooks/index.js';
import { ErrorState, PageLoader } from '../../components/common/ui.jsx';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { DownloadBillButton } from '../../components/DownloadBill/DownloadBillButton.jsx';
import { VerifyOrderAccess } from '../TrackOrder/VerifyOrderAccess.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';
import { waLink, waNumber } from '../../utils/whatsapp.js';

// Shown after checkout when online payment is switched off in Settings:
// the order is received and the Nutex team confirms it with the customer.
export default function ThankYou() {
  const { orderNumber } = useParams();
  const { settings } = useStore();
  const [state, setState] = useState({ loading: true, order: null, error: null });
  useSeo({ title: `Thank you - order ${orderNumber} | Nutex Wholesale`, noindex: true });

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
  // an order paid online belongs on its payment page
  if (order.payment_mode !== 'OFFLINE' && order.permissions.can_submit_payment) return <Navigate to={`/order/${order.order_number}/payment`} replace />;

  const company = settings?.company_name || 'Nutex Apparel Limited';
  const pcs = order.items.reduce((s, i) => s + (Number(i.qty) || 0) * (i.inventory_mode === 'BOX_WISE' ? Number(i.units_per_box) || 1 : 1), 0);
  const wa = waNumber(settings, 'support');
  const waText = `Hello ${company}, I have placed order ${order.order_number} (${formatINR(order.totals.final_payable)}) for ${order.customer.business_name}. Please confirm my order.`;
  const confirmed = order.order_status !== 'PAYMENT_PENDING';

  return (
    <div className="container page thank-you">
      <div className="step-list">
        <span className="step-pill done"><i>1</i> Cart</span><span className="step-sep" />
        <span className="step-pill done"><i>2</i> Details</span><span className="step-sep" />
        <span className="step-pill done"><i>3</i> Order placed</span>
      </div>

      <section className="thank-hero">
        <div className="icon"><CheckCircle2 size={32} /></div>
        <span className="eyebrow">Order received</span>
        <h1 className="display">Thank you for your order</h1>
        <p className="lead">
          We have received your order <strong>{order.order_number}</strong>.
          {confirmed
            ? ` It has been confirmed by our team (${order.status_label}).`
            : ' Our team will review it and contact you shortly to confirm the order and payment details.'}
        </p>
        <span className={`badge ${confirmed ? 'badge-success' : 'badge-warning'}`}>{confirmed ? order.status_label : 'Awaiting order confirmation'}</span>
      </section>

      <div className="two-col mt-3">
        <section className="card card-pad">
          <h2 className="card-title">What happens next</h2>
          <ol className="next-steps">
            <li className={confirmed ? 'done' : 'current'}>
              <strong>Order review</strong>
              <span>Our team checks your items, quantities and availability.</span>
            </li>
            <li className={confirmed ? 'done' : ''}>
              <strong>Confirmation</strong>
              <span>We contact you on WhatsApp or phone ({order.customer.mobile}) to confirm the order and share payment details.</span>
            </li>
            <li>
              <strong>Packing &amp; dispatch</strong>
              <span>Once confirmed, your order is packed and dispatched. You can track it any time with your order number.</span>
            </li>
          </ol>
          <p className="small muted mb-0">
            Please keep your order number <strong>{order.order_number}</strong> for reference.
            {order.permissions.can_edit && ' Need a change? You can edit the order until our team confirms it.'}
          </p>
        </section>

        <aside className="stack" style={{ gap: 14 }}>
          <section className="card card-pad">
            <h2 className="card-title">Order summary</h2>
            <dl className="kv">
              <dt>Order number</dt><dd><strong>{order.order_number}</strong></dd>
              <dt>Placed on</dt><dd>{formatDateTime(order.created_at)}</dd>
              <dt>Business</dt><dd>{order.customer.business_name}</dd>
              <dt>Items</dt><dd>{order.items.length} lines · {pcs} pcs</dd>
              <dt>Order value</dt><dd><strong className="num">{formatINR(order.totals.final_payable)}</strong></dd>
            </dl>
          </section>
          <div className="stack" style={{ gap: 10 }}>
            {wa && <a className="btn btn-whatsapp btn-block" href={waLink(wa, waText)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> Message us about this order</a>}
            <Link to={`/order/${order.order_number}`} className="btn btn-primary btn-block">View order details <ArrowRight /></Link>
            {order.permissions.can_edit && <Link to={`/order/${order.order_number}`} className="btn btn-block"><Pencil /> Edit order</Link>}
            {order.permissions.can_download_bill && <DownloadBillButton orderNumber={order.order_number} className="btn btn-block" />}
            <Link to="/shop" className="btn btn-ghost btn-block">Continue shopping</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
