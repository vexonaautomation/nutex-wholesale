import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ClipboardList } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { PageHeader, SearchBox, Pager } from '../components.jsx';
import { EmptyState, ErrorState, PageLoader, StatusBadge } from '../../components/common/ui.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../../constants/index.js';

export default function OrderList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q, 300);
  const { data, loading, error, reload } = useAsync(
    () => adminApi.get(`/orders${qs({ q: dq, order_status: orderStatus, payment_status: paymentStatus, customer_type: customerType, from, to, page, limit: 50 })}`),
    [dq, orderStatus, paymentStatus, customerType, from, to, page],
  );
  const counts = data?.counts;

  return (
    <>
      <PageHeader title="Orders" subtitle="Search by order number, mobile, customer or business name." actions={<a className="btn" href="/api/admin/export/Orders">Export CSV</a>} />
      {counts && (
        <div className="status-tabs">
          <button type="button" className="status-tab" aria-pressed={!orderStatus} onClick={() => { setOrderStatus(''); setPage(1); }}>All <b>{counts.total}</b></button>
          {Object.entries(ORDER_STATUS).filter(([k]) => k !== 'DRAFT').map(([k, v]) => (
            <button key={k} type="button" className="status-tab" aria-pressed={orderStatus === k} onClick={() => { setOrderStatus(k); setPage(1); }}>
              {v.label} <b>{counts.by_order_status[k] || 0}</b>
            </button>
          ))}
        </div>
      )}
      <div className="filter-bar">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Order no, mobile, customer, business" />
        <select className="select" value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }} aria-label="Payment status">
          <option value="">All payment statuses</option>
          {Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="select" value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); }} aria-label="Customer type">
          <option value="">New + existing customers</option>
          <option value="EXISTING">Existing customers</option>
          <option value="NEW">New customers</option>
        </select>
        <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
        <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
      </div>
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.items.length ? (
        <EmptyState icon={ClipboardList} title="No orders found">Orders placed on the website appear here instantly.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Order no</th><th>Date</th><th>Customer</th><th>Mobile</th><th>City</th><th className="right">Order value</th><th>Payment</th><th>Order status</th><th>Locked</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.order_id} className="is-clickable" onClick={() => navigate(`/admin/orders/${o.order_id}`)}>
                    <td className="cell-main">{o.order_number}</td>
                    <td className="small nowrap">{formatDateTime(o.created_at)}</td>
                    <td><div className="cell-main">{o.business_name} {o.customer_type === 'EXISTING' && <span className="badge badge-success">Existing</span>}</div><div className="cell-sub">{o.customer_name}</div></td>
                    <td className="small">{o.mobile}</td>
                    <td className="small">{o.city}</td>
                    <td className="right num"><strong>{formatINR(o.final_payable)}</strong></td>
                    <td>{o.payment_mode_snapshot === 'OFFLINE' ? <span className="badge badge-gold">No online payment</span> : <StatusBadge kind="payment" status={o.payment_status} />}</td>
                    <td><StatusBadge status={o.order_status} /></td>
                    <td>{o.locked ? <Lock size={16} color="var(--ink-700)" aria-label="Locked" /> : <span className="soft small">Open</span>}</td>
                    <td className="small nowrap">{formatDateTime(o.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
    </>
  );
}
