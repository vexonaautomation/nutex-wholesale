import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, PackageSearch } from 'lucide-react';
import { useSeo } from '../../hooks/index.js';
import { listSavedOrders } from '../../services/order.js';
import { VerifyOrderAccess } from './VerifyOrderAccess.jsx';
import { OrderTimeline } from '../Order/Order.jsx';
import { StatusBadge } from '../../components/common/ui.jsx';
import { formatDate, formatINR } from '../../utils/format.js';

export default function TrackOrder() {
  const [params] = useSearchParams();
  const [order, setOrder] = useState(null);
  const saved = listSavedOrders();
  useSeo({ title: 'Track your order | Nutex Wholesale', description: 'Track your Nutex wholesale order with your order number and mobile number.' });

  return (
    <div className="container page">
      <span className="eyebrow"><PackageSearch size={14} /> Order tracking</span>
      <h1 className="page-title">Track your order</h1>
      <p className="muted">Use the order number from your confirmation and the mobile number you ordered with.</p>
      <div className="two-col mt-3">
        <div className="stack" style={{ gap: 18 }}>
          <VerifyOrderAccess initialOrderNumber={params.get('order') || ''} onVerified={setOrder} title="Find your order" />
          {order && (
            <section className="card card-pad">
              <div className="row-between wrap mb-2">
                <div>
                  <div className="small muted">Order</div>
                  <h2 className="order-no" style={{ fontSize: 24 }}>{order.order_number}</h2>
                </div>
                <div className="row wrap"><StatusBadge status={order.order_status} /><StatusBadge kind="payment" status={order.payment_status} /></div>
              </div>
              <dl className="kv mb-2">
                <dt>Placed on</dt><dd>{formatDate(order.created_at)}</dd>
                <dt>Final payable</dt><dd>{formatINR(order.totals.final_payable)}</dd>
                <dt>Items</dt><dd>{order.items.length} lines · {order.totals.total_qty} units</dd>
                {order.dispatch?.courier_name && <><dt>Courier</dt><dd>{order.dispatch.courier_name} {order.dispatch.tracking_number}</dd></>}
              </dl>
              <OrderTimeline timeline={order.timeline} />
              <Link to={`/order/${order.order_number}`} className="btn btn-primary mt-2">View full order <ArrowRight /></Link>
            </section>
          )}
        </div>
        <aside className="card card-pad">
          <h3 className="card-title">Orders on this device</h3>
          {saved.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {saved.map((o) => (
                <Link key={o.order_number} to={`/order/${o.order_number}`} className="row-between" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <span><strong>{o.order_number}</strong><br /><span className="tiny soft">{o.business || ''} {o.saved_at ? `· ${formatDate(o.saved_at)}` : ''}</span></span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          ) : <p className="small muted mb-0">Orders you place or verify on this device will appear here.</p>}
        </aside>
      </div>
    </div>
  );
}
