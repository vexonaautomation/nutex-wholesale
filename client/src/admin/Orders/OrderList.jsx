import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, ClipboardList, UserRound } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { PageHeader, SearchBox, Pager } from '../components.jsx';
import { EmptyState, ErrorState, PageLoader, StatusBadge } from '../../components/common/ui.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../../constants/index.js';
import { useAdmin, isManager, isSubAdmin } from '../AdminApp.jsx';

/** Who made the order: the customer, or the admin / sub admin number. */
export function MadeBy({ order }) {
  if (!order.placed_by_mobile) return <span className="soft small">Customer</span>;
  return <span className="badge badge-outline made-by"><UserRound size={12} /> {order.placed_by_name || `Admin ${order.placed_by_mobile}`}</span>;
}

export default function OrderList() {
  const navigate = useNavigate();
  const { admin } = useAdmin();
  // links from the dashboard / sub admins: ?status=… or ?placed_by=…
  const [params] = useSearchParams();
  const [placedBy, setPlacedBy] = useState(params.get('placed_by') || '');
  const team = useAsync(() => (isManager(admin) ? adminApi.get('/sub-admins') : Promise.resolve({ items: [] })), []);
  const [q, setQ] = useState('');
  const [orderStatus, setOrderStatus] = useState(params.get('status') || '');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q, 300);
  const { data, loading, error, reload } = useAsync(
    () => adminApi.get(`/orders${qs({ q: dq, order_status: orderStatus, payment_status: paymentStatus, customer_type: customerType, placed_by: placedBy, from, to, page, limit: 50 })}`),
    [dq, orderStatus, paymentStatus, customerType, placedBy, from, to, page],
  );
  const counts = data?.counts;

  return (
    <>
      <PageHeader title="Orders" subtitle="Search by order number, mobile, customer or business name." actions={isSubAdmin(admin) ? null : <a className="btn" href="/api/admin/export/Orders">Export CSV</a>} />
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
        <select className="select" value={placedBy} onChange={(e) => { setPlacedBy(e.target.value); setPage(1); }} aria-label="Made by">
          <option value="">Made by: everyone</option>
          <option value="customer">Made by the customer</option>
          <option value="team">Made by the team (admin numbers)</option>
          {isSubAdmin(admin) && admin.mobile && <option value={admin.mobile}>Made by me</option>}
          {(team.data?.items || []).map((u) => <option key={u.admin_id} value={u.mobile}>Made by {u.name}</option>)}
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
                <tr><th>Order no</th><th>Date</th><th>Customer</th><th>Mobile</th><th>City</th><th className="right">Order value</th><th>Payment</th><th>Order status</th><th>Made by</th><th>Packed by</th><th>Locked</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.order_id} className="is-clickable" onClick={() => navigate(`/admin/orders/${o.order_id}`)}>
                    <td className="cell-main">{o.order_number}</td>
                    <td className="small nowrap">{formatDateTime(o.created_at)}</td>
                    <td><div className="cell-main">{o.business_name} {o.customer_type === 'EXISTING' && <span className="badge badge-success">Existing</span>}</div><div className="cell-sub">{o.customer_name}</div></td>
                    <td className="small">{o.mobile}</td>
                    <td className="small">{o.city}</td>
                    <td className="right num"><strong>{formatINR(o.final_payable)}</strong>{o.less_packing && <div><span className="badge badge-gold packing-flag" title="Customer chose to less packing charges">− packing {formatINR(o.packing_deduction)}</span></div>}</td>
                    <td>{o.payment_mode_snapshot === 'OFFLINE' ? <span className="badge badge-gold">No online payment</span> : <StatusBadge kind="payment" status={o.payment_status} />}</td>
                    <td><StatusBadge status={o.order_status} /></td>
                    <td><MadeBy order={o} /></td>
                    <td>{o.packer_name ? <span className="small">{o.packer_name}</span> : <span className="soft small">-</span>}</td>
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
