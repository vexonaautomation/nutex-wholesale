import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Package, QrCode } from 'lucide-react';
import { orderApi, openSavedOrders, markOrderClosed } from '../../services/order.js';
import { StatusBadge } from '../common/ui.jsx';
import { formatDate, formatINR } from '../../utils/format.js';

// Orders placed on this device stay here - from checkout, through payment
// and packing - until the Nutex team marks them "Handed over" (or cancels).
const NEXT_STEP = {
  PAYMENT_PENDING: 'Scan the QR code and pay to confirm this order.',
  PAYMENT_REJECTED: 'Payment could not be verified - please pay and submit again.',
  PAYMENT_SUBMITTED: 'Payment submitted - our team is verifying it.',
  PAYMENT_VERIFIED: 'Payment verified - your order will be packed soon.',
  CONFIRMED: 'Order confirmed - it will be packed soon.',
  PROCESSING: 'Your order is being prepared.',
  PACKED: 'Packed - ready for handover.',
  DISPATCHED: 'Dispatched - on its way to you.',
};

export function ActiveOrders({ onNavigate, className = '' }) {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    const saved = openSavedOrders();
    if (!saved.length) return undefined;
    let alive = true;
    orderApi.active(saved)
      .then(({ orders: list }) => {
        if (!alive) return;
        for (const o of list) if (o.closed) markOrderClosed(o.order_number);
        setOrders(list.filter((o) => !o.closed));
      })
      .catch(() => { /* the cart still works without the order cards */ });
    return () => { alive = false; };
  }, []);

  if (!orders.length) return null;
  return (
    <section className={`active-orders ${className}`} aria-label="Your orders">
      <h2 className="active-orders-title"><Package size={18} /> Your orders</h2>
      {orders.map((o) => (
        <div key={o.order_number} className={`order-card ${o.can_submit_payment ? 'is-due' : ''}`}>
          <div className="order-card-top">
            <div>
              <strong className="order-card-no">{o.order_number}</strong>
              <div className="tiny soft">{formatDate(o.created_at)} · {o.lines} item{o.lines === 1 ? '' : 's'} · {o.total_pcs} pcs</div>
            </div>
            <strong className="num">{formatINR(o.final_payable)}</strong>
          </div>
          <div className="row wrap" style={{ gap: 6 }}><StatusBadge status={o.order_status} /></div>
          <p className="small muted mb-0">{NEXT_STEP[o.order_status] || o.status_label}</p>
          {o.can_submit_payment ? (
            <Link to={`/order/${o.order_number}/payment`} className="btn btn-primary btn-sm btn-block" onClick={onNavigate}>
              <QrCode /> Pay {formatINR(o.amount_to_pay)} now
            </Link>
          ) : (
            <Link to={`/order/${o.order_number}`} className="btn btn-sm btn-block" onClick={onNavigate}>
              View order <ArrowRight />
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
